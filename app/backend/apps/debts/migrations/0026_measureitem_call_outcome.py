from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0025_claim_package_archive"),
    ]

    operations = [
        migrations.AddField(
            model_name="measureitem",
            name="provider_message_id",
            field=models.CharField(blank=True, max_length=64, verbose_name="Идентификатор отправления"),
        ),
        migrations.AddField(
            model_name="measureitem",
            name="caller_id",
            field=models.CharField(blank=True, max_length=30, verbose_name="Исходящий номер"),
        ),
        migrations.AddField(
            model_name="measureitem",
            name="external_call",
            field=models.BooleanField(
                blank=True,
                help_text="Пусто — результат внёс человек. Ложь — адаптер не выходил во внешнюю систему.",
                null=True,
                verbose_name="Внешний вызов выполнен",
            ),
        ),
    ]
