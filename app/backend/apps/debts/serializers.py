from rest_framework import serializers

from apps.nsi.models import DebtGroupScale

from .models import (
    Account,
    AccountService,
    Attachment,
    BalanceHistory,
    Contact,
    DebtWorkItem,
    Measure,
    Payment,
    RefreshRequest,
    Registration,
    SavedFilter,
    StatusHistory,
)

AIS_READ_ONLY = "Данные АИС только для чтения"


def _rating_label(rating: str, repeat: int | None) -> str:
    if not rating:
        return ""
    if rating == "E" or not repeat:
        return rating
    return f"{rating}/{repeat}"


class AccountListSerializer(serializers.ModelSerializer):
    services_count = serializers.IntegerField(read_only=True)
    debt_total = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    mulct_total = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    effective_group = serializers.IntegerField(read_only=True)
    assigned_name = serializers.CharField(source="assigned_to.display_name", default="", read_only=True)
    rating_label = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id", "organization", "account_id", "client_account", "unified_account", "provider_id",
            "provider_short_name", "account_address", "short_fio", "payer_identifier", "payer_unp", "balance_out",
            "debt_group", "effective_group", "rating", "rating_label", "debt_started_on", "scenario_name",
            "assigned_name", "ownership_type_name", "months_debt", "subj_count", "funnel_stage",
            "services_count", "debt_total", "mulct_total", "warning_due", "claim_due", "updated_at",
            "ais_updated_at", "operational_date", "inheritance_case", "debtor_category",
        ]

    def get_rating_label(self, obj) -> str:
        return _rating_label(obj.rating, obj.rating_repeat)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return _supplier_totals(instance, data)


def _supplier_totals(instance, data):
    if not hasattr(instance, "supplier_principal"):
        return data
    principal = instance.supplier_principal
    data["balance_out"] = principal or 0
    if "debt_total" in data:
        data["debt_total"] = principal or 0
    if "mulct_total" in data:
        data["mulct_total"] = getattr(instance, "supplier_penalty", None) or 0
    services = getattr(instance, "supplier_services", None)
    if services is not None and "services_count" in data:
        data["services_count"] = services
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
    assigned_name = serializers.CharField(source="assigned_to.display_name", default="", read_only=True)

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

    def get_rating_label(self, obj) -> str:
        return _rating_label(obj.rating, obj.rating_repeat)

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
        return attrs

    def update(self, instance, validated_data):
        from .models import StatusHistory

        if "funnel_stage" in validated_data and validated_data["funnel_stage"] != instance.funnel_stage:
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
    rating_label = serializers.SerializerMethodField()

    class Meta:
        model = AccountService
        exclude = ["raw"]
        read_only_fields = [
            f.name for f in AccountService._meta.fields
            if f.name not in {"debt_group_manual", "debt_group_manual_reason", "scenario_name"}
        ]

    def get_rating_label(self, obj) -> str:
        account = obj.account
        return _rating_label(account.rating, account.rating_repeat)

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

    class Meta:
        model = Contact
        exclude = ["raw"]
        read_only_fields = ["organization", "source", "ais_updated_at", "import_job"]

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


class MeasureSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    accounts_count = serializers.IntegerField(source="accounts.count", read_only=True)

    class Meta:
        model = Measure
        fields = [
            "id", "kind", "kind_display", "status", "status_display", "channel", "template_name",
            "scenario_name", "note", "assignee", "started_on", "due_on", "days", "time_from", "time_to",
            "created_at", "accounts_count", "artifact",
            "suspension_confirmed_on", "suspension_source", "resumed_on", "resume_source",
        ]


class RefreshRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefreshRequest
        fields = ["id", "account", "status", "created_at"]


class SavedFilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedFilter
        fields = ["id", "name", "target", "query", "columns", "created_at"]
        read_only_fields = ["created_at"]
