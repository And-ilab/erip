from django.contrib import admin

from .models import MessageTemplate, Notification


@admin.register(MessageTemplate)
class MessageTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "channel", "debt_group", "organization", "is_active"]
    list_filter = ["channel", "debt_group", "organization", "is_active"]


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "channel", "recipient_name", "status", "organization"]
    list_filter = ["channel", "status", "organization"]
    readonly_fields = ["rendered_text", "error", "gateway_id", "request_id"]
