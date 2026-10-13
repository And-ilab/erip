from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_cfg_425"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="step_waits",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Ключ — действие шага сценария. Пустой ключ берёт срок из самого шага.",
                verbose_name="Ожидание перед шагом, дней",
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="warning_wait_days",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Пусто — общее значение из параметров расчёта.",
                null=True,
                verbose_name="Дней на оплату после предупреждения",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="can_approve",
            field=models.BooleanField(
                default=False,
                help_text="Специалист с этим признаком может пропустить мероприятие или этап воронки.",
                verbose_name="Согласует",
            ),
        ),
    ]
