from rest_framework import serializers

from apps.debts.models import Account
from apps.users.models import User

from .models import Channel, MessageTemplate, Notification
from .services.dispatcher import template_for_account


class MessageTemplateSerializer(serializers.ModelSerializer):
    channel_display = serializers.CharField(source="get_channel_display", read_only=True)
    is_central = serializers.SerializerMethodField()
    revisions = serializers.SerializerMethodField()

    class Meta:
        model = MessageTemplate
        fields = [
            "id", "organization", "is_central", "code", "name", "channel", "channel_display", "subject", "body",
            "debt_group", "version", "revisions", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["is_active", "created_at", "updated_at", "version", "revisions"]

    def get_is_central(self, obj) -> bool:
        return obj.organization_id is None

    def get_revisions(self, obj) -> list[dict]:
        return [
            {
                "version": revision.version,
                "at": revision.created_at.isoformat(),
                "author": revision.author.display_name if revision.author_id else "",
            }
            for revision in obj.revisions.all()
        ]

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.is_superadmin:
            # Локальные шаблоны — только своей схемы; центральные правит суперадминистратор
            attrs["organization"] = user.organization
        return attrs

    def create(self, validated_data):
        from .services.versions import remember_template

        template = super().create(validated_data)
        return remember_template(template, None, None, self.context["request"].user)

    def update(self, instance, validated_data):
        from .services.versions import remember_template

        previous_body, previous_subject = instance.body, instance.subject
        template = super().update(instance, validated_data)
        return remember_template(template, previous_body, previous_subject, self.context["request"].user)


class TemplatePreviewSerializer(serializers.Serializer):
    user_name = serializers.CharField(max_length=250, default="Иван Иванович")
    context = serializers.DictField(required=False, default=dict)
    body = serializers.CharField(required=False, help_text="Черновик текста вместо сохранённого")


class NotificationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    channel_display = serializers.CharField(source="get_channel_display", read_only=True)
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.all(), required=False, allow_null=True)
    recipient_user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Notification
        fields = [
            "id", "organization", "channel", "channel_display", "template", "template_version", "body",
            "recipient_user", "account",
            "recipient_name", "recipient_address", "context", "status", "status_display", "gateway_id",
            "rendered_text", "error", "request_id", "is_read", "sent_at", "created_at",
        ]
        read_only_fields = [
            "organization", "status", "gateway_id", "rendered_text", "error", "request_id", "is_read", "sent_at",
            "created_at", "template_version",
        ]

    def create(self, validated_data):
        template = validated_data.get("template")
        if template is not None:
            validated_data["template_version"] = template.version
        return super().create(validated_data)

    def validate(self, attrs):
        user = self.context["request"].user
        template = attrs.get("template")
        if template is None and not attrs.get("body"):
            template = template_for_account(attrs.get("account"), attrs["channel"])
            if template is not None:
                attrs["template"] = template
        if not template and not attrs.get("body"):
            raise serializers.ValidationError({"template": "Укажите шаблон или текст сообщения"})
        if template and template.channel != attrs["channel"]:
            raise serializers.ValidationError({"template": "Канал шаблона не совпадает с каналом оповещения"})
        if not attrs.get("recipient_user") and not attrs.get("account") and not attrs.get("recipient_address"):
            raise serializers.ValidationError({"recipient_user": "Укажите получателя"})
        if attrs["channel"] == Channel.INBOX and not attrs.get("recipient_user"):
            raise serializers.ValidationError({"recipient_user": "Для панели уведомлений нужен пользователь ПМ"})
        if not user.is_superadmin:
            account = attrs.get("account")
            recipient = attrs.get("recipient_user")
            providers = list(user.service_organizations.values_list("provider_id", flat=True))
            if account and account.organization_id != user.organization_id:
                raise serializers.ValidationError({"account": "ЛС вне контура доступа"})
            if account and providers and account.provider_id not in providers:
                raise serializers.ValidationError({"account": "ЛС вне контура доступа"})
            if recipient and recipient.organization_id != user.organization_id:
                raise serializers.ValidationError({"recipient_user": "Пользователь другой схемы"})
            if template and template.organization_id not in (None, user.organization_id):
                raise serializers.ValidationError({"template": "Шаблон другой схемы"})
        return attrs


class DeliveryStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["delivered", "failed"])
    error = serializers.CharField(required=False, allow_blank=True, default="")
    rendered_text = serializers.CharField(required=False, allow_blank=True, default="")
