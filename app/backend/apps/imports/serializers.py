from rest_framework import serializers

from apps.users.models import Organization

from .models import ImportJob

MAX_UPLOAD_MB = 50


class ImportJobSerializer(serializers.ModelSerializer):
    entity_display = serializers.CharField(source="get_entity_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ImportJob
        fields = [
            "id", "organization", "entity", "entity_display", "file_name", "checksum", "encoding", "status",
            "status_display", "total", "created", "updated", "unchanged", "rejected", "errors", "unknown_columns",
            "started_by", "created_at", "finished_at",
        ]
        read_only_fields = fields


class ImportUploadSerializer(serializers.Serializer):
    entity = serializers.ChoiceField(choices=ImportJob.Entity.choices)
    file = serializers.FileField()
    organization = serializers.PrimaryKeyRelatedField(queryset=Organization.objects.all(), required=False)

    def validate_file(self, file):
        if file.size > MAX_UPLOAD_MB * 1024 * 1024:
            raise serializers.ValidationError(f"Файл больше {MAX_UPLOAD_MB} МБ")
        if not file.name.lower().endswith((".csv", ".txt")):
            raise serializers.ValidationError("Ожидается файл CSV")
        return file

    def validate(self, attrs):
        user = self.context["request"].user
        if user.is_superadmin:
            if "organization" not in attrs:
                raise serializers.ValidationError({"organization": "Укажите схему для импорта"})
        else:
            attrs["organization"] = user.organization
        return attrs
