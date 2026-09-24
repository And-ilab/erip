from rest_framework import serializers

from .models import AuditLog, ErrorLog


class ErrorLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ErrorLog
        fields = ["id", "service", "request_id", "path", "error_type", "message", "traceback", "user_id", "created_at"]


class ErrorIngestSerializer(serializers.Serializer):
    """Ошибка, присланная шлюзом."""

    service = serializers.CharField(max_length=50, default="gateway")
    request_id = serializers.CharField(max_length=64, allow_blank=True, default="")
    path = serializers.CharField(max_length=500, allow_blank=True, default="")
    error_type = serializers.CharField(max_length=200)
    message = serializers.CharField()
    traceback = serializers.CharField(allow_blank=True, default="")


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "user", "username", "action", "object_type", "object_id",
            "before", "after", "request_id", "ip", "created_at",
        ]
