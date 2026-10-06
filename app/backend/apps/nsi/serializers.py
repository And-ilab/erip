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
        from .services.scale import scale_problem

        months_from = attrs.get("months_from", getattr(self.instance, "months_from", 0))
        months_to = attrs.get("months_to", getattr(self.instance, "months_to", None))
        if months_to is not None and months_to <= months_from:
            raise serializers.ValidationError({"months_to": "Верхняя граница должна быть больше нижней"})
        group = attrs.get("group", getattr(self.instance, "group", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        rows = []
        others = DebtGroupScale.objects.filter(is_active=True)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if is_active:
            rows.append((group, months_from, months_to))
        rows.extend((row.group, row.months_from, row.months_to) for row in others)
        problem = scale_problem(rows)
        if problem:
            raise serializers.ValidationError(problem)
        return attrs


class DebtorCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = DebtorCategory
        fields = ["id", "organization", "code", "name", "note", "is_active"]
        read_only_fields = ["is_active"]


class ScenarioDefinitionSerializer(serializers.ModelSerializer):
    revisions = serializers.SerializerMethodField()
    call_legal = serializers.BooleanField(required=False, allow_null=True)

    class Meta:
        model = ScenarioDefinition
        fields = [
            "id", "organization", "name", "status", "version", "steps", "based_on", "is_active", "revisions",
            "call_legal", "dial_mobile_from_day", "dial_mobile_weekdays",
        ]
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
        fields = [
            "id", "organization", "code", "name", "doc_kind", "addressee", "body", "font_size", "indent_mm",
            "outdent_mm", "block_order", "logo_text", "requisites", "signatory", "version", "is_active", "revisions",
        ]
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
            "dial_mobile_from_hour", "dial_mobile_to_hour", "dial_mobile_weekdays",
            "rating_b_group", "rating_c_from", "rating_c_to", "rating_e_from",
            "warning_wait_days", "disconnect_requires_approval",
        ]

    def validate(self, attrs):
        from .services.scale import rating_problem

        b_group = attrs.get("rating_b_group", getattr(self.instance, "rating_b_group", 3))
        c_from = attrs.get("rating_c_from", getattr(self.instance, "rating_c_from", 4))
        c_to = attrs.get("rating_c_to", getattr(self.instance, "rating_c_to", 5))
        e_from = attrs.get("rating_e_from", getattr(self.instance, "rating_e_from", 6))
        problem = rating_problem(b_group, c_from, c_to, e_from)
        if problem:
            raise serializers.ValidationError(problem)
        weekdays = attrs.get("dial_mobile_weekdays", getattr(self.instance, "dial_mobile_weekdays", [5, 6]))
        if not isinstance(weekdays, list) or any(not isinstance(day, int) or day < 0 or day > 6 for day in weekdays):
            raise serializers.ValidationError({"dial_mobile_weekdays": "Дни недели — числа от 0 до 6"})
        return attrs


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
