"""Вход: access в ответе, refresh только в httpOnly-cookie. Повторное использование старого refresh запрещено."""

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.core.exceptions import error_body


def user_authentication_rule(user) -> bool:
    """Неактивный пользователь или неактивная схема не получают и не продлевают токен.

    Суперадминистратор без схемы (organization_id пустой) остаётся допустимым.
    """
    if user is None or not user.is_active:
        return False
    organization_id = getattr(user, "organization_id", None)
    if not organization_id:
        return True
    from apps.users.models import Organization

    return Organization.objects.filter(pk=organization_id, is_active=True).exists()


def revoke_all_refresh_tokens(user) -> None:
    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)


def _set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        settings.AUTH_COOKIE_NAME,
        refresh,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite="Lax",
        path="/api/v1/auth/",
    )


class CookieTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = response.data.get("refresh")
        if refresh:
            _set_refresh_cookie(response, refresh)
            response.data.pop("refresh")
        return response


class CookieTokenRefreshView(APIView):
    permission_classes = []
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "refresh"

    def post(self, request, *args, **kwargs):
        raw = request.data.get("refresh") if isinstance(request.data, dict) else None
        refresh = raw or request.COOKIES.get(settings.AUTH_COOKIE_NAME, "")
        serializer = TokenRefreshSerializer(data={"refresh": refresh})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError:
            return Response(
                error_body("token_not_valid", "Токен недействителен или отозван"),
                status=status.HTTP_401_UNAUTHORIZED,
            )
        response = Response(serializer.validated_data, status=status.HTTP_200_OK)
        new_refresh = response.data.get("refresh")
        if new_refresh:
            _set_refresh_cookie(response, new_refresh)
            response.data.pop("refresh")
        return response


class LogoutView(APIView):
    def post(self, request):
        refresh = request.COOKIES.get(settings.AUTH_COOKIE_NAME, "")
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.AUTH_COOKIE_NAME, path="/api/v1/auth/")
        return response


class PasswordChangeView(APIView):
    """Смена своего пароля. Все выданные refresh этой учётной записи отзываются."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        old_password = data.get("old_password") or ""
        new_password = data.get("new_password") or ""
        if not request.user.check_password(old_password):
            raise ValidationError({"old_password": "Неверный текущий пароль"})
        try:
            validate_password(new_password, request.user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": list(exc.messages)}) from exc
        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])
        refresh = request.COOKIES.get(settings.AUTH_COOKIE_NAME, "")
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass
        revoke_all_refresh_tokens(request.user)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.AUTH_COOKIE_NAME, path="/api/v1/auth/")
        return response
