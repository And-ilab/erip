from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.imports.field_maps import norm_header
from apps.imports.parsing import ConversionError, open_table
from apps.imports.sample_catalog import sample_files
from apps.imports.services import AisImporter
from apps.users.models import Organization

_TITLE = norm_header("Наименование схемы")


class Command(BaseCommand):
    help = "Загружает обезличенную тестовую выборку АИС (CSV или Excel) в схемы BR2000, GR5000, MG6000, MN7000"

    def add_arguments(self, parser):
        parser.add_argument("--dir", type=Path, default=None, help="Каталог файлов, по умолчанию AIS_SAMPLE_DIR")

    def handle(self, **options):
        directory = Path(options["dir"] or settings.AIS_SAMPLE_DIR)
        files = sample_files(directory)
        if not files:
            raise CommandError(f"В каталоге нет файлов выборки: {directory}")
        titles = {schema: self._title(path) for schema, entity, path in files if entity == "account"}
        for schema, entity, path in files:
            organization, _created = Organization.objects.get_or_create(
                schema_name=schema, defaults={"name": titles.get(schema) or schema},
            )
            title = titles.get(schema)
            if title and organization.name != title:
                organization.name = title
                organization.save(update_fields=["name", "updated_at"])
            job = AisImporter(entity, organization).run_path(path)
            self.stdout.write(
                f"{schema} {entity}: {job.get_status_display()}, строк {job.total}, создано {job.created}, "
                f"обновлено {job.updated}, без изменений {job.unchanged}, отклонено {job.rejected}"
            )
            for error in job.errors[:10]:
                self.stdout.write(f"  строка {error['line']}: {error['reason']}")

    @staticmethod
    def _title(path: Path) -> str:
        try:
            _encoding, headers, rows = open_table(path.read_bytes())
        except ConversionError:
            return ""
        try:
            index = next(i for i, header in enumerate(headers) if norm_header(header) == _TITLE)
        except StopIteration:
            return ""
        for row in rows:
            if index < len(row) and row[index].strip():
                return row[index].strip()
        return ""
