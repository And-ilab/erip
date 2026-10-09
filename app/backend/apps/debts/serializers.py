from decimal import Decimal

from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers

from apps.nsi.models import DebtGroupScale, ScenarioDefinition

from .models import (
    Account,
    AccountService,
    Attachment,
    BalanceHistory,
    Contact,
    DebtWorkItem,
    Measure,
    MeasureItem,
    Payment,
    RefreshRequest,
    Registration,
    SavedFilter,
    StatusHistory,
)
from .services.registry import accounts_count, debtor_fields, measure_title, next_action

AIS_READ_ONLY = "Данные АИС только для чтения"


def _iso_date(value):
    if not value:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)[:10]


def schema_label(account) -> str:
    organization = account.organization
    if organization is None:
        return account.schema_name
    return organization.name or organization.schema_name


def _rating_label(rating: str, repeat: int | None) -> str:
    if not rating:
        return ""
    if rating == "E" or not repeat:
        return rating
    return f"{rating}/{repeat}"


def _money(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    return Decimal(str(value))


def _add_money(left, right) -> str:
    return f"{(_money(left) + _money(right)):.2f}"


def scenario_brief(account, published: dict | None = None) -> str:
    """Название назначенного сценария, без перечня шагов.

    Текущий шаг показывает этап воронки. Имя правила по группе в эту строку не входит.
    """
    run = None
    try:
        run = account.scenario_run
    except ObjectDoesNotExist:
        run = None
    scenario = run.scenario if run is not None else None
    if scenario is None and published is not None:
        scenario = published.get(account.organization_id)
    if scenario is None:
        return ""
    return scenario.name


def published_scenario(organization_id, cache: dict):
    if organization_id in cache:
        return cache[organization_id]
    own = (
        ScenarioDefinition.objects.filter(
            organization_id=organization_id, status=ScenarioDefinition.Status.ACTIVE,
        )
        .order_by("id")
        .first()
    )
    shared = (
        ScenarioDefinition.objects.filter(organization__isnull=True, status=ScenarioDefinition.Status.ACTIVE)
        .order_by("id")
        .first()
    )
    cache[organization_id] = own or shared
    return cache[organization_id]


class AccountListSerializer(serializers.ModelSerializer):
    services_count = serializers.IntegerField(read_only=True)
    debt_total = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    mulct_total = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    effective_group = serializers.IntegerField(read_only=True)
    assigned_name = serializers.CharField(source="assigned_to.registry_name", default="", read_only=True)
    rating_label = serializers.SerializerMethodField()
    schema_label = serializers.SerializerMethodField()
    registered_count = serializers.IntegerField(read_only=True)
    is_legal = serializers.BooleanField(read_only=True)
    scenario_brief = serializers.SerializerMethodField()
    obligation_total = serializers.SerializerMethodField()
    warning_handed_on = serializers.SerializerMethodField()
    order_on = serializers.SerializerMethodField()
    filed_on = serializers.SerializerMethodField()
    package_on = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id", "organization", "account_id", "client_account", "unified_account", "provider_id",
            "provider_short_name", "account_address", "short_fio", "payer_identifier", "payer_unp", "balance_out",
            "debt_group", "effective_group", "rating", "rating_label", "debt_started_on", "scenario_name",
            "assigned_name", "ownership_type_name", "acc_category_full", "months_debt", "subj_count",
            "registered_count", "is_legal", "funnel_stage", "schema_label", "scenario_brief",
            "services_count", "debt_total", "mulct_total", "obligation_total", "warning_due", "claim_due", "updated_at",
            "ais_updated_at", "operational_date", "inheritance_case", "debtor_category",
            "warning_handed_on", "order_on", "filed_on", "package_on",
        ]

    def get_rating_label(self, obj) -> str:
        return _rating_label(obj.rating, obj.rating_repeat)

    def get_schema_label(self, obj) -> str:
        return schema_label(obj)

    def get_warning_handed_on(self, obj):
        return _iso_date(getattr(obj, "warning_handed_on", None))

    def get_order_on(self, obj):
        return _iso_date(getattr(obj, "order_on", None))

    def get_filed_on(self, obj):
        return _iso_date(getattr(obj, "filed_on", None))

    def get_package_on(self, obj):
        return _iso_date(getattr(obj, "package_on", None))

    def get_scenario_brief(self, obj) -> str:
        cache = self.context.setdefault("_published_scenarios", {})
        try:
            obj.scenario_run
        except ObjectDoesNotExist:
            published_scenario(obj.organization_id, cache)
        return scenario_brief(obj, cache)

    def get_obligation_total(self, obj) -> str:
        return _add_money(getattr(obj, "debt_total", None), getattr(obj, "mulct_total", None))

    def to_representation(self, instance):
        from .services.board_lines import board_service_lines

        data = super().to_representation(instance)
        data = _supplier_totals(instance, data)
        data["obligation_total"] = _add_money(data.get("debt_total"), data.get("mulct_total"))
        lines, debt_count = board_service_lines(instance.services.all())
        data["service_lines"] = lines
        data["services_debt_count"] = debt_count
        return data


def _supplier_totals(instance, data):
    if not hasattr(instance, "supplier_principal"):
        return data
    principal = instance.supplier_principal
    data["balance_out"] = principal or 0
    if "debt_total" in data:
        data["debt_total"] = principal or 0
    if "mulct_total" in data:
        data["mulct_total"] = getattr(instance, "supplier_penalty", None) or 0
    replacements = {
        "balance_in": getattr(instance, "supplier_balance_in", None) or 0,
        "total_calc_sum": getattr(instance, "supplier_calc", None) or 0,
        "pay_sum": getattr(instance, "supplier_paid", None) or 0,
        "pay_sum_writeoff": 0,
        "unshared_sum": 0,
        "calc_result_sum": getattr(instance, "supplier_subsidy", None) or 0,
    }
    for key, value in replacements.items():
        if key in data:
            data[key] = value
    services = getattr(instance, "supplier_services", None)
    if services is not None and "services_count" in data:
        data["services_count"] = services
    return _supplier_group(instance, data)


def _supplier_group(instance, data):
    """Группа, сценарий и этап на карточке поставщика — по его услугам, не по старшей группе счёта."""
    if not hasattr(instance, "supplier_group"):
        return data
    from apps.debts.services.portfolio import STAGE_BY_GROUP, rating_letter, scenario_names

    group = instance.supplier_group
    if "effective_group" in data:
        data["effective_group"] = group
    if "debt_group" in data:
        data["debt_group"] = group
    names = scenario_names()
    if "scenario_name" in data:
        data["scenario_name"] = names.get(group, "") if group else ""
    if "group_name" in data:
        scale = DebtGroupScale.objects.filter(group=group, is_active=True).first() if group else None
        data["group_name"] = scale.name if scale else ""
    months = instance.supplier_months
    if "months_debt" in data:
        data["months_debt"] = months
    started = instance.supplier_started
    if "debt_started_on" in data:
        data["debt_started_on"] = started.isoformat() if started else None
    aggravating = bool(instance.bankruptcy) or instance.registrations.filter(idler_val=True).exists()
    letter = rating_letter(group, aggravating)
    if "rating" in data:
        data["rating"] = letter
    if "rating_label" in data:
        repeat = instance.rating_repeat if letter == instance.rating else None
        data["rating_label"] = _rating_label(letter, repeat)
    if "funnel_stage" in data:
        data["funnel_stage"] = "closed" if not group else STAGE_BY_GROUP.get(group, "new")
    return data


PM_WRITABLE = {
    "debt_group_manual", "debt_group_manual_reason", "funnel_stage", "scenario_name", "assigned_to",
    "contact_source_mode", "debtor_category", "inheritance_case", "inheritance_until", "residence_note",
    "bankruptcy", "legal_status", "warning_due", "claim_due",
}


class AccountDetailSerializer(serializers.ModelSerializer):
    effective_group = serializers.IntegerField(read_only=True)
    group_name = serializers.SerializerMethodField()
    rating_label = serializers.SerializerMethodField()
    assigned_name = serializers.CharField(source="assigned_to.registry_name", default="", read_only=True)
    schema_label = serializers.SerializerMethodField()
    scenario_brief = serializers.SerializerMethodField()

    class Meta:
        model = Account
        exclude = ["raw"]
        read_only_fields = [f.name for f in Account._meta.fields if f.name not in PM_WRITABLE]

    def get_group_name(self, obj) -> str:
        group = obj.effective_group
        if not group:
            return ""
        scale = DebtGroupScale.objects.filter(group=group, is_active=True).first()
        return scale.name if scale else ""

    def get_schema_label(self, obj) -> str:
        return schema_label(obj)

    def get_rating_label(self, obj) -> str:
        return _rating_label(obj.rating, obj.rating_repeat)

    def get_scenario_brief(self, obj) -> str:
        cache = self.context.setdefault("_published_scenarios", {})
        try:
            obj.scenario_run
        except ObjectDoesNotExist:
            published_scenario(obj.organization_id, cache)
        return scenario_brief(obj, cache)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _supplier_totals(instance, data)

    def validate(self, attrs):
        group = attrs.get("debt_group_manual")
        reason = attrs.get("debt_group_manual_reason", getattr(self.instance, "debt_group_manual_reason", ""))
        if group is not None and not reason:
            raise serializers.ValidationError({"debt_group_manual_reason": "Укажите причину корректировки группы"})
        if group is not None and not 1 <= group <= 6:
            raise serializers.ValidationError({"debt_group_manual": "Группа от 1 до 6"})
        category = attrs.get("debtor_category", getattr(self.instance, "debtor_category", None))
        if category is not None and category.organization_id not in {None, self.instance.organization_id}:
            raise serializers.ValidationError({"debtor_category": "Категория другой схемы"})
        assigned = attrs.get("assigned_to", getattr(self.instance, "assigned_to", None))
        if assigned is not None and not assigned.is_superadmin and assigned.organization_id != self.instance.organization_id:
            raise serializers.ValidationError({"assigned_to": "Специалист другой схемы"})
        mode = attrs.get("contact_source_mode")
        if mode is not None and mode not in {"pm", "ais", "combined"}:
            raise serializers.ValidationError({
                "contact_source_mode": "Режим автообзвона: только ПМ, только АИС или оба источника",
            })
        return attrs

    def update(self, instance, validated_data):
        from .models import StatusHistory

        old_stage = instance.funnel_stage
        funnel_reason = ""
        if "funnel_stage" in validated_data and validated_data["funnel_stage"] != instance.funnel_stage:
            from rest_framework.exceptions import PermissionDenied

            from apps.users.access import can_skip_stage

            request = self.context.get("request")
            actor = getattr(request, "user", None) if request is not None else None
            if not can_skip_stage(actor):
                raise PermissionDenied("Этап воронки переносит администратор или специалист с согласованием")
            funnel_reason = str(request.data.get("funnel_reason") or "").strip() if request is not None else ""
            if not funnel_reason:
                raise serializers.ValidationError({
                    "funnel_reason": "Укажите основание смены этапа воронки взыскания",
                })
            instance.funnel_locked = True
        if "scenario_name" in validated_data and validated_data["scenario_name"] != instance.scenario_name:
            instance.scenario_locked = True
        if "debt_group_manual" in validated_data and validated_data["debt_group_manual"] != instance.debt_group_manual:
            new_group = validated_data["debt_group_manual"]
            StatusHistory.objects.create(
                organization=instance.organization, account=instance, kind=StatusHistory.Kind.GROUP,
                old_value="" if instance.effective_group is None else str(instance.effective_group),
                new_value="" if new_group is None else str(new_group),
                reason=validated_data.get("debt_group_manual_reason", instance.debt_group_manual_reason),
                author=self.context["request"].user if self.context.get("request") else None,
            )
            validated_data["debt_group_basis"] = instance.debt_group if new_group is not None else None
            manual_notice = (
                new_group,
                validated_data.get("debt_group_manual_reason", instance.debt_group_manual_reason),
            )
        else:
            manual_notice = None
        was_inheritance = instance.inheritance_case
        old_category = instance.debtor_category_id
        old_residence = instance.residence_note
        old_legal = instance.legal_status
        old_mode = instance.contact_source_mode
        request = self.context.get("request")
        user = request.user if request is not None else None
        from .services.contracts import reject_supplier_account_fields

        reject_supplier_account_fields(user, set(validated_data))
        if "legal_status" in validated_data:
            validated_data["bankruptcy"] = validated_data["legal_status"] in {"liquidation", "bankruptcy"}
        instance = super().update(instance, validated_data)
        if manual_notice and instance.assigned_to_id:
            from apps.notifications.models import Channel, Notification

            group, reason = manual_notice
            Notification.objects.create(
                organization=instance.organization, channel=Channel.INBOX,
                body=f"Группа ЛС {instance.client_account} изменена на {group or 'расчётную'}. {reason}",
                recipient_user_id=instance.assigned_to_id, account=instance, status=Notification.Status.SENT,
                created_by=self.context["request"].user if self.context.get("request") else None,
            )
        if instance.inheritance_case != was_inheritance or "inheritance_until" in validated_data:
            from .services.contracts import peers_for_user
            from .services.portfolio import sync_inheritance

            sync_inheritance(instance, was_inheritance, peers_for_user(user, instance))
            instance.refresh_from_db()
        author = self.context["request"].user if self.context.get("request") else None
        if instance.debtor_category_id != old_category:
            StatusHistory.objects.create(
                organization=instance.organization, account=instance, kind=StatusHistory.Kind.CATEGORY,
                old_value="" if old_category is None else str(old_category),
                new_value="" if instance.debtor_category_id is None else str(instance.debtor_category_id),
                reason="Категория должника",
                author=author,
            )
            from .services.contracts import peers_for_user
            from .services.portfolio import PortfolioRefresher

            visible = peers_for_user(user, instance)
            peer_ids = list(visible.exclude(pk=instance.pk).values_list("pk", flat=True))
            Account.objects.filter(pk__in=peer_ids).update(
                debtor_category_id=instance.debtor_category_id, updated_at=instance.updated_at,
            )
            refresher = PortfolioRefresher()
            for account in visible:
                account.refresh_from_db()
                refresher._scenarios(account)
            instance.refresh_from_db()
        if instance.residence_note != old_residence:
            StatusHistory.objects.create(
                organization=instance.organization, account=instance, kind=StatusHistory.Kind.RESIDENCE,
                old_value=old_residence, new_value=instance.residence_note, reason="Фактическое проживание",
                author=author,
            )
        if instance.legal_status != old_legal:
            StatusHistory.objects.create(
                organization=instance.organization, account=instance, kind=StatusHistory.Kind.LEGAL,
                old_value=old_legal, new_value=instance.legal_status, reason="Статус лица",
                author=author,
            )
        if instance.funnel_stage != old_stage:
            StatusHistory.objects.create(
                organization=instance.organization, account=instance, kind=StatusHistory.Kind.FUNNEL,
                old_value=old_stage, new_value=instance.funnel_stage, reason=funnel_reason,
                author=author,
            )
        if instance.contact_source_mode != old_mode:
            from .services.contacts import apply_call_priorities

            apply_call_priorities(instance)
        return instance


class AccountServiceSerializer(serializers.ModelSerializer):
    effective_group = serializers.IntegerField(read_only=True)
    account_number = serializers.CharField(source="account.client_account", read_only=True)
    address = serializers.CharField(source="account.account_address", read_only=True)
    payer = serializers.CharField(source="account.short_fio", read_only=True)
    payer_identifier = serializers.CharField(source="account.payer_identifier", read_only=True)
    payer_unp = serializers.CharField(source="account.payer_unp", read_only=True)
    category_name = serializers.CharField(source="account.debtor_category.name", default="", read_only=True)
    category_id = serializers.IntegerField(source="account.debtor_category_id", read_only=True)
    funnel_stage = serializers.CharField(source="account.funnel_stage", read_only=True)
    bankruptcy = serializers.BooleanField(source="account.bankruptcy", read_only=True)
    residence_note = serializers.CharField(source="account.residence_note", read_only=True)
    inheritance_case = serializers.BooleanField(source="account.inheritance_case", read_only=True)
    billing_provider = serializers.CharField(source="account.provider_short_name", read_only=True)
    schema_label = serializers.SerializerMethodField()
    rating_label = serializers.SerializerMethodField()
    assigned_name = serializers.CharField(source="account.assigned_to.registry_name", default="", read_only=True)
    ownership_type_name = serializers.CharField(source="account.ownership_type_name", read_only=True)
    housing_object = serializers.CharField(source="account.acc_category_full", read_only=True)
    subj_count = serializers.IntegerField(source="account.subj_count", read_only=True)
    account_months = serializers.IntegerField(source="account.months_debt", read_only=True)
    scenario_brief = serializers.SerializerMethodField()
    obligation_total = serializers.SerializerMethodField()
    registered_count = serializers.IntegerField(read_only=True)
    periods = serializers.SerializerMethodField()
    ais_account_id = serializers.IntegerField(source="account.account_id", read_only=True)

    class Meta:
        model = AccountService
        exclude = ["raw"]
        read_only_fields = [
            f.name for f in AccountService._meta.fields
            if f.name not in {"debt_group_manual", "debt_group_manual_reason", "scenario_name"}
        ]

    def get_schema_label(self, obj) -> str:
        return schema_label(obj.account)

    def get_rating_label(self, obj) -> str:
        account = obj.account
        return _rating_label(account.rating, account.rating_repeat)

    def get_scenario_brief(self, obj) -> str:
        if obj.scenario_name:
            return obj.scenario_name
        cache = self.context.setdefault("_published_scenarios", {})
        try:
            obj.account.scenario_run
        except ObjectDoesNotExist:
            published_scenario(obj.account.organization_id, cache)
        return scenario_brief(obj.account, cache)

    def get_periods(self, obj) -> list:
        from .services.board_lines import period_rows

        return period_rows(obj)

    def get_obligation_total(self, obj) -> str:
        return _add_money(obj.balance_out, obj.balance_mulct_out)

    def validate(self, attrs):
        group = attrs.get("debt_group_manual")
        reason = attrs.get("debt_group_manual_reason", getattr(self.instance, "debt_group_manual_reason", ""))
        if group is not None and not reason:
            raise serializers.ValidationError({"debt_group_manual_reason": "Укажите причину корректировки группы"})
        if group is not None and not 1 <= group <= 6:
            raise serializers.ValidationError({"debt_group_manual": "Группа от 1 до 6"})
        return attrs

    def update(self, instance, validated_data):
        if "scenario_name" in validated_data and validated_data["scenario_name"] != instance.scenario_name:
            instance.scenario_locked = True
        if "debt_group_manual" in validated_data and validated_data["debt_group_manual"] != instance.debt_group_manual:
            new_group = validated_data["debt_group_manual"]
            StatusHistory.objects.create(
                organization=instance.organization, account=instance.account, service=instance,
                kind=StatusHistory.Kind.GROUP,
                old_value="" if instance.effective_group is None else str(instance.effective_group),
                new_value="" if new_group is None else str(new_group),
                reason=validated_data.get("debt_group_manual_reason", instance.debt_group_manual_reason),
                author=self.context["request"].user if self.context.get("request") else None,
            )
            validated_data["debt_group_basis"] = instance.debt_group if new_group is not None else None
        return super().update(instance, validated_data)


class PaymentSerializer(serializers.ModelSerializer):
    payment_type_display = serializers.CharField(source="get_payment_type_display", read_only=True)

    class Meta:
        model = Payment
        exclude = ["raw"]


def mask_identifier(value: str) -> str:
    """В списках идентификационный номер не отдаётся целиком."""
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}{'*' * (len(value) - 4)}{value[-2:]}"


REGISTRATION_PM = {"social_category", "unfit_for_work", "heritage_transfer"}


class RegistrationSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="__str__", read_only=True)
    debtor_role = serializers.SerializerMethodField()

    class Meta:
        model = Registration
        exclude = ["raw"]
        read_only_fields = [f.name for f in Registration._meta.fields if f.name not in REGISTRATION_PM]

    def get_debtor_role(self, obj) -> str:
        return "Плательщик" if obj.subj_is_main else "Солидарный должник"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        view = self.context.get("view")
        number = data.get("personal_num") or ""
        if view is not None and getattr(view, "action", None) == "list" and number:
            data["personal_num"] = mask_identifier(number)
        return data


class ContactSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    source_display = serializers.CharField(source="get_source_display", read_only=True)

    class Meta:
        model = Contact
        exclude = ["raw"]
        read_only_fields = ["organization", "source", "priority", "ais_updated_at", "import_job"]

    def get_person_name(self, obj) -> str:
        return str(obj.registration) if obj.registration_id else ""

    def validate(self, attrs):
        if self.instance is not None and self.instance.source == Contact.Source.AIS:
            raise serializers.ValidationError("Контакт из АИС только для чтения")
        kind = attrs.get("kind", getattr(self.instance, "kind", ""))
        value = attrs.get("value", getattr(self.instance, "value", ""))
        if kind == Contact.Kind.EMAIL and "@" not in value:
            raise serializers.ValidationError({"value": "Укажите e-mail"})
        if kind in {Contact.Kind.MOBILE, Contact.Kind.CITY}:
            digits = "".join(ch for ch in value if ch.isdigit())
            if len(digits) < 5:
                raise serializers.ValidationError({"value": "Укажите телефон"})
        registration = attrs.get("registration", getattr(self.instance, "registration", None))
        account = attrs.get("account", getattr(self.instance, "account", None))
        if registration is not None and account is not None and registration.account_id != account.pk:
            raise serializers.ValidationError({"registration": "Лицо зарегистрировано на другом лицевом счёте"})
        return attrs

    def create(self, validated_data):
        validated_data["source"] = Contact.Source.PM
        validated_data.pop("priority", None)
        contact = super().create(validated_data)
        self._apply_mode(contact)
        return contact

    def update(self, instance, validated_data):
        validated_data.pop("priority", None)
        validated_data.pop("source", None)
        contact = super().update(instance, validated_data)
        self._apply_mode(contact)
        return contact

    def _apply_mode(self, contact):
        from .services.contacts import apply_call_priorities

        apply_call_priorities(contact.account)
        contact.refresh_from_db()


class BalanceHistorySerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source="service.service_name", read_only=True)

    class Meta:
        model = BalanceHistory
        exclude = ["raw"]


class StatusHistorySerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.display_name", default="", read_only=True)
    service_name = serializers.CharField(source="service.service_name", default="", read_only=True)

    class Meta:
        model = StatusHistory
        exclude = ["raw"]


class DebtWorkItemSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = DebtWorkItem
        exclude = ["raw"]
        read_only_fields = ["organization", "import_job"]


class AttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ["id", "account", "work_item", "doc_type", "original_name", "uploaded_by", "created_at"]
        read_only_fields = fields


class MeasureItemSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    call_result_display = serializers.CharField(source="get_call_result_display", read_only=True)
    delivery_method_display = serializers.CharField(source="get_delivery_method_display", read_only=True)
    client_account = serializers.CharField(source="account.client_account", read_only=True)
    debtor_name = serializers.CharField(source="account.short_fio", read_only=True)

    class Meta:
        model = MeasureItem
        fields = [
            "id", "account", "client_account", "debtor_name", "status", "status_display",
            "phone", "call_result", "call_result_display", "duration_sec", "listen_percent",
            "recipient", "delivery_error", "delivery_method", "delivery_method_display",
            "delivered_on", "recipient_name", "refused", "postal_id", "postal_status",
            "suspended_on", "resumed_on", "note", "warning_item", "acted_at",
        ]


class MeasureSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    accounts_count = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    debtor_name = serializers.SerializerMethodField()
    debtor_account = serializers.SerializerMethodField()
    debtor_id = serializers.SerializerMethodField()
    assignee_name = serializers.SerializerMethodField()
    next_action = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    account_item_status = serializers.SerializerMethodField()

    class Meta:
        model = Measure
        fields = [
            "id", "kind", "kind_display", "status", "status_display", "channel", "template_name",
            "scenario_name", "note", "assignee", "assignee_name", "started_on", "due_on", "days",
            "time_from", "time_to", "created_at", "accounts_count", "artifact", "title",
            "debtor_name", "debtor_account", "debtor_id", "next_action", "progress",
            "account_item_status", "needs_approval", "approval", "approval_note",
            "suspension_confirmed_on", "suspension_source", "resumed_on", "resume_source",
            "owner_provider_id", "owner_name",
        ]

    def _debtor(self, obj):
        cached = obj.__dict__.get("_debtor_cache")
        if cached is None:
            cached = debtor_fields(obj)
            obj.__dict__["_debtor_cache"] = cached
        return cached

    def get_accounts_count(self, obj) -> int:
        return accounts_count(obj)

    def get_title(self, obj) -> str:
        return measure_title(obj)

    def get_debtor_name(self, obj) -> str:
        return self._debtor(obj)[0]

    def get_debtor_account(self, obj) -> str:
        return self._debtor(obj)[1]

    def get_debtor_id(self, obj):
        return self._debtor(obj)[2]

    def get_assignee_name(self, obj) -> str:
        user = obj.assignee
        return user.display_name if user is not None else ""

    def get_next_action(self, obj) -> str:
        return next_action(obj)

    def get_progress(self, obj) -> dict:
        total = obj.__dict__.get("items_total")
        done = obj.__dict__.get("items_done")
        if total is None:
            visible = self.context.get("visible_accounts")
            qs = obj.items.all()
            if visible is not None:
                qs = qs.filter(account__in=visible)
            total = qs.count()
            done = qs.filter(status="done").count()
        return {"total": total or 0, "done": done or 0}

    def get_account_item_status(self, obj) -> str:
        view = self.context.get("view")
        if getattr(view, "action", None) != "measures":
            return ""
        account_id = getattr(view, "kwargs", {}).get("pk")
        for item in obj.items.all():
            if str(item.account_id) == str(account_id):
                return item.status_display if hasattr(item, "status_display") else item.get_status_display()
        return ""


class MeasureDetailSerializer(MeasureSerializer):
    items = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()
    tasks = serializers.SerializerMethodField()

    class Meta(MeasureSerializer.Meta):
        fields = [*MeasureSerializer.Meta.fields, "items", "events", "tasks", "call_legal", "group_from", "group_to"]

    def get_items(self, obj):
        qs = obj.items.select_related("account")
        visible = self.context.get("visible_accounts")
        if visible is not None:
            qs = qs.filter(account__in=visible)
        return MeasureItemSerializer(qs, many=True).data

    def get_events(self, obj):
        rows = obj.events.select_related("actor")[:40]
        return [
            {
                "id": row.id,
                "item": row.item_id,
                "old_status": row.old_status,
                "new_status": row.new_status,
                "reason": row.reason,
                "actor": row.actor.display_name if row.actor_id else "",
                "created_at": row.created_at,
            }
            for row in rows
        ]

    def get_tasks(self, obj):
        rows = []
        for task in obj.tasks.select_related("assignee").prefetch_related("checks"):
            rows.append({
                "id": task.id,
                "title": task.title,
                "due_on": task.due_on.isoformat() if task.due_on else None,
                "status": task.status,
                "assignee_name": task.assignee.display_name if task.assignee_id else "",
                "checks": [{"id": item.id, "title": item.title, "done": item.done} for item in task.checks.all()],
            })
        return rows


class RefreshRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefreshRequest
        fields = ["id", "account", "status", "created_at"]


class SavedFilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedFilter
        fields = ["id", "name", "target", "query", "columns", "created_at"]
        read_only_fields = ["created_at"]
