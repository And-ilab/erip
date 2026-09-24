from django.contrib import admin

from .models import Account, AccountService, Payment, Registration


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = True


class ServiceInline(ReadOnlyInline):
    model = AccountService
    fields = ["service_name", "shot_name", "balance_out", "debt_period", "debt_group"]
    readonly_fields = fields


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ["client_account", "short_fio", "provider_short_name", "balance_out", "debt_group", "organization"]
    list_filter = ["organization", "debt_group"]
    search_fields = ["client_account", "short_fio", "account_address"]
    inlines = [ServiceInline]


admin.site.register(AccountService)
admin.site.register(Payment)
admin.site.register(Registration)
