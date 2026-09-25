from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0003_initial"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["organization", "provider_id", "debt_group"], name="account_scope_group"),
        ),
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["organization", "balance_out"], name="account_org_balance"),
        ),
        migrations.AddIndex(
            model_name="registration",
            index=models.Index(fields=["personal_num"], name="registration_personal_num"),
        ),
    ]
