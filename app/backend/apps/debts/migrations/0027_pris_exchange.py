import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0026_measureitem_call_outcome"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="claimcase",
            name="pris_inquiry",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Ответ 3.11.04 или 3.11.05. В заглушке не заполняется, чтобы не записать номер из примера.",
                verbose_name="Ход производства ПРИС",
            ),
        ),
        migrations.CreateModel(
            name="PrisExchange",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("operation", models.CharField(max_length=20, verbose_name="Операция")),
                ("mode", models.CharField(blank=True, max_length=20, verbose_name="Канал")),
                ("path", models.CharField(max_length=120, verbose_name="Путь шлюза")),
                ("process_status", models.CharField(blank=True, max_length=10, verbose_name="Код обработки")),
                ("request", models.JSONField(blank=True, default=dict, verbose_name="Запрос")),
                ("response", models.JSONField(blank=True, default=dict, verbose_name="Ответ")),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Кто",
                    ),
                ),
                (
                    "case",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pris_exchanges",
                        to="debts.claimcase",
                        verbose_name="Дело",
                    ),
                ),
            ],
            options={
                "verbose_name": "Обмен с ПРИС",
                "verbose_name_plural": "Обмен с ПРИС",
                "ordering": ["-id"],
                "indexes": [models.Index(fields=["case", "id"], name="debts_pris_case_id_idx")],
            },
        ),
    ]
