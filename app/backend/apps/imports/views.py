from rest_framework import mixins, status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import record_action
from apps.core.permissions import RolePermission
from apps.users.scoping import ScopedQuerysetMixin

from .models import ImportJob
from .serializers import ImportJobSerializer, ImportUploadSerializer
from .services import AisImporter


class ImportJobViewSet(ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                       mixins.CreateModelMixin, viewsets.GenericViewSet):
    """POST — загрузка файла выгрузки (multipart: entity, file[, organization]); GET — журнал импорта."""

    queryset = ImportJob.objects.select_related("organization", "started_by")
    serializer_class = ImportJobSerializer
    permission_classes = [RolePermission]
    write_roles = ("superadmin", "local_admin")
    parser_classes = [MultiPartParser, FormParser]
    filterset_fields = ["entity", "status", "organization"]

    def create(self, request, *args, **kwargs):
        upload = ImportUploadSerializer(data=request.data, context={"request": request})
        upload.is_valid(raise_exception=True)
        data = upload.validated_data
        file = data["file"]
        job = AisImporter(data["entity"], data["organization"], request.user).run(file.read(), file.name)
        record_action(request, AuditLog.Action.IMPORT, job)
        code = status.HTTP_201_CREATED if job.status != ImportJob.Status.FAILED else status.HTTP_400_BAD_REQUEST
        return Response(ImportJobSerializer(job).data, status=code)
