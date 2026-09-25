from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
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
        user = self.request.user
        if not user.is_superadmin:
            provider_ids = list(user.service_organizations.values_list("provider_id", flat=True))
            if provider_ids:
                qs = qs.filter(Q(account__provider_id__in=provider_ids) | Q(account__isnull=True, recipient_user=user))
        if self.request.query_params.get("mine") in {"1", "true"}:
            qs = qs.filter(recipient_user=user)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        existing = self._open_duplicate(serializer.validated_data)
        if existing is not None:
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        try:
            with transaction.atomic():
                notification = self._persist(serializer)
        except IntegrityError:
            existing = self._open_duplicate(serializer.validated_data)
            if existing is None:
                raise
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        NotificationDispatcher().dispatch(notification)
        headers = self.get_success_headers(serializer.data)
        return Response(self.get_serializer(notification).data, status=status.HTTP_201_CREATED, headers=headers)

    def _open_duplicate(self, data):
        """Пока отправка не завершилась, повтор той же пары ЛС/шаблон/канал не создаёт вторую запись."""
        account = data.get("account")
        template = data.get("template")
        if account is None or template is None:
            return None
        return (
            Notification.objects.filter(
                created_by=self.request.user,
                account=account,
                template=template,
                channel=data["channel"],
                status__in=(Notification.Status.NEW, Notification.Status.QUEUED),
            )
            .order_by("-id")
            .first()
        )

    def _persist(self, serializer):
        organization = self.get_scope_organization()
        account = serializer.validated_data.get("account")
        if organization is None and account is not None:
            organization = account.organization
        if organization is None:
            raise ValidationError({"organization": "Не удалось определить схему оповещения"})
        return serializer.save(organization=organization, created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        notification = self.get_object()
        if notification.status in {Notification.Status.NEW, Notification.Status.QUEUED}:
            raise ValidationError("Оповещение уже передаётся")
        notification = NotificationDispatcher().dispatch(notification)
        return Response(self.get_serializer(notification).data)

    @action(detail=True, methods=["post"], url_path="mark-read", write_roles=None)
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if notification.recipient_user_id != request.user.id:
            raise PermissionDenied("Отметить прочитанным можно только своё уведомление")
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
