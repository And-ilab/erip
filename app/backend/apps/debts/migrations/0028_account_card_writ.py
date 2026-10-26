import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0027_pris_exchange"),
    ]

    operations = [
        migrations.AlterField(
            model_name="claimcase",
            name="account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="claim_case",
                to="debts.account",
                verbose_name="ЛС",
            ),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="debt_from",
            field=models.DateField(blank=True, null=True, verbose_name="Период задолженности с"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="debt_to",
            field=models.DateField(blank=True, null=True, verbose_name="Период задолженности по"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="non_delivery_act_on",
            field=models.DateField(blank=True, null=True, verbose_name="Дата акта о невручении предупреждения"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="repayment_days",
            field=models.PositiveSmallIntegerField(default=7, verbose_name="Дней на погашение"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="writ_principal",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=20, null=True, verbose_name="Долг по услугам за период",
            ),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="writ_penalty",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=20, null=True, verbose_name="Долг по пене за период",
            ),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="notary_office",
            field=models.CharField(blank=True, max_length=250, verbose_name="Нотариальная контора"),
        ),
    ]
