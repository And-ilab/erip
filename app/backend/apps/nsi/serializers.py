from rest_framework import serializers

from .models import (
    BnpDebtType,
    BnpDocType,
    BnpService,
    CalculationSettings,
    DebtGroupScale,
    DebtorCategory,
    ScenarioRule,
)


class DebtGroupScaleSerializer(serializers.ModelSerializer):
    class Meta:
        model = DebtGroupScale
        fields = ["id", "group", "name", "months_from", "months_to", "is_active"]
        read_only_fields = ["is_active"]

    def validate(self, attrs):
        months_from = attrs.get("months_from", getattr(self.instance, "months_from", 0))
        months_to = attrs.get("months_to", getattr(self.instance, "months_to", None))
        if months_to is not None and months_to <= months_from:
            raise serializers.ValidationError({"months_to": "Верхняя граница должна быть больше нижней"})
        return attrs


class DebtorCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DebtorCategory
        fields = ["id", "organization", "code", "name", "note", "is_active"]
        read_only_fields = ["is_active"]


class ScenarioRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScenarioRule
        fields = ["id", "group", "name", "category", "is_active"]
        read_only_fields = ["is_active"]


class CalculationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalculationSettings
        fields = ["rating_period_months", "close_threshold", "payment_due_day", "dial_mobile_from_day"]


class BnpDebtTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = BnpDebtType
        fields = ["code", "name", "is_active"]


class BnpServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = BnpService
        fields = ["service_id", "type_id", "name", "debt_types", "is_active"]


class BnpDocTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = BnpDocType
        fields = ["code", "name", "is_active"]
