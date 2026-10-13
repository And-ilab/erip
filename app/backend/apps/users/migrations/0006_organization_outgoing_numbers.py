from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_organization_pris_claimant"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="outgoing_numbers",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Пул номеров +375. Прогон берёт следующий по кругу и передаёт его адаптеру.",
                verbose_name="Исходящие номера обзвона",
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="outgoing_cursor",
            field=models.PositiveIntegerField(default=0, verbose_name="Сдвиг ротации исходящих номеров"),
        ),
        migrations.AddField(
            model_name="organization",
            name="call_recording",
            field=models.BooleanField(
                default=False,
                help_text="Выключено, пока Asterisk не отдаёт запись.",
                verbose_name="Запись разговора",
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="call_transfer",
            field=models.BooleanField(
                default=False,
                help_text="Выключено, пока Asterisk не отдаёт перевод.",
                verbose_name="Перевод на оператора",
            ),
        ),
    ]
