"""REST каталога интеграций: /api/v1/integrations/."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import RolePermission

from .services.integrations import get_integration, integration_detail, list_integrations


class IntegrationViewSet(viewsets.ViewSet):
    """Список и статус каналов. Пишет только администратор схемы на связанных nsi-маршрутах."""

    permission_classes = [IsAuthenticated, RolePermission]
    read_roles = ("superadmin", "local_admin", "specialist", "legal", "observer", "viewer")
    write_roles = ("superadmin", "local_admin")

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
