from django.db.models import Q
from rest_framework import generics, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import RolePermission

from .models import Organization, ServiceOrganization, User
from .scoping import ScopedQuerysetMixin
from .serializers import MeSerializer, OrganizationSerializer, ServiceOrganizationSerializer, UserSerializer

ADMIN_ROLES = (User.Role.SUPERADMIN, User.Role.LOCAL_ADMIN)


class OrganizationViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer
    permission_classes = [RolePermission]
    write_roles = (User.Role.SUPERADMIN,)
    scope_organization_field = "pk"
    search_fields = ["name", "schema_name"]

    def check_permissions(self, request):
        if getattr(self, "action", "") == "pris_claimant":
            self.write_roles = (User.Role.SUPERADMIN, User.Role.LOCAL_ADMIN)
        super().check_permissions(request)

    @action(detail=True, methods=["get", "patch"], url_path="pris-claimant")
    def pris_claimant(self, request, pk=None):
        from apps.debts.services.pris_submit import CLAIMANT_KEYS

        org = self.get_object()
        stored = dict(org.pris_claimant or {})
        if request.method == "GET":
            return Response({"claimant": stored})
        incoming = request.data.get("claimant") if isinstance(request.data.get("claimant"), dict) else request.data
        if not isinstance(incoming, dict):
            raise ValidationError("Реквизиты взыскателя передаются объектом")
        for key in CLAIMANT_KEYS:
            if key in incoming:
                value = incoming.get(key)
                stored[key] = "" if value is None else str(value).strip()
        org.pris_claimant = stored
        org.save(update_fields=["pris_claimant", "updated_at"])
        return Response({"claimant": stored})


class ServiceOrganizationViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = ServiceOrganization.objects.select_related("organization")
    serializer_class = ServiceOrganizationSerializer
    permission_classes = [RolePermission]
    write_roles = ADMIN_ROLES
    filterset_fields = ["organization", "is_supplier", "is_active"]
    search_fields = ["short_name", "full_name"]

    def perform_create(self, serializer):
        if not self.request.user.is_superadmin:
            serializer.validated_data["organization"] = self.get_scope_organization()
        super().perform_create(serializer)


class UserViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = User.objects.select_related("organization").prefetch_related("service_organizations")
    serializer_class = UserSerializer
    permission_classes = [RolePermission]
    write_roles = ADMIN_ROLES
    filterset_fields = ["role", "organization", "is_active"]
    search_fields = ["username", "first_name", "middle_name", "last_name", "email"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superadmin:
            return qs
        return qs.filter(Q(pk=user.pk) | Q(role__in=[User.Role.SPECIALIST, User.Role.OBSERVER]))

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise PermissionDenied("Нельзя деактивировать свою учётную запись")
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        from apps.users.reassign import reassign_work

        reassign_work(instance)


class MeView(generics.RetrieveAPIView):
    serializer_class = MeSerializer

    def get_object(self):
        return self.request.user
