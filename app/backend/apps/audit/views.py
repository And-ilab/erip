from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsInternalService, IsSuperAdmin

from .models import AuditLog, ErrorLog
from .serializers import AuditLogSerializer, ErrorIngestSerializer, ErrorLogSerializer
from .services import record_error


class ErrorLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ErrorLog.objects.all()
    serializer_class = ErrorLogSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["service", "request_id", "error_type"]
    search_fields = ["message", "path"]

    @action(detail=False, methods=["post"], permission_classes=[IsInternalService], authentication_classes=[])
    def ingest(self, request):
        serializer = ErrorIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        entry = record_error(
            service=data["service"],
            path=data["path"],
            error_type=data["error_type"],
            message=data["message"],
            trace=data["traceback"],
            request_id=data["request_id"] or None,
        )
        return Response({"id": entry.pk if entry else None}, status=status.HTTP_201_CREATED)


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = AuditLog.objects.select_related("user")
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["action", "object_type", "object_id", "user"]
