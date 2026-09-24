from rest_framework_simplejwt.authentication import JWTAuthentication

from .context import user_id_var


class ContextJWTAuthentication(JWTAuthentication):
    """JWT-аутентификация, которая кладёт id пользователя в контекст логов."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            user_id_var.set(result[0].pk)
        return result
