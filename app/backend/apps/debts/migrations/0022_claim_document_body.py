from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0021_registration_payer_unp"),
    ]

    operations = [
        migrations.AddField(
            model_name="claimpackagedocument",
            name="body",
            field=models.TextField(blank=True, verbose_name="Текст документа"),
        ),
    ]
