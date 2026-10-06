from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.debts.models import Account, Measure
from apps.imports.sample_catalog import sample_files
from apps.users.models import Organization


class Command(BaseCommand):
    help = (
        "Удаляет лицевые счета и мероприятия схем из каталога выборки и загружает файлы заново. "
        "Пользователей и другие схемы не трогает."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dir", type=Path, default=None, help="Каталог файлов, по умолчанию AIS_SAMPLE_DIR")

    def handle(self, **options):
        directory = Path(options["dir"] or settings.AIS_SAMPLE_DIR)
        files = sample_files(directory)
        if not files:
            raise CommandError(f"В каталоге нет файлов выборки: {directory}")
        schemas = sorted({schema for schema, _entity, _path in files})
        organizations = list(Organization.objects.filter(schema_name__in=schemas))
        if organizations:
            measures, _measure_detail = Measure.objects.filter(organization__in=organizations).delete()
            accounts, _account_detail = Account.objects.filter(organization__in=organizations).delete()
            names = ", ".join(org.schema_name for org in organizations)
            self.stdout.write(f"Удалено по схемам {names}: лицевых счетов {accounts}, мероприятий {measures}")
        else:
            self.stdout.write("Схем выборки в базе ещё нет, удалять нечего")
        call_command("load_ais_sample", dir=directory)
        self.stdout.write(self.style.SUCCESS("Выборка загружена заново. Дальше: link_territories"))
