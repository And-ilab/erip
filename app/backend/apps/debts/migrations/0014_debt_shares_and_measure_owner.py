import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0013_claims_and_scenarios"),
    ]

    operations = [
        migrations.AddField(
            model_name="measure",
            name="owner_provider_id",
            field=models.BigIntegerField(
                blank=True,
                db_index=True,
                help_text="Пусто у мероприятия начисляющей организации. У двух поставщиков один и тот же вид живёт отдельно.",
                null=True,
                verbose_name="Поставщик-автор",
            ),
        ),
        migrations.AddField(
            model_name="measure",
            name="owner_name",
            field=models.CharField(blank=True, max_length=250, verbose_name="Поставщик-автор"),
        ),
        migrations.CreateModel(
            name="DebtShare",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("provider_id", models.BigIntegerField(default=0, verbose_name="Код поставщика")),
                ("provider_name", models.CharField(blank=True, max_length=250, verbose_name="Поставщик")),
                ("principal", models.DecimalField(blank=True, decimal_places=2, max_digits=20, null=True, verbose_name="Основной долг")),
                ("penalty", models.DecimalField(blank=True, decimal_places=2, max_digits=20, null=True, verbose_name="Пеня")),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="debt_shares",
                        to="debts.account",
                        verbose_name="ЛС",
                    ),
                ),
            ],
            options={
                "verbose_name": "Доля долга",
                "verbose_name_plural": "Доли долга",
                "ordering": ["provider_name", "provider_id"],
            },
        ),
        migrations.AddConstraint(
            model_name="debtshare",
            constraint=models.UniqueConstraint(fields=("account", "provider_id"), name="uniq_account_debt_share"),
        ),
    ]
