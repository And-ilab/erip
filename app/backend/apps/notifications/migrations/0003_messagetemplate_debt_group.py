from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="messagetemplate",
            name="debt_group",
            field=models.PositiveSmallIntegerField(
                blank=True,
                db_index=True,
                help_text="Если задана, каркас подставляется для ЛС с этой группой (ручная важнее расчётной).",
                null=True,
                verbose_name="Группа задолженности",
            ),
        ),
        migrations.AddConstraint(
            model_name="messagetemplate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("debt_group__isnull", False), ("organization__isnull", True)),
                fields=("channel", "debt_group"),
                name="uniq_central_template_for_debt_group",
            ),
        ),
        migrations.AlterModelOptions(
            name="messagetemplate",
            options={
                "ordering": ["debt_group", "name"],
                "verbose_name": "Шаблон сообщения",
                "verbose_name_plural": "Шаблоны сообщений",
            },
        ),
    ]
