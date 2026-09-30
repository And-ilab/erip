from rest_framework import serializers

from .models import (
    BnpDebtType,
    BnpDocType,
    BnpService,
    CalculationSettings,
    DebtGroupScale,
    DebtorCategory,
    PrintForm,
    ScenarioDefinition,
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


class ScenarioDefinitionSerializer(serializers.ModelSerializer):
    revisions = serializers.SerializerMethodField()

    class Meta:
        model = ScenarioDefinition
        fields = ["id", "organization", "name", "status", "version", "steps", "based_on", "is_active", "revisions"]
        read_only_fields = ["is_active", "status", "version", "organization", "revisions"]

    def get_revisions(self, obj) -> list[dict]:
        return [
            {
                "version": revision.version,
                "at": revision.created_at.isoformat(),
                "author": revision.author.display_name if revision.author_id else "",
            }
            for revision in obj.revisions.all()
        ]


class PrintFormSerializer(serializers.ModelSerializer):
    revisions = serializers.SerializerMethodField()

    class Meta:
        model = PrintForm
        fields = ["id", "organization", "code", "name", "doc_kind", "body", "version", "is_active", "revisions"]
        read_only_fields = ["is_active", "version", "organization", "revisions"]

    def get_revisions(self, obj) -> list[dict]:
        return [
            {"version": revision.version, "at": revision.created_at.isoformat()}
            for revision in obj.revisions.all()
        ]


class ScenarioRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScenarioRule
        fields = ["id", "group", "name", "category", "is_active"]
        read_only_fields = ["is_active"]


class CalculationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalculationSettings
        fields = [
            "rating_period_months", "close_threshold", "payment_due_day", "dial_mobile_from_day",
            "dial_mobile_from_hour", "dial_mobile_to_hour", "warning_wait_days", "disconnect_requires_approval",
        ]


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
