from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0022_claim_document_body"),
    ]

    operations = [
        migrations.AddField(
            model_name="claimpackagedocument",
            name="layout",
            field=models.JSONField(blank=True, default=dict, verbose_name="Макет документа"),
        ),
    ]
