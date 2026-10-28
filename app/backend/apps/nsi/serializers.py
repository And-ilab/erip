from rest_framework import serializers

from .models import (
    BnpDebtType,
    BnpDocType,
    BnpService,
    CalculationSettings,
    DebtGroupScale,
    DebtorCategory,
    ExtraMeasureCatalog,
    NotaryOffice,
    OpiOffice,
    PrintForm,
    ScenarioDefinition,
    ScenarioRule,
)


class ExtraMeasureCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtraMeasureCatalog
        fields = ["id", "organization", "name", "note", "is_active"]
        read_only_fields = ["organization"]


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
        fields = ["id", "organization", "code", "name", "note", "section", "sort_order", "is_active"]
        read_only_fields = ["is_active"]


class ScenarioDefinitionSerializer(serializers.ModelSerializer):
    revisions = serializers.SerializerMethodField()
    call_legal = serializers.BooleanField(required=False, allow_null=True)

    class Meta:
        model = ScenarioDefinition
        fields = [
            "id", "organization", "name", "status", "version", "steps", "based_on", "is_active", "revisions",
            "call_legal", "dial_mobile_from_day", "dial_mobile_weekdays",
            "call_from_day", "weekday_from", "weekday_to", "weekend_from", "weekend_to",
        ]
        read_only_fields = ["is_active", "status", "version", "organization", "revisions"]

    def validate_call_from_day(self, value):
        if value is None:
            return 27
        if value < 27 or value > 31:
            raise serializers.ValidationError("Старт обзвона не раньше 27-го и не позже 31-го")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        for start_key, end_key, label in (
            ("weekday_from", "weekday_to", "Будни"),
            ("weekend_from", "weekend_to", "Выходные"),
        ):
            start = attrs.get(start_key, getattr(self.instance, start_key, None))
            end = attrs.get(end_key, getattr(self.instance, end_key, None))
            if start and end and start >= end:
                raise serializers.ValidationError({end_key: f"{label}: время «по» должно быть позже «с»"})
        return attrs

    def get_revisions(self, obj) -> list[dict]:
        return [
            {
                "version": revision.version,
                "at": revision.created_at.isoformat(),
                "author": revision.author.display_name if revision.author_id else "",
            }
            for revision in obj.revisions.all()
        ]


_CYR_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _slug_code(raw_code: str, name: str) -> str:
    import re
    import uuid

    source = (raw_code or name or "template").strip().lower()
    translit = "".join(_CYR_MAP.get(ch, ch) for ch in source)
    slug = re.sub(r"[^a-z0-9_-]+", "-", translit).strip("-_")[:80]
    return slug or f"tpl-{uuid.uuid4().hex[:6]}"


class PrintFormSerializer(serializers.ModelSerializer):
    revisions = serializers.SerializerMethodField()
    code = serializers.CharField(max_length=100, required=False, allow_blank=True)
    body = serializers.CharField(required=False, allow_blank=True, default="")

    class Meta:
        model = PrintForm
        fields = [
            "id", "organization", "code", "name", "doc_kind", "addressee", "body", "font_size", "indent_mm",
            "outdent_mm", "block_order", "logo_text", "requisites", "signatory", "blocks", "blank",
            "version", "is_active", "revisions",
        ]
        read_only_fields = ["is_active", "version", "organization", "revisions"]
        validators = []

    def validate(self, attrs):
        if self.instance is None or "code" in attrs:
            raw_code = attrs.get("code", getattr(self.instance, "code", ""))
            name = attrs.get("name", getattr(self.instance, "name", ""))
            base_code = _slug_code(str(raw_code or ""), str(name or ""))
            request = self.context.get("request")
            if self.instance is not None:
                org = self.instance.organization
            elif request and getattr(request, "user", None):
                org = None if (request.user.is_superadmin and not request.user.organization_id) else request.user.organization
            else:
                org = None
            addressee = attrs.get("addressee", getattr(self.instance, "addressee", "debtor")) or "debtor"
            candidate = base_code
            seq = 2
            qs = PrintForm.objects.filter(organization=org, addressee=addressee)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            while qs.filter(code=candidate).exists():
                candidate = f"{base_code[:90]}-{seq}"
                seq += 1
            attrs["code"] = candidate

        blank = attrs.get("blank", serializers.empty)
        if blank is not serializers.empty and blank:
            from .services.official_blanks import known

            if not known(str(blank)):
                raise serializers.ValidationError({"blank": "Такого бланка образца нет"})
        blocks = attrs.get("blocks", serializers.empty)
        if blocks is serializers.empty:
            return attrs
        from .services.form_layout import apply_blocks, clean_blocks

        try:
            cleaned = clean_blocks(blocks)
        except ValueError as exc:
            raise serializers.ValidationError({"blocks": str(exc)}) from exc
        attrs["blocks"] = cleaned

        class _Probe:
            body = ""
            logo_text = ""
            requisites = ""
            signatory = ""
            blocks = []

        probe = _Probe()
        apply_blocks(probe, cleaned)
        attrs["body"] = probe.body or attrs.get("body") or ""
        attrs["logo_text"] = probe.logo_text
        attrs["requisites"] = probe.requisites
        attrs["signatory"] = probe.signatory
        return attrs

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


class NotaryOfficeSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotaryOffice
        fields = ["code", "name", "district", "address", "phones", "is_active"]


class OpiOfficeSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpiOffice
        fields = ["id", "organization", "code", "name", "region", "address", "phones", "email", "is_active"]
        read_only_fields = ["organization", "is_active"]


class BnpDocTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = BnpDocType
        fields = ["code", "name", "is_active"]
