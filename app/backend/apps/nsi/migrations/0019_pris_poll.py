import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0018_opi_offices"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrisPoll",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                (
                    "interval_minutes",
                    models.PositiveSmallIntegerField(
                        blank=True, null=True, verbose_name="Период автоопроса, минуты",
                    ),
                ),
                ("last_tick_at", models.DateTimeField(blank=True, null=True, verbose_name="Последний опрос")),
                ("last_summary", models.CharField(blank=True, max_length=500, verbose_name="Итог последнего опроса")),
            ],
            options={
                "verbose_name": "Автоопрос АИС ПРИС",
                "verbose_name_plural": "Автоопрос АИС ПРИС",
            },
        ),
    ]
