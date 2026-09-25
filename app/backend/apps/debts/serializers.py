from rest_framework import serializers

from apps.nsi.models import DebtGroupScale

from .models import Account, AccountService, Payment, Registration

AIS_READ_ONLY = "Данные АИС только для чтения"


class AccountListSerializer(serializers.ModelSerializer):
    services_count = serializers.IntegerField(read_only=True)
    debt_total = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    effective_group = serializers.IntegerField(read_only=True)

    class Meta:
        model = Account
        fields = [
            "id", "organization", "account_id", "client_account", "unified_account", "provider_id",
            "provider_short_name", "account_address", "short_fio", "balance_out", "debt_group", "effective_group",
            "services_count", "debt_total", "updated_at",
        ]


class AccountDetailSerializer(serializers.ModelSerializer):
    effective_group = serializers.IntegerField(read_only=True)
    group_name = serializers.SerializerMethodField()

    class Meta:
        model = Account
        exclude = ["raw"]
        read_only_fields = [
            f.name for f in Account._meta.fields if f.name not in {"debt_group_manual", "debt_group_manual_reason"}
        ]

    def get_group_name(self, obj) -> str:
        group = obj.effective_group
        if not group:
            return ""
        scale = DebtGroupScale.objects.filter(group=group, is_active=True).first()
        return scale.name if scale else ""

    def validate(self, attrs):
        group = attrs.get("debt_group_manual")
        reason = attrs.get("debt_group_manual_reason", getattr(self.instance, "debt_group_manual_reason", ""))
        if group is not None and not reason:
            raise serializers.ValidationError({"debt_group_manual_reason": "Укажите причину корректировки группы"})
        if group is not None and not 1 <= group <= 6:
            raise serializers.ValidationError({"debt_group_manual": "Группа от 1 до 6"})
        return attrs


class AccountServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountService
        exclude = ["raw"]


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


class RegistrationSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="__str__", read_only=True)

    class Meta:
        model = Registration
        exclude = ["raw"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        view = self.context.get("view")
        number = data.get("personal_num") or ""
        if view is not None and getattr(view, "action", None) == "list" and number:
            data["personal_num"] = mask_identifier(number)
        return data
