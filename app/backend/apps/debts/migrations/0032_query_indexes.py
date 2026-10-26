from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0031_scenario_dates_calls_notes"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["organization", "client_account"], name="account_org_number"),
        ),
        migrations.AddIndex(
            model_name="account",
            index=models.Index(fields=["organization", "funnel_stage"], name="account_org_stage"),
        ),
        migrations.AddIndex(
            model_name="accountservice",
            index=models.Index(fields=["account", "provider_id"], name="service_account_provider"),
        ),
        migrations.AddIndex(
            model_name="servicedebtperiod",
            index=models.Index(fields=["account", "period"], name="debt_period_account_period"),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(fields=["account", "acc_oper_date"], name="payment_account_oper"),
        ),
        migrations.AddIndex(
            model_name="registration",
            index=models.Index(fields=["account", "subj_is_main"], name="registration_account_main"),
        ),
        migrations.AddIndex(
            model_name="balancehistory",
            index=models.Index(fields=["account", "-period"], name="balance_account_period"),
        ),
        migrations.AddIndex(
            model_name="statushistory",
            index=models.Index(fields=["account", "-created_at"], name="status_account_created"),
        ),
        migrations.AddIndex(
            model_name="measureitem",
            index=models.Index(fields=["account", "delivered_on"], name="measure_item_delivered"),
        ),
        migrations.AddIndex(
            model_name="measureitem",
            index=models.Index(fields=["account", "status"], name="measure_item_status"),
        ),
        migrations.AddIndex(
            model_name="claimcase",
            index=models.Index(fields=["account", "debt_from"], name="claim_account_period"),
        ),
        migrations.AddIndex(
            model_name="claimcase",
            index=models.Index(fields=["organization", "notary_office"], name="claim_org_office"),
        ),
    ]
