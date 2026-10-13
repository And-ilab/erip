import datetime

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0012_case_blanks"),
    ]

    operations = [
        migrations.AddField(
            model_name="scenariodefinition",
            name="call_from_day",
            field=models.PositiveSmallIntegerField(
                default=27,
                help_text="Не раньше 27-го: 26-е — день начисления пени.",
                verbose_name="Обзвон с этого числа месяца",
            ),
        ),
        migrations.AddField(
            model_name="scenariodefinition",
            name="weekday_from",
            field=models.TimeField(default=datetime.time(18, 0), verbose_name="Будни, обзвон с"),
        ),
        migrations.AddField(
            model_name="scenariodefinition",
            name="weekday_to",
            field=models.TimeField(default=datetime.time(21, 0), verbose_name="Будни, обзвон по"),
        ),
        migrations.AddField(
            model_name="scenariodefinition",
            name="weekend_from",
            field=models.TimeField(default=datetime.time(10, 0), verbose_name="Выходные, обзвон с"),
        ),
        migrations.AddField(
            model_name="scenariodefinition",
            name="weekend_to",
            field=models.TimeField(default=datetime.time(22, 0), verbose_name="Выходные, обзвон по"),
        ),
    ]
