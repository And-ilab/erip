from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0015_cfg_425"),
    ]

    operations = [
        migrations.AlterField(
            model_name="savedfilter",
            name="target",
            field=models.CharField(
                choices=[
                    ("accounts", "Реестр ЛС"),
                    ("contracts", "Реестр договоров"),
                    ("measures", "Реестр мероприятий"),
                    ("claims", "Претензионно-исковая работа"),
                ],
                max_length=20,
                verbose_name="Реестр",
            ),
        ),
    ]
