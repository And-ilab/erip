"""Раскладывает уже загруженные лицевые счета по дереву адресов. Повтор безопасен."""

from django.core.management.base import BaseCommand

from apps.debts.models import Account
from apps.debts.services.street_catalog import default_catalog
from apps.debts.services.territory import TerritoryIndex


class Command(BaseCommand):
    help = "Привязать лицевые счета к дереву адресов для карты"

    def handle(self, *args, **options):
        catalog = default_catalog()
        if catalog.is_empty:
            self.stdout.write("Справочник улиц пуст: неизвестная улица встанет у центра города схемы.")
        else:
            self.stdout.write(f"Справочник: улиц {catalog.street_count}, населённых пунктов {catalog.place_count}")
        updated = TerritoryIndex(catalog).assign_queryset(Account.objects.all())
        self.stdout.write(f"Обновлено привязок: {updated}")
