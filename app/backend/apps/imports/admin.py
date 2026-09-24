from django.contrib import admin

from .models import ImportJob


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ["created_at", "organization", "entity", "file_name", "status", "total", "created", "rejected"]
    list_filter = ["entity", "status", "organization"]
    readonly_fields = [f.name for f in ImportJob._meta.fields]
