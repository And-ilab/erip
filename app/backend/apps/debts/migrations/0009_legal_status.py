from django.db import migrations, models


def mark_bankrupt(apps, schema_editor):
    Account = apps.get_model("debts", "Account")
    Account.objects.filter(bankruptcy=True).update(legal_status="bankruptcy")


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0008_tz_422"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="legal_status",
            field=models.CharField(
                blank=True,
                choices=[("active", "Действующее"), ("liquidation", "В стадии ликвидации"), ("bankruptcy", "Банкротство")],
                default="active",
                max_length=20,
                verbose_name="Статус юридического лица",
            ),
        ),
        migrations.RunPython(mark_bankrupt, migrations.RunPython.noop),
    ]
