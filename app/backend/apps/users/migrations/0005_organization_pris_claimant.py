from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0004_org_waits_and_approver"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="pris_claimant",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="ОПФ, адрес и банковский счёт. Коды справочников 306, 308 и 309 задаёт пользователь.",
                verbose_name="Реквизиты взыскателя для АИС ПРИС",
            ),
        ),
    ]
