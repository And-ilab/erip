from django.contrib import admin

from .models import BnpDebtType, BnpDocType, BnpService, DebtGroupScale

admin.site.register(DebtGroupScale)
admin.site.register(BnpService)
admin.site.register(BnpDebtType)
admin.site.register(BnpDocType)
