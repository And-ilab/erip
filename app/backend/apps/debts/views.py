import csv
from datetime import date, timedelta

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
from apps.core.permissions import RolePermission
from apps.users.models import User
from apps.users.scoping import AccessScope, ScopedQuerysetMixin

from .filters import AccountFilter, AccountOrderingFilter
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
)
from .repositories import AccountRepository
from .serializers import (
    AccountDetailSerializer,
    AccountListSerializer,
    AccountServiceSerializer,
    AttachmentSerializer,
    BalanceHistorySerializer,
    ContactSerializer,
    DebtWorkItemSerializer,
    MeasureSerializer,
    PaymentSerializer,
    RefreshRequestSerializer,
    RegistrationSerializer,
    SavedFilterSerializer,
    StatusHistorySerializer,
)
from .services.contacts import choose_phone
from .services.portfolio import AUTO_MEASURES

FUNNEL_STAGES = [
    ("new", "Новый"),
    ("prevention", "Превентивные меры"),
    ("warning", "Предупреждение"),
    ("disconnect", "Отключение"),
    ("enforcement", "Взыскание"),
    ("court", "Суд / ОПИ"),
    ("closed", "Не должник"),
]
ACCOUNT_COLUMNS = [
    "account_id", "client_account", "unified_account", "provider_short_name", "account_address", "short_fio",
    "payer_identifier", "payer_unp", "rating_label", "debt_started_on", "debt_total", "mulct_total", "effective_group",
    "scenario_name", "assigned_name", "ownership_type_name", "months_debt", "subj_count", "funnel_stage",
]


def _services_for(user, account):
    qs = account.services.all()
    if getattr(user, "contour", "") == "supplier":
        providers = AccessScope(user).provider_ids()
        if providers:
            qs = qs.filter(provider_id__in=providers)
    return qs


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
        qs = super().get_queryset()
        if self.action in {"list", "export", "kanban", "calendar"}:
            return AccountRepository(qs).registry()
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
        return self._nested("status_history", StatusHistorySerializer)

    @action(detail=True, url_path="work-items")
    def work_items(self, request, pk=None):
        account = self.get_object()
        qs = account.work_items.all()
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
        return self._nested("attachments", AttachmentSerializer)

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
        account = self.get_object()
        qs = Measure.objects.filter(accounts=account).prefetch_related("services", "tasks")
        return self._nested("", MeasureSerializer, qs)

    @action(detail=True, methods=["get", "post"], url_path="writ-checks")
    def writ_checks(self, request, pk=None):
        from apps.debts.models import WritCheck
        from apps.debts.services.artifacts import WRIT_CHECKS

        account = self.get_object()
        existing = {row.code: row for row in account.writ_checks.all()}
        for code, title in WRIT_CHECKS:
            existing.setdefault(code, WritCheck.objects.create(
                organization=account.organization, account=account, code=code, title=title,
            ))
        if request.method == "POST":
            code = request.data.get("code")
            row = existing.get(code)
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
    def kanban(self, request):
        page_size = min(int(request.query_params.get("page_size") or 100), 200)
        page = max(int(request.query_params.get("page") or 1), 1)
        base = self.filter_queryset(self.get_queryset())
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
    scope_supplier_field = "account__services__provider_id"


class ContractViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                      mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Реестр и карточка задолженности по договору поставщика."""

    queryset = AccountService.objects.select_related("account", "account__debtor_category")
    serializer_class = AccountServiceSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "provider_id"
    filterset_fields = ["account", "service_id", "provider_id", "debt_group"]
    search_fields = ["service_name", "shot_name", "account__short_fio", "account__client_account", "account__payer_identifier"]
    ordering_fields = ["debt_group", "balance_out", "debt_started_on", "service_name"]
    audit_view = True
    audit_list = True


class ContactViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = Contact.objects.select_related("account")
    serializer_class = ContactSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    filterset_fields = ["account", "source", "kind"]

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, serializer.validated_data["account"].pk)
        serializer.save(organization=account.organization, account=account, source=Contact.Source.PM)
        from apps.audit.models import AuditLog
        from apps.audit.services import record_action

        record_action(self.request, AuditLog.Action.CREATE, serializer.instance)

    def perform_destroy(self, instance):
        if instance.source == Contact.Source.AIS:
            raise ValidationError("Контакт из АИС нельзя удалить")
        super().perform_destroy(instance)


class DebtWorkItemViewSet(AuditedViewSetMixin, ScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = DebtWorkItem.objects.select_related("account")
    serializer_class = DebtWorkItemSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    scope_provider_field = "account__provider_id"
    scope_supplier_field = "account__services__provider_id"
    filterset_fields = ["account", "kind"]

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, serializer.validated_data["account"].pk)
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

    def perform_create(self, serializer):
        account = _visible_account(self.request.user, self.request.data.get("account"))
        upload = self.request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Приложите файл"})
        doc_type = self.request.data.get("doc_type") or ""
        if not doc_type:
            raise ValidationError({"doc_type": "Укажите тип документа"})
        attachment = Attachment.objects.create(
            organization=account.organization, account=account, doc_type=doc_type, file=upload,
            original_name=upload.name, uploaded_by=self.request.user,
            work_item_id=self.request.data.get("work_item") or None,
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
    queryset = Measure.objects.prefetch_related("accounts", "services")
    serializer_class = MeasureSerializer
    permission_classes = [RolePermission]
    scope_organization_field = "organization"
    filterset_fields = ["kind", "status"]
    audit_list = True

    def get_queryset(self):
        visible = AccessScope(self.request.user).apply(
            Account.objects.all(), "organization", "provider_id", "services__provider_id",
        )
        return super().get_queryset().filter(accounts__in=visible).distinct()

    def create(self, request, *args, **kwargs):
        kind = request.data.get("kind")
        if kind not in Measure.Kind.values:
            raise ValidationError({"kind": "Неизвестный вид мероприятия"})
        accounts = self._selected_accounts(request)
        if not accounts:
            raise ValidationError({"accounts": "Не выбраны лицевые счета"})
        services = list(AccountService.objects.filter(pk__in=request.data.get("service_ids") or [], account__in=accounts))
        if kind in Measure.SERVICE_REQUIRED and not services:
            raise ValidationError({"service_ids": "Выберите услуги для отключения или взыскания"})
        skipped = []
        if kind in AUTO_MEASURES:
            blocked = [account for account in accounts if account.inheritance_case]
            skipped = [account.id for account in blocked]
            accounts = [account for account in accounts if not account.inheritance_case]
        if not accounts:
            raise ValidationError({"accounts": "По всем выбранным ЛС открыто наследственное дело"})
        started = _parse_date(request.data.get("started_on")) or timezone.localdate()
        days = request.data.get("days") or None
        due = _parse_date(request.data.get("due_on"))
        if due is None:
            due = started + timedelta(days=int(days)) if days else started
        template = (request.data.get("template_name") or "").strip()
        if kind in {Measure.Kind.CALL, Measure.Kind.NOTICE, Measure.Kind.WARNING} and not template:
            raise ValidationError({"template_name": "Выберите шаблон"})
        if kind == Measure.Kind.CALL and not (request.data.get("time_from") and request.data.get("time_to")):
            raise ValidationError({"time_from": "Укажите время с и по"})
        if kind == Measure.Kind.NOTICE and not request.data.get("channel"):
            raise ValidationError({"channel": "Выберите канал"})
        if kind == Measure.Kind.SCENARIO:
            name = (request.data.get("scenario_name") or "").strip()
            if not name:
                raise ValidationError({"scenario_name": "Укажите сценарий"})
            if not request.data.get("started_on"):
                raise ValidationError({"started_on": "Укажите дату начала"})
            Account.objects.filter(pk__in=[account.id for account in accounts]).update(
                scenario_name=name, scenario_locked=True,
            )
        if kind == Measure.Kind.COLLECTION and not request.data.get("assignee"):
            raise ValidationError({"assignee": "Назначьте исполнителя"})
        assignee = None
        if request.data.get("assignee"):
            assignee = get_object_or_404(User, pk=request.data.get("assignee"))
        measure = Measure.objects.create(
            organization=accounts[0].organization, kind=kind, channel=request.data.get("channel") or "",
            template_name=template, scenario_name=request.data.get("scenario_name") or "",
            note=request.data.get("note") or "", assignee=assignee,
            started_on=started, due_on=due, days=int(days) if days else None,
            time_from=request.data.get("time_from") or None, time_to=request.data.get("time_to") or None,
            created_by=request.user,
        )
        measure.accounts.set(accounts)
        if services:
            measure.services.set(services)
        if kind == Measure.Kind.CALL:
            from apps.debts.services.artifacts import attach_call_file

            attach_call_file(measure, accounts)
        if kind == Measure.Kind.WARNING:
            from apps.debts.services.artifacts import attach_warning_pdf

            attach_warning_pdf(measure, accounts)
        if kind == Measure.Kind.COLLECTION:
            from apps.debts.models import MeasureTask

            MeasureTask.objects.create(
                organization=measure.organization, measure=measure, assignee=assignee,
                title=request.data.get("note") or "Подготовить взыскание", due_on=due,
            )
        data = MeasureSerializer(measure).data
        data["skipped_inheritance"] = skipped
        data["service_ids"] = [service.id for service in services]
        return Response(data, status=status.HTTP_201_CREATED)

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


def _parse_date(value):
    if not value:
        return None
    return date.fromisoformat(value)
