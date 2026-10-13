from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.debts.models import Account, Measure, Territory
from apps.imports.sample_catalog import sample_files


class Command(BaseCommand):
    help = (
        "Очищает все карточки лицевых счетов, мероприятия и карту, затем загружает "
        "только файлы выборки тем же импортом, что экран «Загрузка АИС». Пользователей не удаляет."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dir", type=Path, default=None, help="Каталог файлов, по умолчанию AIS_SAMPLE_DIR")

    def handle(self, **options):
        directory = Path(options["dir"] or settings.AIS_SAMPLE_DIR)
        files = sample_files(directory)
        if not files:
            raise CommandError(f"В каталоге нет файлов выборки: {directory}")
        measures, _measure_detail = Measure.objects.all().delete()
        accounts, _account_detail = Account.objects.all().delete()
        territories, _territory_detail = Territory.objects.all().delete()
        self.stdout.write(
            f"Очищено: лицевых счетов {accounts}, мероприятий {measures}, узлов карты {territories}"
        )
        call_command("load_ais_sample", dir=directory)
        self.stdout.write(self.style.SUCCESS(
            "Загружены только файлы выборки. Дальше: link_territories"
        ))
