from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0028_account_card_writ"),
    ]

    operations = [
        migrations.AddField(
            model_name="measureitem",
            name="recording_ref",
            field=models.CharField(
                blank=True,
                help_text="Ссылка или путь, который прислала станция. Файл в ПМ не хранится.",
                max_length=500,
                verbose_name="Запись разговора",
            ),
        ),
    ]
