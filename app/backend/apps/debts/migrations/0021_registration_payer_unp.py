from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0020_claim_bnp_package"),
    ]

    operations = [
        migrations.AddField(
            model_name="registration",
            name="payer_unp",
            field=models.CharField(blank=True, max_length=20, verbose_name="Учетный номер плательщика"),
        ),
    ]
