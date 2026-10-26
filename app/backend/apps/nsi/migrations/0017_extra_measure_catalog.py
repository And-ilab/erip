import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0008_organization_mail"),
        ("nsi", "0016_official_debtor_categories"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExtraMeasureCatalog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("is_active", models.BooleanField(default=True, verbose_name="Активна")),
                ("deactivated_at", models.DateTimeField(blank=True, null=True, verbose_name="Деактивирована")),
                ("name", models.CharField(max_length=250, verbose_name="Наименование")),
                ("note", models.CharField(blank=True, max_length=500, verbose_name="Пояснение")),
                (
                    "organization",
                    models.ForeignKey(
                        blank=True, null=True, on_delete=models.deletion.CASCADE,
                        related_name="extra_measures", to="users.organization", verbose_name="Схема",
                    ),
                ),
            ],
            options={
                "verbose_name": "Дополнительное мероприятие",
                "verbose_name_plural": "Дополнительные мероприятия",
                "ordering": ["name"],
            },
        ),
    ]
