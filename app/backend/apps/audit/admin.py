from django.contrib import admin

from .models import AuditLog, ErrorLog


@admin.register(ErrorLog)
class ErrorLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "service", "error_type", "request_id", "path"]
    list_filter = ["service", "error_type"]
    search_fields = ["message", "request_id", "path"]
    readonly_fields = [f.name for f in ErrorLog._meta.fields]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "user", "action", "object_type", "object_id"]
    list_filter = ["action", "object_type"]
    search_fields = ["object_id", "request_id"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]
