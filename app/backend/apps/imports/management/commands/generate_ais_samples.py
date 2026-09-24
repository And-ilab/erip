from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.imports.samples import SampleGenerator


class Command(BaseCommand):
    help = "Генерирует тестовые CSV выгрузок АИС по спецификациям из AIS_SPEC_DIR («Примеры данных»)"

    def add_arguments(self, parser):
        parser.add_argument("out_dir", type=Path)
        parser.add_argument("--schema", default="demo_schema")
        parser.add_argument("--accounts", type=int, default=12)
        parser.add_argument("--spec-dir", type=Path, default=None)

    def handle(self, out_dir: Path, schema: str, accounts: int, spec_dir: Path | None, **options):
        spec_dir = spec_dir or Path(settings.AIS_SPEC_DIR)
        if not spec_dir.is_dir():
            raise CommandError(f"Каталог спецификаций не найден: {spec_dir}")
        files = SampleGenerator(spec_dir, schema, accounts).write_all(out_dir)
        for entity, path in files.items():
            self.stdout.write(f"{entity}: {path}")
