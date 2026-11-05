import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0037_contact_owner_provider"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrisRepayment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=20, verbose_name="Сумма")),
                (
                    "case",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pris_repayments",
                        to="debts.claimcase",
                        verbose_name="Дело",
                    ),
                ),
                (
                    "payment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pris_repayments",
                        to="debts.payment",
                        verbose_name="Оплата",
                    ),
                ),
            ],
            options={
                "verbose_name": "Погашение, принятое ПРИС",
                "verbose_name_plural": "Погашения, принятые ПРИС",
            },
        ),
        migrations.CreateModel(
            name="PrisRepayQueue",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                (
                    "case",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pris_repay_queue",
                        to="debts.claimcase",
                        verbose_name="Дело",
                    ),
                ),
                (
                    "payment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pris_repay_queue",
                        to="debts.payment",
                        verbose_name="Оплата",
                    ),
                ),
            ],
            options={
                "verbose_name": "Очередь погашения ПРИС",
                "verbose_name_plural": "Очередь погашения ПРИС",
            },
        ),
        migrations.AddConstraint(
            model_name="prisrepayment",
            constraint=models.UniqueConstraint(fields=("case", "payment"), name="uniq_pris_repayment"),
        ),
        migrations.AddConstraint(
            model_name="prisrepayqueue",
            constraint=models.UniqueConstraint(fields=("case", "payment"), name="uniq_pris_repay_queue"),
        ),
    ]
