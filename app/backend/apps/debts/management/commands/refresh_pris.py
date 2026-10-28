"""Обновление хода производств АИС ПРИС по уже переданным делам."""

from django.core.management.base import BaseCommand

from apps.debts.services.pris_submit import refresh_open_proceedings


class Command(BaseCommand):
    help = "Запрашивает ход производства ПРИС по делам с идентификатором долга или номером производства."

    def handle(self, *args, **options):
        result = refresh_open_proceedings()
        self.stdout.write(f"Обновлено дел: {result['refreshed']}. Не принято: {len(result['blocked'])}.")
        for row in result["blocked"]:
            self.stdout.write(f"Дело {row['id']}: {row['message']}")
        self.stdout.write(
            "При GW_PRIS_MODE=stub номер из примера регламента на дело не пишется. "
            "При channel пишется номер тестового канала. Контур Минюста вызывается при http."
        )
