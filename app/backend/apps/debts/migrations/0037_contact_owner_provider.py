from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0036_opi_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="contact",
            name="owner_provider_id",
            field=models.BigIntegerField(blank=True, db_index=True, null=True, verbose_name="Поставщик контакта ПМ"),
        ),
    ]
