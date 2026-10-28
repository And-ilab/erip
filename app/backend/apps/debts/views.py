import csv

from django.db.models import CharField, Count, IntegerField, OuterRef, Prefetch, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import record_action, record_query
from apps.core.permissions import RolePermission
from apps.users.scoping import AccessScope, ScopedQuerysetMixin

from .filters import AccountFilter, AccountOrderingFilter, ContractFilter, MeasureFilter
from .services.registration_flags import registration_count
from .models import (
    Account,
    AccountService,
    Attachment,
    Contact,
    DebtWorkItem,
    Measure,
    MeasureItem,
    Payment,
    RefreshRequest,
    Registration,
    RegistryPreference,
    SavedFilter,
    ServiceDebtPeriod,
    StatusHistory,
    Territory,
)
from .repositories import AccountRepository, supplier_annotations
from .services.charts import DebtCharts
from .serializers import (
    AccountDetailSerializer,
    AccountListSerializer,
    AccountServiceSerializer,
    AttachmentSerializer,
    BalanceHistorySerializer,
    ContactSerializer,
    DebtWorkItemSerializer,
    MeasureDetailSerializer,
    MeasureSerializer,
    PaymentSerializer,
    RefreshRequestSerializer,
    RegistrationSerializer,
    SavedFilterSerializer,
    StatusHistorySerializer,
)
from .services.column_layout import column_layout, save_column_layout
from .services.funnel import CLAIM_STAGE, FUNNEL_STAGES, attach_badges, claim_funnel_codes, stored_codes
from .services.contacts import choose_phone
from .services.registry import GROUP_LIMIT, REGISTRY_STATUSES, annotate_registry, build_matrix
from .services.territory import TerritoryIndex, TerritoryMap

ACCOUNT_COLUMNS = [
    "schema_label", "account_id", "client_account", "short_fio", "provider_short_name", "account_address",
    "payer_identifier", "payer_unp", "unified_account", "rating_label", "funnel_stage",
    "debt_started_on", "debt_total", "mulct_total", "obligation_total", "effective_group", "scenario_brief",
    "assigned_name", "ownership_type_name", "acc_category_full", "months_debt", "subj_count", "registered_count",
]
CONTRACT_PERSON_COLUMNS = [
    "payer", "payer_identifier", "payer_unp", "rating_label", "funnel_stage", "ls_count",
    "principal", "penalty", "obligation", "effective_group", "assigned_name", "ownership_type_name",
    "housing_object", "months_debt", "subj_count", "registered_count", "services_debt_count", "earliest",
    "contract_number", "contract_date", "service_provider", "initial_principal", "initial_penalty",
    "repayment_due_on", "last_payment_date", "category",
]
CONTRACT_SERVICE_COLUMNS = [
    "account_number", "address", "service_list_id", "start_date", "agreement_number",
    "service_name", "effective_group", "rating_label", "funnel_stage", "scenario_brief",
    "debt_started_on", "balance_out", "balance_mulct_out", "obligation_total",
    "initial_principal", "initial_penalty", "repayment_due_on", "last_payment_date",
    "payer", "idn_unp", "billing_provider", "shot_name", "category_name", "assigned_name",
    "ownership_type_name", "housing_object", "debt_period", "subj_count", "registered_count",
]


def _account_column_catalog(user) -> list[str]:
    from apps.users.identity import identity_columns

    flags = identity_columns(user)
    names = list(ACCOUNT_COLUMNS)
    if not flags["show_schema"]:
        names = [name for name in names if name != "schema_label"]
    if not flags["show_service_org"]:
        names = [name for name in names if name != "provider_short_name"]
    return names


def _service_column_catalog(user) -> list[str]:
    from apps.users.identity import identity_columns

    flags = identity_columns(user)
    hidden = set()
    if not flags["show_schema"]:
        hidden.add("schema_label")
    if not flags["show_supplier"]:
        hidden.add("shot_name")
    if not flags["show_service_org"]:
        hidden.add("billing_provider")
    return [name for name in CONTRACT_SERVICE_COLUMNS if name not in hidden]


def _remember_columns(pref, request, allowed: list[str]) -> tuple[list[str], list[str]]:
    if request.method == "PUT":
        return save_column_layout(pref, request.data.get("columns", []), allowed, request.data.get("order"))
    return column_layout(pref.columns, allowed)


# Порядок «Услуги» — как в замечании к карточке, затем остальные колонки файла.
# Месяцы, поставщик и группа — поля ПМ, по умолчанию скрыты.
CARD_SERVICE_COLUMNS = [
    "service_list_id", "service_id", "service_name", "provider_id", "shot_name",
    "start_date", "stop_date", "tarrif", "spent_fact", "calc_sum", "calc_result_sum",
    "calc_priv_sum", "mulct_sum", "recalc_sum", "netting_sum",
    "balance_in", "balance_mulct_in", "balance_mulct_out", "balance_out",
    "subs_pay", "calc_date", "mulct_recalc_sum", "overdue_debt", "debt_period",
    "share_service_summ", "share_mulct_summ",
    "report_group_id", "netting_mulct_sum", "ais_account_id", "calculation_id",
    "sort_code", "service_name_report", "full_name",
    "months_debt", "supplier", "debt_group",
]
CARD_SERVICE_HIDDEN = frozenset({"months_debt", "supplier", "debt_group"})
CARD_REGISTRATION_COLUMNS = [
    "payer", "registered", "beneficiary", "fam", "im", "ot", "check_in_date", "check_out_date",
    "date_registration", "passport_out", "move_reason", "reg_type_name", "relation", "family",
    "birthday", "death", "sex", "doc", "doc_num", "doc_date", "doc_organ", "doc_basis", "doc_code",
    "personal_num", "citizenship", "nationality", "address", "work", "position", "tab_number", "salary",
    "account_id", "person_id", "registration_id", "legal", "unp", "parent_id", "parent_name",
    "social_note", "marital", "rent", "social_category", "unemployed", "left_country",
    "bank_code", "bank_name", "bank_account", "payer_reg_id", "payer_name", "payer_share", "payer_type",
    "tenant_free", "doc1", "share1", "doc2", "share2", "doc3", "share3", "heritage",
    "heritage_accept", "heritage_open", "heritage_close", "phone", "email", "joint_owner",
    "cnt_benefit", "cnt_rent", "cnt_minor", "cnt_temp", "cnt_unreg", "cnt_absent",
    "cnt_distant", "cnt_close", "cnt_people", "cnt_payers", "cnt_pets",
]
CARD_PAYMENT_COLUMNS = [
    "ais_account_id", "client_account", "payer_reg_name", "account_address",
    "client_account_file", "client_name", "payer_address_file",
    "account_provider_id", "provider_short_name", "provider_id", "supplier_name",
    "service_id", "service_name", "receipt_id", "pay_date",
    "pay_service_summ", "pay_mulct_summ", "pay_total", "commission_summ",
    "share_service_sum", "share_mulct_sum", "unshared_sum", "payment_type_display",
    "otdel", "package_id", "pp_num", "bank_name", "bank_date", "notes",
    "package_status", "source_receipt_id", "refund_sum", "share_status", "execution_id",
]


def _supplier_ids(user):
    if getattr(user, "contour", "") != "supplier":
        return None
    return AccessScope(user).provider_ids()


def _debt_services_filter(user):
    """Услуги с остатком долга или пени. Поставщик считает только свои."""
    condition = Q(services__balance_out__gt=0) | Q(services__balance_mulct_out__gt=0) | Q(services__overdue_debt__gt=0)
    providers = _supplier_ids(user)
    if providers is None:
        return condition
    return condition & Q(services__provider_id__in=providers or [-1])


def _debt_sum(user):
    """В группировке поставщик суммирует сальдо своих услуг, а не общий долг лицевого счёта."""
    providers = _supplier_ids(user)
    if providers is None:
        return Sum("balance_out")
    return Sum("services__balance_out", filter=Q(services__provider_id__in=providers or [-1]))


def _penalty_sum(user):
    providers = _supplier_ids(user)
    if providers is None:
        return Sum("services__balance_mulct_out")
    return Sum("services__balance_mulct_out", filter=Q(services__provider_id__in=providers or [-1]))


def _line_join(lines, key: str) -> str:
    parts = []
    for line in lines or []:
        value = line.get(key)
        if value not in (None, ""):
            parts.append(str(value))
    return "; ".join(parts)


def _period_join(lines) -> str:
    parts = []
    for line in lines or []:
        name = line.get("service_name") or str(line.get("service_list_id") or "")
        for period in line.get("periods") or []:
            parts.append(
                f"{name} {period.get('period')}: долг {period.get('principal') or 0}, пеня {period.get('penalty') or 0}"
            )
    return "; ".join(parts)


def _group_rows(qs, field, user):
    """Долг лицевого счёта и суммы по услугам считаются разными запросами.

    Один JOIN к услугам умножил бы `balance_out` счёта на число услуг.
    """
    money = qs.values(field).annotate(
        accounts=Count("id", distinct=True),
        debt=_debt_sum(user),
    ).order_by(field)
    extras = {
        row[field]: row
        for row in qs.values(field).annotate(
            penalty=_penalty_sum(user),
            services=Count("services", filter=_debt_services_filter(user), distinct=True),
        )
    }
    packed = []
    for row in money:
        extra = extras.get(row[field], {})
        packed.append({
            "raw": row[field],
            "accounts": row["accounts"],
            "services": extra.get("services") or 0,
            "debt": row["debt"] or 0,
            "penalty": extra.get("penalty") or 0,
        })
    return packed


def _service_board_prefetch(user, *, with_periods: bool = True):
    """Услуги текущей страницы. Периоды нужны гриду, карточка канбана их не рисует."""
    from django.db.models import Prefetch

    services = AccountService.objects.order_by("service_name", "id").defer("raw")
    providers = _supplier_ids(user)
    if providers is not None:
        services = services.filter(provider_id__in=providers or [-1])
    if with_periods:
        services = services.prefetch_related(
            Prefetch("debt_periods", queryset=ServiceDebtPeriod.objects.order_by("period").defer("raw")),
        )
    return Prefetch("services", queryset=services)


def _services_for(user, account):
    qs = account.services.all()
    providers = _supplier_ids(user)
    if providers is not None:
        qs = qs.filter(provider_id__in=providers or [-1])
    return qs


def _visible_accounts(user):
    return AccessScope(user).apply(
        Account.objects.all(), "organization", "provider_id", "services__provider_id",
    )


def _supplier_measure_filter(user):
    """Своё мероприятие поставщика видно только ему. Общее мероприятие схемы — если в нём его услуга или услуг нет."""
    providers = _supplier_ids(user)
    if providers is None:
        return None
    allowed = providers or [-1]
    own = Q(owner_provider_id__in=allowed)
    shared = Q(owner_provider_id__isnull=True) & (
        Q(services__isnull=True) | Q(services__provider_id__in=allowed)
    )
    return own | shared


def _own_measures(user, account):
    """Мероприятия одного ЛС. Без подзапросов по всей схеме: должник уже известен."""
    qs = Measure.objects.filter(accounts=account).select_related("assignee", "created_by")
    supplier_filter = _supplier_measure_filter(user)
    if supplier_filter is not None:
        qs = qs.filter(supplier_filter).distinct()
    org_accounts = Q()
    org_items = Q()
    if not getattr(user, "is_superadmin", False) and getattr(user, "organization_id", None):
        org_accounts = Q(accounts__organization_id=user.organization_id)
        org_items = Q(items__account__organization_id=user.organization_id)
    return qs.annotate(
        accounts_count=Count("accounts", filter=org_accounts or None, distinct=True),
        items_total=Count("items", filter=org_items or None, distinct=True),
        items_done=Count(
            "items",
            filter=(org_items & Q(items__status=Measure.Status.DONE)) if org_items else Q(items__status=Measure.Status.DONE),
            distinct=True,
        ),
        debtor_name=Value(account.short_fio or "", output_field=CharField()),
        debtor_account=Value(account.client_account or "", output_field=CharField()),
        debtor_id=Value(account.id, output_field=IntegerField()),
        debtor_rating=Value(account.rating or "", output_field=CharField()),
        debtor_rating_repeat=Value(account.rating_repeat or 0, output_field=IntegerField()),
        debtor_debt_group=Value(account.debt_group, output_field=IntegerField(null=True)),
        debtor_debt_group_manual=Value(account.debt_group_manual, output_field=IntegerField(null=True)),
    ).prefetch_related(
        Prefetch("items", queryset=MeasureItem.objects.filter(account=account).defer("raw")),
    ).order_by("-created_at", "-id")


def _page_offset(raw) -> int:
    if raw in (None, ""):
        return 0
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({"offset": "Ожидается неотрицательное число"}) from None
    if value < 0:
        raise ValidationError({"offset": "Ожидается неотрицательное число"})
    return value


class AccountViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Реестр и карточка ЛС. Данные АИС создаются только импортом; правятся поля ПМ."""

    queryset = Account.objects.all()
    permission_classes = [RolePermission]
    scope_provider_field = "provider_id"
    scope_supplier_field = "services__provider_id"
    filterset_class = AccountFilter
    filter_backends = [DjangoFilterBackend, SearchFilter, AccountOrderingFilter]
    ordering_fields = [
        "client_account", "balance_out", "sort_group", "short_fio", "updated_at", "rating",
        "months_debt", "funnel_stage", "debt_started_on", "subj_count",
    ]
    audit_view = True
    audit_list = True

    def get_queryset(self):
        qs = super().get_queryset().select_related("organization")
        if self.action in {"list", "export", "kanban", "calendar"}:
            qs = AccountRepository(qs).registry()
        if self.action in {"list", "export"}:
            qs = qs.prefetch_related(_service_board_prefetch(self.request.user))
        elif self.action == "kanban":
            qs = qs.prefetch_related(_service_board_prefetch(self.request.user, with_periods=False))
        providers = _supplier_ids(self.request.user)
        # Суммы по услугам нужны строке списка. На карте и в группировке они
        # добавляют GROUP BY по лицевому счёту, и один населённый пункт
        # распадается на пузырь «1» для каждого счёта.
        if providers is not None and self.action in {"list", "export", "kanban", "retrieve"}:
            qs = qs.annotate(**supplier_annotations(list(providers)))
        if "bucket" in self.request.query_params:
            from apps.debts.services.group_buckets import restrict_account_bucket

            qs = restrict_account_bucket(
                qs,
                self.request.query_params.get("group_by") or "",
                self.request.query_params.get("bucket") or "",
            )
        return qs

    def get_serializer_class(self):
        return AccountListSerializer if self.action in {"list", "kanban"} else AccountDetailSerializer

    def _nested(self, related, serializer_class, queryset=None):
        account = self.get_object()
        qs = account.work_items.none() if queryset is None else queryset
        if related:
            qs = getattr(account, related).all()
        page = self.paginate_queryset(qs)
        data = serializer_class(page, many=True, context=self.get_serializer_context()).data
        return self.get_paginated_response(data)

    @action(detail=True, url_path="debt-shares")
    def debt_shares(self, request, pk=None):
        from apps.debts.services.shares import sync_debt_shares, visible_shares

        account = self.get_object()
        sync_debt_shares(account)
        return Response(visible_shares(account, request.user))

    @action(detail=True)
    def services(self, request, pk=None):
        from decimal import Decimal

        from django.db.models import Q

        qs = _services_for(request.user, self.get_object()).select_related(
            "account__organization", "account__assigned_to", "account__debtor_category",
            "account__scenario_run__scenario",
        ).defer("raw").prefetch_related(
            Prefetch("debt_periods", queryset=ServiceDebtPeriod.objects.order_by("period").defer("raw")),
        )
        if request.query_params.get("with_debt") == "1":
            qs = qs.filter(
                Q(balance_out__gt=Decimal("0")) | Q(balance_mulct_out__gt=Decimal("0")) | Q(overdue_debt__gt=0)
            )
        return self._nested("", AccountServiceSerializer, qs)

    @action(detail=True)
    def payments(self, request, pk=None):
        account = self.get_object()
        qs = account.payments.select_related("account")
        if getattr(request.user, "contour", "") == "supplier":
            providers = AccessScope(request.user).provider_ids()
            if providers:
                qs = qs.filter(provider_id__in=providers)
        return self._nested("", PaymentSerializer, qs)

    @action(detail=True)
    def registrations(self, request, pk=None):
        account = self.get_object()
        return self._nested("", RegistrationSerializer, account.registrations.select_related("account"))

    @action(detail=True)
    def contacts(self, request, pk=None):
        return self._nested("contacts", ContactSerializer)

    @action(detail=True, url_path="balance-history")
    def balance_history(self, request, pk=None):
        account = self.get_object()
        qs = account.balance_history.select_related("service").defer("raw", "service__raw")
        service_ids = _services_for(request.user, account).values_list("pk", flat=True)
        return self._nested("", BalanceHistorySerializer, qs.filter(service_id__in=service_ids))

    @action(detail=True, url_path="status-history")
    def status_history(self, request, pk=None):
        account = self.get_object()
        qs = account.status_history.select_related("service", "author").defer("raw", "service__raw")
        providers = _supplier_ids(request.user)
        if providers is not None:
            qs = qs.filter(Q(service__isnull=True) | Q(service__provider_id__in=providers or [-1]))
        return self._nested("", StatusHistorySerializer, qs)

    @action(detail=True, url_path="work-items")
    def work_items(self, request, pk=None):
        account = self.get_object()
        qs = account.work_items.all()
        providers = _supplier_ids(request.user)
        if providers is not None:
            qs = qs.filter(Q(service__isnull=True) | Q(service__provider_id__in=providers or [-1]))
        kind = request.query_params.get("kind")
        if kind:
            qs = qs.filter(kind=kind)
        kinds = request.query_params.get("kinds")
        if kinds:
            qs = qs.filter(kind__in=[item for item in kinds.split(",") if item])
        for name, lookup in (
            ("principal_min", "principal__gte"),
            ("principal_max", "principal__lte"),
            ("penalty_min", "penalty__gte"),
            ("paid_min", "paid_principal__gte"),
            ("started_from", "started_on__gte"),
            ("started_to", "started_on__lte"),
            ("ended_from", "ended_on__gte"),
            ("ended_to", "ended_on__lte"),
        ):
            value = request.query_params.get(name)
            if value:
                qs = qs.filter(**{lookup: value})
        return self._nested("", DebtWorkItemSerializer, qs)

    @action(detail=True)
    def attachments(self, request, pk=None):
        account = self.get_object()
        qs = account.attachments.all()
        providers = _supplier_ids(request.user)
        if providers is not None:
            qs = qs.filter(
                Q(work_item__isnull=True) | Q(work_item__service__isnull=True)
                | Q(work_item__service__provider_id__in=providers or [-1])
            )
        page = self.paginate_queryset(qs)
        rows = list(AttachmentSerializer(
            page if page is not None else qs, many=True, context=self.get_serializer_context(),
        ).data)
        from .models import ClaimPackageDocument

        documents = ClaimPackageDocument.objects.filter(package__case__account=account).select_related("package__case")
        for doc in documents:
            rows.append({
                "id": f"package-{doc.pk}",
                "account": account.pk,
                "work_item": None,
                "doc_type": doc.doc_type,
                "original_name": doc.file_name,
                "uploaded_by": None,
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "package": True,
                "claim_id": doc.package.case_id,
                "doc_id": doc.pk,
            })
        if page is not None:
            return self.get_paginated_response(rows)
        return Response(rows)

    @action(detail=True, methods=["get", "post"], url_path="writ-draft")
    def writ_draft(self, request, pk=None):
        from apps.debts.services.claims import case_payload
        from apps.debts.services.writ_draft import create_writ, writ_preview

        account = self.get_object()
        if request.method == "GET":
            keys = ("debt_from", "debt_to", "warning_delivered_on", "non_delivery_act_on")
            payload = {key: request.query_params.get(key, "") for key in keys} if any(
                key in request.query_params for key in keys
            ) else None
            return Response(writ_preview(account, payload))
        case = create_writ(account, request.user, request.data)
        return Response(case_payload(case), status=status.HTTP_201_CREATED)

    @action(detail=True)
    def scenario(self, request, pk=None):
        from apps.debts.services.scenario_board import scenario_outline

        account = self.get_object()
        account = Account.objects.prefetch_related(
            "measures__tasks__checks", "measures__tasks__assignee",
            "measures__items__call_attempts",
        ).get(pk=account.pk)
        return Response(scenario_outline(account))

    @action(detail=True, url_path="dial-number")
    def dial_number(self, request, pk=None):
        account = self.get_object()
        contact = choose_phone(account)
        if contact is None:
            return Response({"contact": None})
        return Response({"contact": ContactSerializer(contact).data})

    @action(detail=True, methods=["post"])
    def refresh(self, request, pk=None):
        from apps.debts.services.portfolio import PortfolioRefresher

        account = self.get_object()
        pending = RefreshRequest.objects.create(
            organization=account.organization, account=account, requested_by=request.user,
        )
        PortfolioRefresher().refresh_account(account)
        pending.refresh_from_db()
        return Response(RefreshRequestSerializer(pending).data)

    @action(detail=True)
    def measures(self, request, pk=None):
        from apps.debts.services.claim_measures import backfill_account

        account = self.get_object()
        backfill_account(account)
        return self._nested("", MeasureSerializer, _own_measures(request.user, account))

    @action(detail=True, methods=["post"], url_path="skip-step")
    def skip_step(self, request, pk=None):
        from apps.nsi.services.scenario_engine import skip_current_step
        from apps.debts.services.measures import MeasureLaunchError

        account = self.get_object()
        try:
            run = skip_current_step(account, request.user, str(request.data.get("reason") or ""))
        except MeasureLaunchError as exc:
            detail = exc.detail
            if isinstance(detail, dict) and "skip" in detail and "Пропуск доступен" in str(detail["skip"]):
                raise PermissionDenied(detail["skip"]) from exc
            raise ValidationError(detail) from exc
        record_action(request, AuditLog.Action.UPDATE, run, after={"skipped": run.skipped_orders})
        return Response({
            "account": account.pk, "skipped": run.skipped_orders, "last_skip": run.last_skip, "paused": run.paused,
        })

    @action(detail=True, methods=["get", "post"], url_path="writ-checks")
    def writ_checks(self, request, pk=None):
        from apps.debts.services.artifacts import ensure_writ_checks

        account = self.get_object()
        ensure_writ_checks(account)
        if request.method == "POST":
            code = request.data.get("code")
            row = account.writ_checks.filter(code=code).first()
            if row is None:
                raise ValidationError({"code": "Неизвестный пункт"})
            row.done = bool(request.data.get("done"))
            row.save(update_fields=["done", "updated_at"])
        rows = account.writ_checks.all()
        return Response([
            {"code": row.code, "title": row.title, "done": row.done} for row in rows
        ])

    @action(detail=False, url_path="group-summary")
    def group_summary(self, request):
        return Response(AccountRepository(self.filter_queryset(super().get_queryset())).group_summary())

    @action(detail=False)
    def charts(self, request):
        accounts = self.filter_queryset(self.get_queryset())
        scope = (request.query_params.get("scope") or "").strip()
        if scope == "measures":
            accounts = accounts.filter(measures__isnull=False).distinct()
        elif scope == "claims":
            from .services.claims import claims_population

            accounts = claims_population(accounts)
        elif scope == "contracts":
            accounts = accounts.filter(services__isnull=False).distinct()
        payload = DebtCharts(accounts, _supplier_ids(request.user)).build()
        record_query(request, "debts.Account", count=payload["cases"])
        return Response(payload)

    @action(detail=False)
    def map(self, request):
        raw = request.query_params.get("parent")
        parent = None
        if raw:
            if not str(raw).isdigit():
                raise ValidationError({"parent": "Неизвестный узел"})
            parent = get_object_or_404(Territory, pk=int(raw))
        accounts = self.filter_queryset(self.get_queryset())
        pending = accounts.filter(territory__isnull=True).exclude(house_address="", account_address="")
        if pending.exists():
            TerritoryIndex().assign_queryset(pending)
        return Response(TerritoryMap().level(accounts, parent))

    @action(detail=False)
    def kanban(self, request):
        page_size = min(int(request.query_params.get("page_size") or 100), 200)
        page = max(int(request.query_params.get("page") or 1), 1)
        base = AccountRepository.with_board_marks(self.filter_queryset(self.get_queryset()))
        start = (page - 1) * page_size
        scope = (request.query_params.get("scope") or "").strip()
        if scope == "claims":
            from apps.debts.models import ClaimCase

            stages = [("queue", "К взысканию"), *list(ClaimCase.Stage.choices)]
        else:
            stages = FUNNEL_STAGES
        columns = []
        linked = claim_funnel_codes() if scope == "claims" else []
        for code, title in stages:
            if scope == "claims" and code == "queue":
                stage_qs = base.exclude(funnel_stage__in=linked).filter(claim_case__isnull=True)
            elif scope == "claims":
                account_stage = CLAIM_STAGE.get(code, "")
                stage_qs = base.filter(
                    Q(funnel_stage__in=stored_codes(account_stage))
                    | (Q(claim_case__stage=code) & ~Q(funnel_stage__in=linked))
                ) if account_stage else base.none()
            else:
                stage_qs = base.filter(funnel_stage__in=stored_codes(code))
            total = stage_qs.count()
            cards = AccountListSerializer(
                stage_qs[start:start + page_size],
                many=True,
                context={**self.get_serializer_context(), "with_periods": False},
            ).data
            if scope == "claims":
                case_ids = {}
                if cards:
                    case_ids = dict(
                        ClaimCase.objects.filter(account_id__in=[row["id"] for row in cards])
                        .order_by("id")
                        .values_list("account_id", "id")
                    )
                for row in cards:
                    row["claim_id"] = case_ids.get(row["id"])
                    row["claim_stage"] = code
            columns.append({"stage": code, "title": title, "total": total, "cards": cards})
        if scope != "claims":
            attach_badges([card for column in columns for card in column["cards"]])
        return Response(columns)

    @action(detail=True, methods=["get", "post"])
    def activities(self, request, pk=None):
        from .services.activities import activity_board, perform_activity

        account = self.get_object()
        if request.method == "GET":
            return Response(activity_board(account))
        try:
            activity_id = int(request.data.get("id") or 0)
        except (TypeError, ValueError):
            raise ValidationError({"id": "Укажите пункт активности"}) from None
        board = perform_activity(
            account, request.user, activity_id,
            str(request.data.get("note") or ""),
            request.FILES.get("file"),
        )
        return Response(board)

    @action(detail=False)
    def grouped(self, request):
        from django.db.models.functions import Coalesce, TruncMonth

        key = request.query_params.get("group_by") or "debt_group"
        qs = self.filter_queryset(self.get_queryset())
        if key == "period":
            rows = _group_rows(qs.annotate(bucket=TruncMonth("debt_started_on")), "bucket", request.user)
            return Response([
                {
                    "value": row["raw"].isoformat() if row["raw"] else "",
                    "accounts": row["accounts"], "services": row["services"],
                    "debt": row["debt"], "penalty": row["penalty"],
                }
                for row in rows
            ])
        if key == "specialist":
            from apps.debts.services.assignees import specialist_label

            rows = _group_rows(qs.annotate(specialist_name=specialist_label()), "specialist_name", request.user)
            return Response([
                {
                    "value": (row["raw"] or "").strip(),
                    "accounts": row["accounts"], "services": row["services"],
                    "debt": row["debt"], "penalty": row["penalty"],
                }
                for row in rows
            ])
        fields = {
            "debt_group": "sort_group",
            "rating": "rating",
            "provider": "provider_short_name",
            "schema": "organization__name",
            "category": "debtor_category__name",
            "ownership": "ownership_type_name",
            "housing": "acc_category_full",
            "months": "months_debt",
            "residents": "subj_count",
        }
        field = fields.get(key)
        if field is None:
            raise ValidationError({"group_by": "Неизвестное поле группировки"})
        if key == "debt_group":
            qs = qs.annotate(sort_group=Coalesce("debt_group_manual", "debt_group"))
        return Response([
            {
                "value": "" if row["raw"] is None else str(row["raw"]),
                "accounts": row["accounts"], "services": row["services"],
                "debt": row["debt"], "penalty": row["penalty"],
            }
            for row in _group_rows(qs, field, request.user)
        ])

    @action(detail=False)
    def specialists(self, request):
        from apps.debts.services.assignees import specialist_choices

        return Response(specialist_choices(self.get_queryset()))

    @action(detail=False)
    def calendar(self, request):
        from .models import CalendarNote
        from .services.calendar import account_calendar, resolve_span

        start, end = resolve_span(request.query_params)
        events = account_calendar(self.filter_queryset(self.get_queryset()), start, end)
        org_id = getattr(request.user, "organization_id", None)
        if org_id:
            for note in CalendarNote.objects.filter(organization_id=org_id, day__gte=start, day__lt=end):
                events.append({
                    "date": note.day.isoformat(),
                    "due": note.day.isoformat(),
                    "kind": "Заметка",
                    "title": note.text,
                    "urgency": "planned",
                    "note_id": note.pk,
                })
        return Response(events)

    @action(detail=False, methods=["post"], url_path="calendar-notes")
    def calendar_notes(self, request):
        from .models import CalendarNote
        from .services.calendar import _parse

        text = str(request.data.get("text") or "").strip()
        if not text:
            raise ValidationError({"text": "Введите текст заметки"})
        if not getattr(request.user, "organization_id", None):
            raise ValidationError({"organization": "Заметка пишется в схему пользователя"})
        day = _parse(str(request.data.get("day") or ""), "day")
        note = CalendarNote.objects.create(
            organization_id=request.user.organization_id, author=request.user, day=day, text=text[:500],
        )
        return Response({"id": note.pk, "day": note.day.isoformat(), "text": note.text}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="start-scenario")
    def start_scenario(self, request):
        from .services.scenario_flow import start_accounts

        count = start_accounts(self._chosen_accounts(request), request.user)
        return Response({"started": count})

    @action(detail=False, methods=["post"], url_path="change-scenario")
    def change_scenario(self, request):
        from apps.nsi.models import ScenarioDefinition

        from .services.measures import MeasureLaunchError
        from .services.scenario_flow import replace_accounts

        scenario = ScenarioDefinition.objects.filter(pk=request.data.get("scenario_id"), status=ScenarioDefinition.Status.ACTIVE).first()
        if scenario is None:
            raise ValidationError({"scenario_id": "Выберите сценарий из справочника"})
        try:
            count = replace_accounts(self._chosen_accounts(request), scenario, request.user)
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        return Response({"changed": count})

    @action(detail=False, methods=["post"], url_path="assign-legal")
    def assign_legal(self, request):
        from apps.users.models import User

        from .services.measures import MeasureLaunchError
        from .services.scenario_flow import assign_legal as pin_legal

        person = User.objects.filter(pk=request.data.get("user_id"), is_active=True).first()
        if person is None:
            raise ValidationError({"user_id": "Выберите специалиста ЮС"})
        try:
            count = pin_legal(self._chosen_accounts(request), person, request.user)
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        return Response({"assigned": count})

    @action(detail=True, methods=["post"], url_path="stop-measure")
    def stop_measure(self, request, pk=None):
        from .services.measures import MeasureLaunchError
        from .services.scenario_flow import stop_measure as close_step

        account = self.get_object()
        measure = account.measures.filter(pk=request.data.get("measure_id")).first()
        if measure is None:
            raise ValidationError({"measure_id": "Мероприятие не найдено"})
        try:
            close_step(account, measure, request.user)
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        return Response({"finished_on": measure.finished_on.isoformat() if measure.finished_on else None})

    @action(detail=False)
    def export(self, request):
        rows = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="accounts.csv"'
        response.write("\ufeff")
        writer = csv.writer(response, delimiter=";")
        headers = [
            "ID ЛС", "Номер ЛС", "Уникальный единый номер (УЕН)",
            "Обслуживающая организация", "Адрес",
            "ФИО плательщика / Наименование юридического лица", "Идентификационный номер (ИН)",
            "Учётный номер плательщика (УНП)",
            "Рейтинг должника", "Наиболее ранний период возникновения долга", "Сумма основного долга", "Сумма пени",
            "Суммарный долг по всем услугам ЛС",
            "Группа задолженности", "Сценарий", "Этап воронки взыскания",
            "Закреплённый специалист", "Тип собственности", "Тип объекта жилфонда", "Кол-во месяцев долга",
            "Кол-во проживающих", "Кол-во зарегистрированных",
        ]
        writer.writerow(headers)
        stage_titles = dict(FUNNEL_STAGES)
        for account in rows:
            packed = AccountListSerializer(account, context={"request": request}).data
            writer.writerow([
                account.account_id, account.client_account, account.unified_account or "", account.provider_short_name,
                account.account_address, account.short_fio, account.payer_identifier, account.payer_unp,
                packed["rating_label"], account.debt_started_on or "",
                packed["debt_total"], packed["mulct_total"], packed["obligation_total"],
                account.effective_group or "", packed["scenario_brief"],
                stage_titles.get(account.funnel_stage, account.funnel_stage),
                packed["assigned_name"], account.ownership_type_name, account.acc_category_full,
                account.months_debt if account.months_debt is not None else "",
                account.subj_count if account.subj_count is not None else "",
                packed.get("registered_count") if packed.get("registered_count") is not None else "",
            ])
        return response

    @action(detail=False, methods=["get", "put"], url_path="columns")
    def columns(self, request):
        allowed = _account_column_catalog(request.user)
        pref, _created = RegistryPreference.objects.get_or_create(
            user=request.user, target="accounts", defaults={"columns": allowed},
        )
        chosen, order = _remember_columns(pref, request, allowed)
        return Response({"columns": chosen, "available": allowed, "order": order})

    @action(detail=False, methods=["get", "put"], url_path="card-columns")
    def card_columns(self, request):
        """Столбцы вкладок «Услуги» и «Оплата». Набор хранится у пользователя, не в браузере."""
        from .services.column_layout import explicit_layout

        board = request.query_params.get("board") or request.data.get("board") or "services"
        if board == "services":
            allowed = list(CARD_SERVICE_COLUMNS)
            hidden = CARD_SERVICE_HIDDEN
            target = "card_services"
        elif board == "payments":
            allowed = list(CARD_PAYMENT_COLUMNS)
            hidden = frozenset()
            target = "card_payments"
        elif board == "registration":
            allowed = list(CARD_REGISTRATION_COLUMNS)
            hidden = frozenset()
            target = "card_registration"
        else:
            raise ValidationError({"board": "services, payments или registration"})
        pref, _created = RegistryPreference.objects.get_or_create(
            user=request.user, target=target, defaults={"columns": explicit_layout(allowed, hidden)},
        )
        chosen, order = _remember_columns(pref, request, allowed)
        return Response({"columns": chosen, "available": allowed, "order": order, "board": board})

    @action(detail=False, methods=["post"], url_path="extra-measures")
    def extra_measures(self, request):
        from .services.extra_measures import ExtraMeasureError, add_extra

        try:
            measure = add_extra(request.user, request.data)
        except ExtraMeasureError as exc:
            raise ValidationError(exc.detail) from exc
        record_action(
            request, AuditLog.Action.CREATE, measure,
            after={"kind": measure.kind, "accounts": measure.accounts.count(), "extra": True},
        )
        return Response({"id": measure.id, "name": measure.template_name}, status=status.HTTP_201_CREATED)

    def _chosen_accounts(self, request):
        base = self.get_queryset()
        if request.data.get("all_matching"):
            return list(AccountFilter(request.data.get("filters") or {}, queryset=base).qs)
        ids = request.data.get("account_ids") or []
        return list(base.filter(pk__in=ids))


class _ChildViewSet(ScopedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "provider_id"


class AccountServiceViewSet(_ChildViewSet):
    queryset = AccountService.objects.select_related("account")
    serializer_class = AccountServiceSerializer
    filterset_fields = ["account", "service_id", "provider_id", "debt_group"]

    @action(detail=False)
    def choices(self, request):
        """Виды услуг контура: один пункт на код услуги АИС, без строки на каждый лицевой счёт."""
        rows = (
            self.get_queryset()
            .order_by()
            .values("service_id", "service_name")
            .distinct()
            .order_by("service_name", "service_id")
        )
        return Response({
            "results": [
                {"service_id": row["service_id"], "service_name": row["service_name"] or str(row["service_id"])}
                for row in rows
            ],
        })


class PaymentViewSet(_ChildViewSet):
    queryset = Payment.objects.select_related("account")
    serializer_class = PaymentSerializer
    filterset_fields = ["account", "service_id", "payment_type"]
    ordering_fields = ["pay_date", "pay_service_summ"]


class RegistrationViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                          mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = Registration.objects.select_related("account")
    serializer_class = RegistrationSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    audit_list = True
    filterset_fields = ["account", "subj_is_main", "subj_legal_entity"]
    search_fields = ["fam", "im", "personal_num"]

    def perform_update(self, serializer):
        before = serializer.instance
        old = " | ".join([
            before.social_category, "нетрудоспособен" if before.unfit_for_work else "", before.heritage_transfer,
        ])
        super().perform_update(serializer)
        row = serializer.instance
        new = " | ".join([
            row.social_category, "нетрудоспособен" if row.unfit_for_work else "", row.heritage_transfer,
        ])
        if old != new:
            StatusHistory.objects.create(
                organization=row.organization, account=row.account, kind=StatusHistory.Kind.REGISTRATION,
                old_value=old.strip(" |"), new_value=new.strip(" |"), reason=str(row),
                author=self.request.user,
            )


class ContractViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                      mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Реестр и карточка задолженности по договору поставщика."""

    queryset = AccountService.objects.select_related(
        "account", "account__debtor_category", "account__organization", "account__assigned_to",
        "account__scenario_run__scenario",
    ).defer("raw", "account__raw").annotate(
        registered_count=registration_count("account_id", "active"),
        resident_count=registration_count("account_id", "resident"),
    ).prefetch_related(
        Prefetch("debt_periods", queryset=ServiceDebtPeriod.objects.order_by("period").defer("raw")),
    )
    serializer_class = AccountServiceSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "provider_id"
    filterset_class = ContractFilter
    search_fields = [
        "service_name", "shot_name", "agreement_number", "account__short_fio", "account__client_account",
        "account__account_address", "account__payer_identifier", "account__payer_unp",
    ]
    ordering_fields = ["debt_group", "balance_out", "debt_started_on", "service_name"]
    audit_view = True
    audit_list = True

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        from apps.users.access import can_open_contracts

        if not can_open_contracts(request.user):
            raise PermissionDenied("Реестр договоров этой роли недоступен")

    def get_queryset(self):
        qs = super().get_queryset()
        if "bucket" in self.request.query_params:
            from apps.debts.services.group_buckets import restrict_service_bucket

            qs = restrict_service_bucket(
                qs,
                self.request.query_params.get("group_by") or "",
                self.request.query_params.get("bucket") or "",
            )
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self._visible()
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def _owed(self, qs):
        return qs.filter(Q(balance_out__gt=0) | Q(balance_mulct_out__gt=0) | Q(overdue_debt__gt=0))

    def _visible(self):
        return self._owed(self.filter_queryset(self.get_queryset()))

    @action(detail=False, methods=["get", "put"], url_path="columns")
    def columns(self, request):
        board = request.query_params.get("board") or request.data.get("board") or "persons"
        if board == "services":
            allowed = _service_column_catalog(request.user)
            target = "contract_services"
        elif board == "persons":
            allowed = list(CONTRACT_PERSON_COLUMNS)
            target = "contract_persons"
        else:
            raise ValidationError({"board": "persons или services"})
        pref, _created = RegistryPreference.objects.get_or_create(
            user=request.user, target=target, defaults={"columns": allowed},
        )
        chosen, order = _remember_columns(pref, request, allowed)
        return Response({"columns": chosen, "available": allowed, "order": order, "board": board})

    @action(detail=False)
    def summary(self, request):
        from .services.contracts import supplier_portfolio

        return Response(supplier_portfolio(self._visible()))

    @action(detail=False)
    def persons(self, request):
        from .services.contracts import bounded_int, person_page

        page_size = bounded_int(request.query_params.get("page_size"), 50, maximum=200, field="page_size")
        page = bounded_int(request.query_params.get("page"), 1, field="page")
        supplier = getattr(request.user, "contour", "") == "supplier"
        total, rows = person_page(self._visible(), page, page_size, supplier=supplier)
        return Response({"count": total, "results": rows})

    @action(detail=False)
    def kanban(self, request):
        from .services.contracts import bounded_int, kanban_columns

        page_size = bounded_int(request.query_params.get("page_size"), 100, maximum=200, field="page_size")
        page = bounded_int(request.query_params.get("page"), 1, field="page")
        supplier = getattr(request.user, "contour", "") == "supplier"
        return Response(kanban_columns(self._visible(), FUNNEL_STAGES, page, page_size, supplier=supplier))

    @action(detail=False, methods=["post"])
    def stage(self, request):
        from .services.contracts import move_stage

        raw_ids = request.data.get("account_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise ValidationError({"account_ids": "Укажите лицевые счета"})
        try:
            wanted = {int(item) for item in raw_ids}
        except (TypeError, ValueError):
            raise ValidationError({"account_ids": "Укажите лицевые счета"}) from None
        chosen = list(Account.objects.filter(services__in=self._visible(), pk__in=wanted).distinct())
        if {account.pk for account in chosen} != wanted:
            raise NotFound()
        move_stage(
            request.user, chosen, request.data.get("funnel_stage") or "",
            str(request.data.get("funnel_reason") or ""),
        )
        return Response({"status": "ok"})

    @action(detail=False)
    def calendar(self, request):
        from .services.calendar import contract_calendar, resolve_span

        start, end = resolve_span(request.query_params)
        return Response(contract_calendar(self._visible().select_related("account"), start, end))

    @action(detail=False, methods=["post"])
    def events(self, request):
        from .services.measures import MeasureLaunchError, launch_measure

        visible = self._visible()
        accounts = list(
            Account.objects.filter(pk__in=visible.values("account_id")).distinct().prefetch_related(
                "contacts", "registrations", "services",
            )
        )
        catalog = request.data.get("catalog_service_ids") or []
        services = list(visible.filter(service_id__in=catalog)) if catalog else []
        try:
            result = launch_measure(request.user, accounts, services, request.data)
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        measure = result["measure"]
        record_action(
            request, AuditLog.Action.CREATE, measure,
            after={"kind": measure.kind, "accounts": measure.accounts.count(), "source": "calendar"},
        )
        return Response(
            {"id": measure.id, "kind_display": measure.get_kind_display()},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False)
    def grouped(self, request):
        key = request.query_params.get("group_by") or "debt_group"
        qs = self._visible()
        owed = Q(balance_out__gt=0) | Q(balance_mulct_out__gt=0) | Q(overdue_debt__gt=0)
        totals = {
            "accounts": Count("account", distinct=True),
            "services": Count("id", filter=owed),
            "debt": Sum("balance_out"),
            "penalty": Sum("balance_mulct_out"),
        }
        if key == "period":
            from django.db.models.functions import TruncMonth

            rows = (
                qs.annotate(bucket=TruncMonth("debt_started_on"))
                .values("bucket")
                .annotate(**totals)
                .order_by("bucket")
            )
            return Response([
                {
                    "value": row["bucket"].isoformat() if row["bucket"] else "",
                    "accounts": row["accounts"], "services": row["services"],
                    "debt": row["debt"], "penalty": row["penalty"],
                }
                for row in rows
            ])
        if key == "specialist":
            from apps.debts.services.assignees import specialist_label

            field = "specialist_name"
            qs = qs.annotate(specialist_name=specialist_label("account__"))
        elif key == "debt_group":
            qs = qs.annotate(sort_group=Coalesce("debt_group_manual", "debt_group"))
            field = "sort_group"
        else:
            fields = {
                "provider": "shot_name",
                "schema": "account__organization__name",
                "category": "account__debtor_category__name",
                "billing": "account__provider_short_name",
                "ownership": "account__ownership_type_name",
                "housing": "account__acc_category_full",
                "months": "debt_period",
                "residents": "account__subj_count",
            }
            field = fields.get(key)
            if field is None:
                raise ValidationError({"group_by": "Неизвестное поле группировки"})
        rows = qs.values(field).annotate(**totals).order_by(field)
        return Response([
            {
                "value": "" if row[field] is None else str(row[field]),
                "accounts": row["accounts"], "services": row["services"],
                "debt": row["debt"], "penalty": row["penalty"],
            }
            for row in rows
        ])

    @action(detail=True, methods=["post"], url_path="extra-measure")
    def extra_measure(self, request, pk=None):
        from .services.extra_measures import ExtraMeasureError, add_extra

        service = self.get_object()
        payload = dict(request.data)
        payload["account_ids"] = [service.account_id]
        payload["service_id"] = service.id
        try:
            measure = add_extra(request.user, payload)
        except ExtraMeasureError as exc:
            raise ValidationError(exc.detail) from exc
        record_action(
            request, AuditLog.Action.CREATE, measure,
            after={"kind": measure.kind, "service": service.id, "extra": True},
        )
        return Response({"id": measure.id, "name": measure.template_name}, status=status.HTTP_201_CREATED)

    @action(detail=True)
    def dossier(self, request, pk=None):
        from .services.portfolio import debtor_peers

        service = self.get_object()
        peers = debtor_peers(service.account)
        services = AccessScope(request.user).apply(
            AccountService.objects.filter(account__in=peers).select_related(
                "account", "account__debtor_category", "account__organization",
            ),
            "organization", "account__provider_id", "provider_id",
        )
        account_ids = list(services.values_list("account_id", flat=True).distinct())
        people = Registration.objects.filter(account_id__in=account_ids)
        contacts = Contact.objects.filter(account_id__in=account_ids).select_related("registration")
        periods = ServiceDebtPeriod.objects.filter(service__in=services).select_related("service")
        measures = Measure.objects.filter(services__in=services).distinct()
        journal = StatusHistory.objects.filter(account_id__in=account_ids).filter(
            Q(service__isnull=True) | Q(service__in=services)
        ).select_related("author", "service")
        account = service.account
        sums = services.filter(account=account).aggregate(
            principal=Sum("balance_out"), penalty=Sum("balance_mulct_out"),
        )
        account.supplier_principal = sums["principal"] or 0
        account.supplier_penalty = sums["penalty"] or 0
        return Response({
            "contract": AccountServiceSerializer(service).data,
            "services": AccountServiceSerializer(services, many=True).data,
            "people": RegistrationSerializer(people, many=True, context=self.get_serializer_context()).data,
            "contacts": ContactSerializer(contacts, many=True).data,
            "periods": [
                {
                    "service_id": row.service_id, "service_name": row.service.service_name,
                    "period": row.period, "principal": row.principal, "penalty": row.penalty,
                    "due_on": row.due_on, "started_on": row.started_on,
                }
                for row in periods
            ],
            "measures": MeasureSerializer(measures, many=True).data,
            "journal": StatusHistorySerializer(journal[:100], many=True).data,
            "account": AccountDetailSerializer(account, context=self.get_serializer_context()).data,
        })


class ContactViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = Contact.objects.select_related("account")
    serializer_class = ContactSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    filterset_fields = ["account", "source", "kind"]

    def _contact_history(self, account, old: str, new: str, reason: str):
        StatusHistory.objects.create(
            organization=account.organization, account=account, kind=StatusHistory.Kind.CONTACT,
            old_value=old, new_value=new, reason=reason, author=self.request.user,
        )

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, serializer.validated_data["account"].pk)
        serializer.save(organization=account.organization, account=account, source=Contact.Source.PM)
        from apps.audit.models import AuditLog
        from apps.audit.services import record_action

        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)
        row = serializer.instance
        self._contact_history(account, "", f"{row.kind}: {row.value}", "Контакт внесён в ПМ")

    def perform_update(self, serializer):
        before = serializer.instance
        old = f"{before.kind}: {before.value}"
        super().perform_update(serializer)
        row = serializer.instance
        self._contact_history(row.account, old, f"{row.kind}: {row.value}", "Правка контакта ПМ")

    def perform_destroy(self, instance):
        if instance.source == Contact.Source.AIS:
            raise ValidationError("Контакт из АИС нельзя удалить")
        self._contact_history(instance.account, f"{instance.kind}: {instance.value}", "", "Удаление контакта ПМ")
        super().perform_destroy(instance)


class DebtWorkItemViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = DebtWorkItem.objects.select_related("account")
    serializer_class = DebtWorkItemSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    filterset_fields = ["account", "kind"]

    def get_queryset(self):
        qs = super().get_queryset()
        providers = _supplier_ids(self.request.user)
        if providers is not None:
            qs = qs.filter(Q(service__isnull=True) | Q(service__provider_id__in=providers or [-1]))
        return qs

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, serializer.validated_data["account"].pk)
        service = serializer.validated_data.get("service")
        if service is not None and (
            service.account_id != account.id or not _services_for(self.request.user, account).filter(pk=service.pk).exists()
        ):
            raise ValidationError({"service": "Услуга недоступна в вашем контуре"})
        serializer.save(organization=account.organization, account=account)
        from apps.audit.models import AuditLog
        from apps.audit.services import record_action

        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)


class AttachmentViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                        mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    queryset = Attachment.objects.select_related("account")
    serializer_class = AttachmentSerializer
    permission_classes = [RolePermission]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    filterset_fields = ["account", "doc_type"]

    def get_queryset(self):
        qs = super().get_queryset()
        providers = _supplier_ids(self.request.user)
        if providers is not None:
            qs = qs.filter(
                Q(work_item__isnull=True) | Q(work_item__service__isnull=True)
                | Q(work_item__service__provider_id__in=providers or [-1])
            )
        return qs

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, self.request.data.get("account"))
        upload = self.request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Приложите файл"})
        doc_type = self.request.data.get("doc_type") or ""
        if not doc_type:
            raise ValidationError({"doc_type": "Укажите тип документа"})
        raw_item = self.request.data.get("work_item") or None
        work_item_id = None
        if raw_item:
            try:
                work_item_id = int(raw_item)
            except (TypeError, ValueError):
                raise ValidationError({"work_item": "Некорректный идентификатор"}) from None
            item = DebtWorkItem.objects.filter(pk=work_item_id, account=account).first()
            if item is None or (
                item.service_id and not _services_for(self.request.user, account).filter(pk=item.service_id).exists()
            ):
                raise ValidationError({"work_item": "Работа недоступна в вашем контуре"})
        attachment = Attachment.objects.create(
            organization=account.organization, account=account, doc_type=doc_type, file=upload,
            original_name=upload.name, uploaded_by=self.request.user,
            work_item_id=work_item_id,
        )
        serializer.instance = attachment

    @action(detail=True)
    def download(self, request, pk=None):
        attachment = self.get_object()
        response = HttpResponse(attachment.file.open("rb").read(), content_type="application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="{attachment.original_name}"'
        return response


class MeasureViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = Measure.objects.all()
    serializer_class = MeasureSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    filterset_class = MeasureFilter
    audit_list = True

    def get_serializer_class(self):
        if self.action in {
            "retrieve", "create", "confirm", "accept", "cancel", "approve", "reject", "deliver", "send",
            "result", "move", "tasks", "task_status", "task_checks", "dial",
        }:
            return MeasureDetailSerializer
        return MeasureSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action not in {"list", "registry", "matrix"}:
            context["visible_accounts"] = _visible_accounts(self.request.user)
        return context

    def get_queryset(self):
        visible = _visible_accounts(self.request.user)
        base = super().get_queryset()
        matched = base.filter(accounts__in=visible)
        supplier_filter = _supplier_measure_filter(self.request.user)
        if supplier_filter is not None:
            matched = matched.filter(supplier_filter)
        # Имя должника и счётчики не считаются на всём реестре: их добавляет
        # _decorate только к строкам страницы. Иначе поиск и count() гоняют
        # восемь подзапросов по каждой партии.
        return Measure.objects.filter(pk__in=matched.values("id")).select_related("assignee", "created_by")

    def _decorate(self, ids):
        if not ids:
            return []
        visible = _visible_accounts(self.request.user)
        search = self.request.query_params.get("search") or ""
        found = {
            item.pk: item
            for item in annotate_registry(
                Measure.objects.filter(pk__in=ids).select_related("assignee", "created_by"),
                visible,
                search,
            )
        }
        return [found[pk] for pk in ids if pk in found]

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else list(queryset)
        serializer = self.get_serializer(self._decorate([row.pk for row in rows]), many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def _record_registry(self, request, count: int, view: str) -> None:
        params = {}
        for key in ("search", "period", "kind", "status"):
            value = request.query_params.get(key)
            if value:
                params[key] = value[:200]
        params["view"] = view
        record_action(
            request, AuditLog.Action.VIEW, object_type=Measure._meta.label,
            after={"query": params, "count": count},
        )

    @action(detail=False)
    def registry(self, request):
        """Группы реестра по статусу. Порция — GROUP_LIMIT, продолжение — status и offset."""
        from apps.debts.services.claim_measures import backfill_visible_measures

        backfill_visible_measures(_visible_accounts(request.user))
        qs = self.filter_queryset(self.get_queryset())
        offset = _page_offset(request.query_params.get("offset"))
        only = (request.query_params.get("status") or "").strip()
        labels = dict(Measure.Status.choices)
        if only and only not in labels:
            raise ValidationError({"status": "Неизвестный статус"})
        statuses = (only,) if only else REGISTRY_STATUSES
        start = offset if only else 0
        groups = []
        total = 0
        for code in statuses:
            chunk = qs.filter(status=code)
            count = chunk.count()
            if not count:
                continue
            ids = list(chunk.values_list("pk", flat=True)[start:start + GROUP_LIMIT])
            rows = self.get_serializer(self._decorate(ids), many=True).data
            total += count
            groups.append({
                "status": code, "label": labels[code], "total": count, "shown": len(rows),
                "offset": start, "results": rows,
            })
        self._record_registry(request, total, "registry")
        return Response({"groups": groups, "total": total})

    @action(detail=False)
    def matrix(self, request):
        """ЛС в строках, вид мероприятия в столбцах. Та же выборка, что у реестра.

        Недостающие строки добирает открытие реестра. Повторный прогон сценария здесь
        удваивает время страницы: список и матрица запрашиваются вместе.
        """
        visible = _visible_accounts(request.user)
        payload = build_matrix(
            self.filter_queryset(self.get_queryset()), visible,
            request.query_params.get("search") or "", _page_offset(request.query_params.get("offset")),
        )
        self._record_registry(request, payload["total"], "matrix")
        return Response(payload)

    def create(self, request, *args, **kwargs):
        from .services.measures import MeasureLaunchError, launch_measure

        if request.user.role not in {"superadmin", "local_admin"}:
            raise PermissionDenied("Мероприятие вне сценария запускает локальный администратор или суперадминистратор")
        accounts = self._selected_accounts(request)
        if accounts:
            accounts = list(
                Account.objects.filter(pk__in=[account.id for account in accounts]).prefetch_related(
                    "contacts", "registrations", "services",
                )
            )
        services = self._launch_services(request, accounts)
        try:
            result = launch_measure(request.user, accounts, services, request.data)
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        measure = result["measure"]
        record_action(
            request, AuditLog.Action.CREATE, measure,
            after={"kind": measure.kind, "accounts": measure.accounts.count(), "skipped": result["skipped"]},
        )
        data = self.get_serializer(measure).data
        data["skipped"] = result["skipped"]
        data["skipped_inheritance"] = result["skipped_inheritance"]
        data["dropped_services"] = result["dropped_services"]
        data["service_ids"] = result["service_ids"]
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def tasks(self, request, pk=None):
        from .services.tasks import TaskError, add_task

        measure = self.get_object()
        try:
            task = add_task(
                measure, request.user, str(request.data.get("title") or ""),
                request.data.get("due_on"), request.data.get("assignee"),
            )
        except TaskError as exc:
            raise ValidationError(exc.detail) from exc
        record_action(request, AuditLog.Action.CREATE, task, after={"title": task.title})
        return Response(self.get_serializer(measure).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="task-status")
    def task_status(self, request, pk=None):
        from .services.tasks import TaskError, set_task_status

        measure = self.get_object()
        try:
            set_task_status(measure, int(request.data.get("task_id") or 0), str(request.data.get("status") or ""))
        except (TypeError, ValueError) as exc:
            raise ValidationError({"task_id": "Укажите задание"}) from exc
        except TaskError as exc:
            raise ValidationError(exc.detail) from exc
        return Response(self.get_serializer(measure).data)

    @action(detail=True, methods=["post"], url_path="task-checks")
    def task_checks(self, request, pk=None):
        from .services.tasks import TaskError, add_check, set_check

        measure = self.get_object()
        try:
            if request.data.get("check_id"):
                set_check(measure, int(request.data.get("check_id")), bool(request.data.get("done")))
            else:
                add_check(measure, int(request.data.get("task_id") or 0), str(request.data.get("title") or ""))
        except (TypeError, ValueError) as exc:
            raise ValidationError({"task_id": "Укажите задание"}) from exc
        except TaskError as exc:
            raise ValidationError(exc.detail) from exc
        return Response(self.get_serializer(measure).data)

    def _open_items(self, request, measure):
        qs = measure.items.filter(account__in=_visible_accounts(request.user))
        ids = request.data.get("item_ids") or []
        if ids:
            qs = qs.filter(pk__in=ids)
        return list(qs)

    def _act(self, request, measure, runner):
        from .services.measures import MeasureLaunchError

        try:
            runner()
        except MeasureLaunchError as exc:
            raise ValidationError(exc.detail) from exc
        measure.refresh_from_db()
        return Response(self.get_serializer(measure).data)

    @action(detail=False, url_path="ready-to-disconnect")
    def ready_to_disconnect(self, request):
        from .services.measures import disconnect_candidates

        return Response({"results": disconnect_candidates(_visible_accounts(request.user))})

    @action(detail=True, methods=["post"], url_path="status")
    def move(self, request, pk=None):
        from apps.users.access import can_skip_stage

        if not can_skip_stage(request.user):
            raise PermissionDenied("Статус партии переносит администратор или специалист с согласованием")
        measure = self.get_object()

        def runner():
            from .services.measures import move_status

            move_status(measure, (request.data.get("status") or "").strip(), request.user)

        record_action(
            request, AuditLog.Action.UPDATE, measure, after={"status": request.data.get("status")},
        )
        return self._act(request, measure, runner)

    @action(detail=False, methods=["post"])
    def conduct(self, request):
        """Провести отмеченные в реестре мероприятий ручные партии."""
        from apps.users.models import User

        from .services.autocall import conduct_selected

        if request.user.role not in {User.Role.SUPERADMIN, User.Role.LOCAL_ADMIN, User.Role.SPECIALIST}:
            raise PermissionDenied("Мероприятие проводит специалист, локальный администратор или суперадминистратор")
        if request.user.contour == User.Contour.SUPPLIER:
            raise PermissionDenied("Обзвон и рассылку проводит специалист начисляющей организации")
        raw = request.data.get("ids") or []
        try:
            ids = [int(item) for item in raw]
        except (TypeError, ValueError) as exc:
            raise ValidationError({"ids": "Укажите мероприятия"}) from exc
        measures = list(self.get_queryset().filter(pk__in=ids).select_related("source_scenario", "organization"))
        result = conduct_selected(measures, request.user)
        skipped = {row["id"] for row in result["skipped"]}
        for measure in measures:
            if measure.pk in skipped:
                continue
            record_action(request, AuditLog.Action.UPDATE, measure, after={"conduct": True})
        return Response(result)

    @action(detail=True, methods=["post"])
    def dial(self, request, pk=None):
        """Провести одну открытую партию обзвона. Кнопка в интерфейсе стоит в реестре."""
        from apps.users.models import User

        if request.user.role not in {User.Role.SUPERADMIN, User.Role.LOCAL_ADMIN, User.Role.SPECIALIST}:
            raise PermissionDenied("Обзвон проводит специалист, локальный администратор или суперадминистратор")
        if request.user.contour == User.Contour.SUPPLIER:
            raise PermissionDenied("Обзвон проводит специалист начисляющей организации")
        measure = self.get_object()
        outcome: dict = {}

        def runner():
            from .services.autocall import conduct_call_measure

            outcome.update(conduct_call_measure(measure))

        response = self._act(request, measure, runner)
        response.data["dialed"] = outcome.get("dialed", 0)
        record_action(
            request, AuditLog.Action.UPDATE, measure, after={"dialed": outcome.get("dialed", 0)},
        )
        return response

    @action(detail=True, methods=["post"], url_path="result")
    def result(self, request, pk=None):
        measure = self.get_object()
        item_id = request.data.get("item_id")
        item = measure.items.filter(pk=item_id, account__in=_visible_accounts(request.user)).first()
        if item is None:
            raise ValidationError({"item_id": "Частное мероприятие не найдено"})

        def runner():
            from .services.measures import record_item

            record_item(measure, item, request.user, request.data)

        record_action(request, AuditLog.Action.UPDATE, measure, after={"item": item.id, "result": request.data.get("call_result") or request.data.get("status")})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def deliver(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import deliver_warnings

            deliver_warnings(measure, self._open_items(request, measure), request.user, request.data)

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "deliver"})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import queue_notices

            queue_notices(measure, self._open_items(request, measure), request.user)

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "send"})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def hold(self, request, pk=None):
        from .services.extra_measures import ExtraMeasureError, hold_measure

        if getattr(request.user, "contour", "") == "supplier":
            raise PermissionDenied("Поставщик мероприятие не приостанавливает")
        measure = self.get_object()
        try:
            hold_measure(measure, request.user, request.data.get("until"), request.data.get("reason") or "")
        except ExtraMeasureError as exc:
            raise ValidationError(exc.detail) from exc
        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "hold"})
        return Response({"status": measure.status, "pause_until": measure.pause_until, "pause_reason": measure.pause_reason})

    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        from .services.extra_measures import release_measure

        if getattr(request.user, "contour", "") == "supplier":
            raise PermissionDenied("Поставщик мероприятие не возобновляет")
        measure = self.get_object()
        release_measure(measure, request.user)
        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "release"})
        return Response({"status": measure.status})

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import apply_confirmation

            apply_confirmation(measure, request.data.get("action"), request.data.get("source") or "pm", request.user)

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": request.data.get("action")})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import accept_disconnect

            accept_disconnect(measure, request.user)

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "accept"})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import decide_approval

            decide_approval(measure, request.user, True, request.data.get("note") or "")

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "approve"})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import decide_approval

            decide_approval(measure, request.user, False, request.data.get("note") or "")

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "reject"})
        return self._act(request, measure, runner)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        measure = self.get_object()

        def runner():
            from .services.measures import cancel_disconnect

            cancel_disconnect(measure, request.user, request.data.get("reason") or "")

        record_action(request, AuditLog.Action.UPDATE, measure, after={"action": "cancel"})
        return self._act(request, measure, runner)

    def _launch_services(self, request, accounts):
        from .services.contracts import id_list

        requested = id_list(request.data.get("service_ids"))
        catalog = id_list(request.data.get("catalog_service_ids"), field="catalog_service_ids")
        if requested and catalog:
            raise ValidationError({"service_ids": "Укажите услуги счетов или виды услуг, не оба списка"})
        allowed = AccessScope(request.user).apply(
            AccountService.objects.filter(account__in=accounts),
            "organization", "account__provider_id", "provider_id",
        )
        if requested:
            services = list(allowed.filter(pk__in=requested))
            if len(services) != len(set(requested)):
                raise ValidationError({"service_ids": "Услуга недоступна в вашем контуре"})
            return services
        if catalog:
            wanted = set(catalog)
            services = list(allowed.filter(service_id__in=wanted))
            missing = wanted - {service.service_id for service in services}
            if missing:
                raise ValidationError({"catalog_service_ids": "Услуга недоступна в текущей выборке"})
            return services
        return []

    def _selected_accounts(self, request):
        base = AccessScope(request.user).apply(
            Account.objects.all(), "organization", "provider_id", "services__provider_id",
        )
        if request.data.get("all_matching"):
            return list(AccountFilter(request.data.get("filters") or {}, queryset=base).qs)
        ids = request.data.get("account_ids") or []
        return list(base.filter(pk__in=ids))


class SavedFilterViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    serializer_class = SavedFilterSerializer
    permission_classes = [RolePermission]
    scope_organization_field = None
    filterset_fields = ["target"]

    def get_queryset(self):
        return SavedFilter.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


def _visible_account(user, account_id) -> Account:
    return get_object_or_404(
        AccessScope(user).apply(Account.objects.all(), "organization", "provider_id", "services__provider_id"),
        pk=account_id,
    )


