from rest_framework.response import Response

from apps.core.serialization import snapshot

from .models import AuditLog
from .services import record_action, record_query


class AuditedViewSetMixin:
    """Фиксирует создание/изменение/удаление (и при audit_view — просмотр) в журнале аудита."""

    audit_view = False
    audit_list = False

    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        super().perform_update(serializer)
        record_action(self.request, AuditLog.Action.UPDATE, serializer.instance, before=before)

    def perform_destroy(self, instance):
        before = snapshot(instance)
        super().perform_destroy(instance)
        record_action(self.request, AuditLog.Action.DELETE, instance, before=before, after={})

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        if self.audit_view:
            record_action(request, AuditLog.Action.VIEW, instance)
        return Response(self.get_serializer(instance).data)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if self.audit_list:
            count = response.data.get("count") if isinstance(response.data, dict) else None
            record_query(request, self.get_queryset().model._meta.label, count=count)
        return response
