from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0004_dial_hours"),
    ]

    operations = [
        migrations.AddField(
            model_name="calculationsettings",
            name="warning_wait_days",
            field=models.PositiveSmallIntegerField(default=5, verbose_name="Дней на оплату после вручения предупреждения"),
        ),
        migrations.AddField(
            model_name="calculationsettings",
            name="disconnect_requires_approval",
            field=models.BooleanField(default=False, verbose_name="Отключение только после согласования"),
        ),
    ]
