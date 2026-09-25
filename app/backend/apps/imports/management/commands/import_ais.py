from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.imports.field_maps import ENTITY_MAPS
from apps.imports.services import AisImporter
from apps.users.models import Organization


class Command(BaseCommand):
    help = "Импорт файла выгрузки АИС «Расчет-ЖКУ»: import_ais <account|service|payment|registration> <file> --schema <имя>"

    def add_arguments(self, parser):
        parser.add_argument("entity", choices=list(ENTITY_MAPS))
        parser.add_argument("file", type=Path)
        parser.add_argument("--schema", required=True, help="SCHEMA_NAME начисляющей организации")
        parser.add_argument("--create-org", action="store_true", help="Создать схему, если её нет")

    def handle(self, entity, file: Path, schema: str, create_org: bool, **options):
        if not file.is_file():
            raise CommandError(f"Файл не найден: {file}")
        if create_org:
            organization, _ = Organization.objects.get_or_create(schema_name=schema, defaults={"name": schema})
        else:
            organization = Organization.objects.filter(schema_name=schema).first()
            if organization is None:
                raise CommandError(f"Схема {schema} не найдена (используйте --create-org)")
        job = AisImporter(entity, organization).run_path(file)
        self.stdout.write(
            f"{job.get_status_display()}: строк {job.total}, создано {job.created}, обновлено {job.updated}, "
            f"без изменений {job.unchanged}, отклонено {job.rejected}"
        )
        for error in job.errors[:20]:
            self.stdout.write(f"  строка {error['line']}: {error['reason']}")
