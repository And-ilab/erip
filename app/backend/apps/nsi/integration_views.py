"""REST каталога интеграций: /api/v1/integrations/."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import RolePermission

from .services.integrations import (
    GatewayCallError,
    get_integration,
    integration_detail,
    list_integrations,
    pris_check,
    pris_poll_state,
    pris_session,
    save_pris_poll,
)


class PrisSessionPermission(BasePermission):
    """Вход в модуль открывает сессию ПРИС у любой роли, которой виден каталог."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        roles = getattr(view, "read_roles", ())
        return bool(user and user.is_authenticated and user.role in roles)


class PrisPollPermission(BasePermission):
    """Период виден всем, кому виден каталог. Пишут те, кто ведёт обмен."""

    write_roles = ("superadmin", "local_admin", "specialist", "legal")

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return user.role in getattr(view, "read_roles", ())
        return user.role in self.write_roles


class IntegrationViewSet(viewsets.ViewSet):
    """Список и статус каналов. Пишет только администратор схемы на связанных nsi-маршрутах."""

    permission_classes = [IsAuthenticated, RolePermission]
    read_roles = ("superadmin", "local_admin", "specialist", "legal", "observer", "viewer")
    write_roles = ("superadmin", "local_admin")

    def get_permissions(self):
        action = getattr(self, "action", None)
        if action == "session":
            return [IsAuthenticated(), PrisSessionPermission()]
        if action == "poll":
            return [IsAuthenticated(), PrisPollPermission()]
        return [permission() for permission in self.permission_classes]

    def list(self, request):
        rows = list_integrations()
        return Response({"results": rows, "count": len(rows)})

    def retrieve(self, request, pk=None):
        row = integration_detail(str(pk or ""))
        if row is None:
            return Response({"detail": "Интеграция не найдена"}, status=status.HTTP_404_NOT_FOUND)
        return Response(row)

    @action(detail=True, methods=["get"], url_path="status")
    def status_check(self, request, pk=None):
        """Повторный опрос статуса одной интеграции."""
        if get_integration(str(pk or "")) is None:
            return Response({"detail": "Интеграция не найдена"}, status=status.HTTP_404_NOT_FOUND)
        row = integration_detail(str(pk or ""))
        return Response(row["status"] if row else {})

    @action(detail=True, methods=["post"], url_path="session")
    def session(self, request, pk=None):
        """Вход в обмен с ПРИС: модуль сам открывает сессию и читает служебные сервисы."""
        if str(pk or "") != "pris":
            return Response({"detail": "Для этого канала входа нет"}, status=status.HTTP_404_NOT_FOUND)
        try:
            return Response(pris_session())
        except GatewayCallError as exc:
            return Response({"detail": exc.detail}, status=exc.status)

    @action(detail=True, methods=["get", "put"], url_path="poll")
    def poll(self, request, pk=None):
        """Период автоопроса. Пустое значение опрос не запускает."""
        if str(pk or "") != "pris":
            return Response({"detail": "Для этого канала расписания нет"}, status=status.HTTP_404_NOT_FOUND)
        if request.method == "GET":
            return Response(pris_poll_state())
        try:
            return Response(save_pris_poll(request.data.get("interval_minutes")))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="checks")
    def checks(self, request, pk=None):
        """Один служебный запрос ПРИС и сверка ответа с прогоном 03–04.11.2026."""
        if str(pk or "") != "pris":
            return Response({"detail": "Для этого канала проверочных запросов нет"}, status=status.HTTP_404_NOT_FOUND)
        step = str(request.data.get("step") or "").strip().lower()
        if not step:
            return Response({"detail": "Не указан шаг"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(pris_check(step))
        except GatewayCallError as exc:
            return Response({"detail": exc.detail}, status=exc.status)
