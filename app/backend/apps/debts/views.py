import csv
from datetime import date

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import record_action, record_query
from apps.core.permissions import RolePermission
from apps.users.scoping import AccessScope, ScopedQuerysetMixin

from .filters import AccountFilter, AccountOrderingFilter, ContractFilter, MeasureFilter
from .models import (
    Account,
    AccountService,
    Attachment,
    Contact,
    DebtWorkItem,
    Measure,
    Payment,
    RefreshRequest,
    Registration,
    RegistryPreference,
    SavedFilter,
    ServiceDebtPeriod,
    StatusHistory,
    Territory,
)
from .repositories import AccountRepository
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
from .services.contacts import choose_phone
from .services.registry import GROUP_LIMIT, REGISTRY_STATUSES, annotate_registry, build_matrix
from .services.territory import TerritoryIndex, TerritoryMap

FUNNEL_STAGES = [
    ("new", "Новый должник"),
    ("prevention", "Автообзвон/уведомления"),
    ("warning", "Предупреждение вручено"),
    ("disconnect", "Отключение услуг"),
    ("enforcement", "Испол. надпись / иск"),
    ("court", "ОПИ"),
    ("closed", "Не должник"),
]
ACCOUNT_COLUMNS = [
    "account_id", "client_account", "unified_account", "provider_short_name", "account_address", "short_fio",
    "payer_identifier", "payer_unp", "rating_label", "debt_started_on", "debt_total", "mulct_total", "effective_group",
    "scenario_name", "assigned_name", "ownership_type_name", "months_debt", "subj_count", "funnel_stage",
]


def _supplier_ids(user):
    if getattr(user, "contour", "") != "supplier":
        return None
    return AccessScope(user).provider_ids()


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
    """Поставщик видит партию без услуг и партию, где есть хотя бы одна его услуга."""
    providers = _supplier_ids(user)
    if providers is None:
        return None
    return Q(services__isnull=True) | Q(services__provider_id__in=providers or [-1])


def _own_measures(user, account):
    qs = Measure.objects.filter(accounts=account).prefetch_related("services", "tasks", "items")
    supplier_filter = _supplier_measure_filter(user)
    if supplier_filter is not None:
        qs = qs.filter(supplier_filter)
    return annotate_registry(qs.distinct(), _visible_accounts(user))


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
        providers = _supplier_ids(self.request.user)
        # Суммы по услугам нужны строке списка. На карте и в группировке они
        # добавляют GROUP BY по лицевому счёту, и один населённый пункт
        # распадается на пузырь «1» для каждого счёта.
        if providers is not None and self.action in {"list", "export", "kanban", "retrieve"}:
            allowed = providers or [-1]
            qs = qs.annotate(
                supplier_principal=Sum("services__balance_out", filter=Q(services__provider_id__in=allowed)),
                supplier_penalty=Sum("services__balance_mulct_out", filter=Q(services__provider_id__in=allowed)),
                supplier_services=Count("services", filter=Q(services__provider_id__in=allowed), distinct=True),
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

    @action(detail=True)
    def services(self, request, pk=None):
        from decimal import Decimal

        from django.db.models import Q

        qs = _services_for(request.user, self.get_object())
        if request.query_params.get("with_debt") == "1":
            qs = qs.filter(
                Q(balance_out__gt=Decimal("0")) | Q(balance_mulct_out__gt=Decimal("0")) | Q(overdue_debt__gt=0)
            )
        return self._nested("", AccountServiceSerializer, qs)

    @action(detail=True)
    def payments(self, request, pk=None):
        account = self.get_object()
        qs = account.payments.all()
        if getattr(request.user, "contour", "") == "supplier":
            providers = AccessScope(request.user).provider_ids()
            if providers:
                qs = qs.filter(provider_id__in=providers)
        return self._nested("", PaymentSerializer, qs)

    @action(detail=True)
    def registrations(self, request, pk=None):
        return self._nested("registrations", RegistrationSerializer)

    @action(detail=True)
    def contacts(self, request, pk=None):
        return self._nested("contacts", ContactSerializer)

    @action(detail=True, url_path="balance-history")
    def balance_history(self, request, pk=None):
        account = self.get_object()
        qs = account.balance_history.select_related("service")
        service_ids = _services_for(request.user, account).values_list("pk", flat=True)
        return self._nested("", BalanceHistorySerializer, qs.filter(service_id__in=service_ids))

    @action(detail=True, url_path="status-history")
    def status_history(self, request, pk=None):
        account = self.get_object()
        qs = account.status_history.select_related("service", "author")
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
        return self._nested("", AttachmentSerializer, qs)

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
        return self._nested("", MeasureSerializer, _own_measures(request.user, self.get_object()))

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
        columns = []
        for code, title in FUNNEL_STAGES:
            stage_qs = base.filter(funnel_stage=code) if code != "new" else base.filter(funnel_stage__in=["", "new"])
            total = stage_qs.count()
            cards = AccountListSerializer(stage_qs[start:start + page_size], many=True).data
            columns.append({"stage": code, "title": title, "total": total, "cards": cards})
        return Response(columns)

    @action(detail=False)
    def grouped(self, request):
        from django.db.models import Count, Sum
        from django.db.models.functions import Coalesce, TruncMonth

        key = request.query_params.get("group_by") or "debt_group"
        qs = self.filter_queryset(self.get_queryset())
        if key == "period":
            rows = (
                qs.annotate(bucket=TruncMonth("operational_date"))
                .values("bucket")
                .annotate(accounts=Count("id"), debt=Sum("balance_out"))
                .order_by("bucket")
            )
            return Response([
                {"value": row["bucket"].isoformat() if row["bucket"] else "", "accounts": row["accounts"], "debt": row["debt"]}
                for row in rows
            ])
        fields = {
            "debt_group": "sort_group",
            "rating": "rating",
            "provider": "provider_short_name",
            "schema": "organization__name",
            "category": "debtor_category__name",
            "specialist": "assigned_to_id",
        }
        field = fields.get(key)
        if field is None:
            raise ValidationError({"group_by": "Неизвестное поле группировки"})
        if key == "debt_group":
            qs = qs.annotate(sort_group=Coalesce("debt_group_manual", "debt_group"))
        rows = qs.values(field).annotate(accounts=Count("id", distinct=True), debt=Sum("balance_out")).order_by(field)
        return Response([
            {"value": "" if row[field] is None else str(row[field]), "accounts": row["accounts"], "debt": row["debt"]}
            for row in rows
        ])

    @action(detail=False)
    def calendar(self, request):
        raw = request.query_params.get("month") or timezone.localdate().strftime("%Y-%m")
        year, month = (int(part) for part in raw.split("-")[:2])
        start = date(year, month, 1)
        end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
        accounts = self.filter_queryset(self.get_queryset())
        events = []
        for field, kind in (("warning_due", "Предупреждение"), ("claim_due", "Иск")):
            for account in accounts.exclude(**{field: None}).filter(**{f"{field}__gte": start, f"{field}__lt": end}):
                events.append({
                    "date": getattr(account, field), "kind": kind, "account_id": account.id,
                    "title": f"ЛС {account.client_account}",
                })
        measures = Measure.objects.filter(
            accounts__in=accounts, due_on__gte=start, due_on__lt=end,
        ).distinct()
        for measure in measures:
            events.append({
                "date": measure.due_on, "kind": measure.get_kind_display(), "account_id": None,
                "title": measure.get_kind_display(), "measure_id": measure.id,
            })
        return Response([{**event, "date": event["date"].isoformat()} for event in events])

    @action(detail=False)
    def export(self, request):
        rows = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="accounts.csv"'
        response.write("\ufeff")
        writer = csv.writer(response, delimiter=";")
        headers = [
            "Код ЛС", "Номер ЛС", "УЕН", "Организация", "Адрес", "Плательщик", "ИН", "УНП", "Рейтинг",
            "Дата возникновения", "Долг", "Пеня", "Группа", "Сценарий", "Специалист",
            "Тип собственности", "Месяцев", "Проживающих", "Этап",
        ]
        writer.writerow(headers)
        for account in rows:
            writer.writerow([
                account.account_id, account.client_account, account.unified_account or "", account.provider_short_name,
                account.account_address, account.short_fio, account.payer_identifier, account.payer_unp,
                AccountListSerializer(account).data["rating_label"], account.debt_started_on or "",
                account.debt_total, account.mulct_total, account.effective_group or "",
                account.scenario_name, getattr(account.assigned_to, "display_name", "") if account.assigned_to_id else "",
                account.ownership_type_name, account.months_debt if account.months_debt is not None else "",
                account.subj_count if account.subj_count is not None else "", account.funnel_stage,
            ])
        return response

    @action(detail=False, methods=["get", "put"], url_path="columns")
    def columns(self, request):
        pref, _created = RegistryPreference.objects.get_or_create(
            user=request.user, target="accounts", defaults={"columns": ACCOUNT_COLUMNS},
        )
        if request.method == "PUT":
            chosen = [name for name in request.data.get("columns", []) if name in ACCOUNT_COLUMNS]
            pref.columns = chosen or ACCOUNT_COLUMNS
            pref.save(update_fields=["columns", "updated_at"])
        return Response({"columns": pref.columns or ACCOUNT_COLUMNS, "available": ACCOUNT_COLUMNS})


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
        "account", "account__debtor_category", "account__organization",
    )
    serializer_class = AccountServiceSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "provider_id"
    filterset_class = ContractFilter
    search_fields = [
        "service_name", "shot_name", "account__short_fio", "account__client_account",
        "account__payer_identifier", "account__payer_unp",
    ]
    ordering_fields = ["debt_group", "balance_out", "debt_started_on", "service_name"]
    audit_view = True
    audit_list = True

    def _visible(self):
        return self.filter_queryset(self.get_queryset())

    @action(detail=False)
    def summary(self, request):
        debt = self._visible().filter(
            Q(balance_out__gt=0) | Q(balance_mulct_out__gt=0) | Q(overdue_debt__gt=0)
        )
        sums = debt.aggregate(
            ls_count=Count("account", distinct=True),
            principal=Sum("balance_out"),
            penalty=Sum("balance_mulct_out"),
        )
        measures = list(
            Measure.objects.filter(services__in=self._visible())
            .values("kind").annotate(total=Count("id", distinct=True)).order_by("kind")
        )
        return Response({
            "ls_count": sums["ls_count"] or 0,
            "principal": sums["principal"] or 0,
            "penalty": sums["penalty"] or 0,
            "measures": measures,
        })

    @action(detail=False)
    def persons(self, request):
        from .services.contracts import bounded_int, person_page

        page_size = bounded_int(request.query_params.get("page_size"), 50, maximum=200, field="page_size")
        page = bounded_int(request.query_params.get("page"), 1, field="page")
        total, rows = person_page(self._visible(), page, page_size)
        return Response({"count": total, "results": rows})

    @action(detail=False)
    def kanban(self, request):
        from .services.contracts import bounded_int, kanban_columns

        page_size = bounded_int(request.query_params.get("page_size"), 100, maximum=200, field="page_size")
        page = bounded_int(request.query_params.get("page"), 1, field="page")
        return Response(kanban_columns(self._visible(), FUNNEL_STAGES, page, page_size))

    @action(detail=False)
    def calendar(self, request):
        from .services.contracts import bounded_int

        raw = request.query_params.get("month") or timezone.localdate().strftime("%Y-%m")
        parts = raw.split("-")
        year = bounded_int(parts[0] if parts else None, timezone.localdate().year, minimum=2000, maximum=2100, field="month")
        month = bounded_int(parts[1] if len(parts) > 1 else None, timezone.localdate().month, minimum=1, maximum=12, field="month")
        start = date(year, month, 1)
        end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
        services = self._visible().select_related("account")
        events = []
        for field, kind in (("repayment_due_on", "Срок погашения"), ("debt_started_on", "Возникновение")):
            for service in services.exclude(**{field: None}).filter(**{f"{field}__gte": start, f"{field}__lt": end}):
                events.append({
                    "date": getattr(service, field).isoformat(), "kind": kind,
                    "title": f"{service.service_name} · ЛС {service.account.client_account}",
                    "account_id": service.account_id, "contract_id": service.id,
                })
        for measure in Measure.objects.filter(services__in=services, due_on__gte=start, due_on__lt=end).distinct():
            events.append({
                "date": measure.due_on.isoformat(), "kind": measure.get_kind_display(),
                "title": measure.get_kind_display(), "account_id": None, "measure_id": measure.id,
            })
        return Response(events)

    @action(detail=False)
    def grouped(self, request):
        key = request.query_params.get("group_by") or "debt_group"
        qs = self._visible()
        if key == "debt_group":
            qs = qs.annotate(sort_group=Coalesce("debt_group_manual", "debt_group"))
            field = "sort_group"
        else:
            fields = {
                "provider": "shot_name",
                "category": "account__debtor_category__name",
                "billing": "account__provider_short_name",
                "period": "debt_started_on",
            }
            field = fields.get(key)
            if field is None:
                raise ValidationError({"group_by": "Неизвестное поле группировки"})
        rows = qs.values(field).annotate(
            accounts=Count("account", distinct=True), debt=Sum("balance_out"), penalty=Sum("balance_mulct_out"),
        ).order_by(field)
        return Response([
            {
                "value": "" if row[field] is None else str(row[field]),
                "accounts": row["accounts"], "debt": row["debt"], "penalty": row["penalty"],
            }
            for row in rows
        ])

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
        if self.action in {"retrieve", "create", "confirm", "accept", "cancel", "approve", "reject", "deliver", "send", "result"}:
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
        search = self.request.query_params.get("search") or ""
        return annotate_registry(Measure.objects.filter(pk__in=matched.values("id")), visible, search)

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
            rows = self.get_serializer(chunk[start:start + GROUP_LIMIT], many=True).data
            total += count
            groups.append({
                "status": code, "label": labels[code], "total": count, "shown": len(rows),
                "offset": start, "results": rows,
            })
        self._record_registry(request, total, "registry")
        return Response({"groups": groups, "total": total})

    @action(detail=False)
    def matrix(self, request):
        """ЛС в строках, вид мероприятия в столбцах. Та же выборка, что у реестра."""
        visible = _visible_accounts(request.user)
        payload = build_matrix(
            self.filter_queryset(self.get_queryset()), visible,
            request.query_params.get("search") or "", _page_offset(request.query_params.get("offset")),
        )
        self._record_registry(request, payload["total"], "matrix")
        return Response(payload)

    def create(self, request, *args, **kwargs):
        from .services.measures import MeasureLaunchError, launch_measure

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
        data["service_ids"] = result["service_ids"]
        return Response(data, status=status.HTTP_201_CREATED)

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


