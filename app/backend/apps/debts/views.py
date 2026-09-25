from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import RolePermission
from apps.users.scoping import ScopedQuerysetMixin

from .filters import AccountFilter
from .models import Account, AccountService, Payment, Registration
from .repositories import AccountRepository
from .serializers import (
    AccountDetailSerializer,
    AccountListSerializer,
    AccountServiceSerializer,
    PaymentSerializer,
    RegistrationSerializer,
)


class AccountViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Реестр и карточка ЛС. Данные АИС создаются только импортом; изменяется лишь ручная группа."""

    queryset = Account.objects.all()
    permission_classes = [RolePermission]
    scope_provider_field = "provider_id"
    filterset_class = AccountFilter
    ordering_fields = ["client_account", "balance_out", "debt_group", "short_fio", "updated_at"]
    audit_view = True  # просмотр карточки ЛС фиксируется в журнале аудита (ТЗ 4.4.4)
    audit_list = True

    def get_queryset(self):
        qs = super().get_queryset()
        return AccountRepository(qs).registry() if self.action == "list" else qs

    def get_serializer_class(self):
        return AccountListSerializer if self.action == "list" else AccountDetailSerializer

    def _nested(self, related, serializer_class):
        account = self.get_object()
        page = self.paginate_queryset(getattr(account, related).all())
        data = serializer_class(page, many=True).data
        return self.get_paginated_response(data)

    @action(detail=True)
    def services(self, request, pk=None):
        return self._nested("services", AccountServiceSerializer)

    @action(detail=True)
    def payments(self, request, pk=None):
        return self._nested("payments", PaymentSerializer)

    @action(detail=True)
    def registrations(self, request, pk=None):
        return self._nested("registrations", RegistrationSerializer)

    @action(detail=False, url_path="group-summary")
    def group_summary(self, request):
        return Response(AccountRepository(self.filter_queryset(super().get_queryset())).group_summary())


class _ChildViewSet(ScopedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"


class AccountServiceViewSet(_ChildViewSet):
    queryset = AccountService.objects.select_related("account")
    serializer_class = AccountServiceSerializer
    filterset_fields = ["account", "service_id", "provider_id", "debt_group"]


class PaymentViewSet(_ChildViewSet):
    queryset = Payment.objects.select_related("account")
    serializer_class = PaymentSerializer
    filterset_fields = ["account", "service_id", "payment_type"]
    ordering_fields = ["pay_date", "pay_service_summ"]


class RegistrationViewSet(AuditedViewSetMixin, _ChildViewSet):
    queryset = Registration.objects.select_related("account")
    serializer_class = RegistrationSerializer
    audit_list = True
    filterset_fields = ["account", "subj_is_main", "subj_legal_entity"]
    search_fields = ["fam", "im", "personal_num"]
