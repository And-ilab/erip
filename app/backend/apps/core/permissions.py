"""Права по ролям (упрощённая матрица Приложения 1 ТЗ для MVP)."""

import hmac

from django.conf import settings
from rest_framework.permissions import SAFE_METHODS, BasePermission

INTERNAL_TOKEN_HEADER = "X-Internal-Token"


class RolePermission(BasePermission):
    """Чтение — всем аутентифицированным; запись — ролям из view.write_roles."""

    default_write_roles = ("superadmin", "local_admin", "specialist")

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        read_roles = getattr(view, "read_roles", None)
        if request.method in SAFE_METHODS:
            return read_roles is None or user.role in read_roles
        write_roles = getattr(view, "write_roles", self.default_write_roles)
        # write_roles=None — действие доступно любому аутентифицированному (например, «прочитано»)
        return write_roles is None or user.role in write_roles


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role == "superadmin")


class IsInternalService(BasePermission):
    """Служебные вызовы шлюза: заголовок X-Internal-Token с общим секретом."""

    def has_permission(self, request, view) -> bool:
        token = request.headers.get(INTERNAL_TOKEN_HEADER, "")
        return bool(token) and hmac.compare_digest(token, settings.INTERNAL_TOKEN)
