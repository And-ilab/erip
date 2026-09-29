"""Раскладывает уже загруженные лицевые счета по дереву адресов. Повтор безопасен."""

from django.core.management.base import BaseCommand

from apps.debts.models import Account
from apps.debts.services.territory import TerritoryIndex


class Command(BaseCommand):
    help = "Привязать лицевые счета к дереву адресов для карты"

    def handle(self, *args, **options):
        updated = TerritoryIndex().assign_queryset(Account.objects.all())
        self.stdout.write(f"Обновлено привязок: {updated}")
