import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0018_ais_file_headers"),
        ("imports", "0002_initial"),
        ("users", "0004_org_waits_and_approver"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskCheck",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("raw", models.JSONField(blank=True, default=dict, verbose_name="Исходная строка выгрузки")),
                ("title", models.CharField(max_length=250, verbose_name="Пункт")),
                ("done", models.BooleanField(default=False, verbose_name="Выполнен")),
                (
                    "import_job",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="imports.importjob",
                        verbose_name="Импорт",
                    ),
                ),
                (
                    "organization",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="users.organization",
                        verbose_name="Организация",
                    ),
                ),
                (
                    "task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="checks",
                        to="debts.measuretask",
                        verbose_name="Задание",
                    ),
                ),
            ],
            options={
                "verbose_name": "Пункт чек-листа задания",
                "verbose_name_plural": "Чек-лист задания",
                "ordering": ["id"],
            },
        ),
    ]
