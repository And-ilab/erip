from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import IsInternalService, RolePermission
from apps.users.scoping import ScopedQuerysetMixin

from .models import Channel, MessageTemplate, Notification
from .serializers import (
    DeliveryStatusSerializer,
    MessageTemplateSerializer,
    NotificationSerializer,
    TemplatePreviewSerializer,
)
from .services.dispatcher import NotificationDispatcher, apply_delivery_status


class MessageTemplateViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """Шаблоны: центральные (organization=None) видны всем, локальные — своей схеме."""

    queryset = MessageTemplate.objects.all()
    serializer_class = MessageTemplateSerializer
    permission_classes = [RolePermission]
    write_roles = ("superadmin", "local_admin")
    filterset_fields = ["channel", "is_active", "organization"]
    search_fields = ["name", "code", "body"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superadmin:
            return qs
        return qs.filter(Q(organization__isnull=True) | Q(organization=user.organization_id))

    @action(detail=True, methods=["post"], permission_classes=[RolePermission], write_roles=None)
    def preview(self, request, pk=None):
        template = self.get_object()
        data = TemplatePreviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        text = NotificationDispatcher().preview(
            data.validated_data.get("body") or template.body,
            data.validated_data["user_name"],
            data.validated_data["context"],
            template.channel,
        )
        return Response({"text": text})


class NotificationViewSet(ScopedQuerysetMixin, mixins.CreateModelMixin, mixins.ListModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Notification.objects.select_related("template", "account", "recipient_user")
    serializer_class = NotificationSerializer
    permission_classes = [RolePermission]
    write_roles = RolePermission.default_write_roles
    filterset_fields = ["status", "channel", "is_read", "account", "recipient_user"]
    ordering_fields = ["created_at", "status"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("mine") in {"1", "true"}:
            qs = qs.filter(recipient_user=self.request.user)
        return qs

    def perform_create(self, serializer):
        organization = self.get_scope_organization()
        account = serializer.validated_data.get("account")
        if organization is None and account is not None:
            organization = account.organization
        if organization is None:
            raise ValidationError({"organization": "Не удалось определить схему оповещения"})
        notification = serializer.save(organization=organization, created_by=self.request.user)
        NotificationDispatcher().dispatch(notification)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        notification = NotificationDispatcher().dispatch(self.get_object())
        return Response(self.get_serializer(notification).data)

    @action(detail=True, methods=["post"], url_path="mark-read", write_roles=None)
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read", "updated_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, url_path="unread-count")
    def unread_count(self, request):
        count = Notification.objects.filter(
            recipient_user=request.user, channel=Channel.INBOX, status=Notification.Status.SENT, is_read=False
        ).count()
        return Response({"count": count})

    @action(detail=True, methods=["post"], url_path="delivery-status",
            permission_classes=[IsInternalService], authentication_classes=[])
    def delivery_status(self, request, pk=None):
        """Callback шлюза с итогом доставки (служебный токен, без JWT)."""
        notification = Notification.objects.filter(pk=pk).first()
        if notification is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        data = DeliveryStatusSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        apply_delivery_status(
            notification, data.validated_data["status"], error=data.validated_data["error"],
            text=data.validated_data["rendered_text"],
        )
        return Response({"id": notification.pk, "status": notification.status})
