from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0024_claim_pris"),
    ]

    operations = [
        migrations.AddField(
            model_name="claimpackage",
            name="archive",
            field=models.FileField(
                blank=True, upload_to="claims/bnp-archive/%Y/%m/", verbose_name="Архив для БНП",
            ),
        ),
    ]
