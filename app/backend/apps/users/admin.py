from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Organization, ServiceOrganization, User


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "schema_name", "unp", "is_active"]
    search_fields = ["name", "schema_name"]


@admin.register(ServiceOrganization)
class ServiceOrganizationAdmin(admin.ModelAdmin):
    list_display = ["short_name", "provider_id", "organization", "is_supplier", "is_active"]
    list_filter = ["organization", "is_supplier"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "last_name", "first_name", "role", "organization", "is_active"]
    list_filter = ["role", "organization", "is_active"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("ПМ", {"fields": ("role", "organization", "service_organizations", "middle_name", "position", "phone")}),
    )
