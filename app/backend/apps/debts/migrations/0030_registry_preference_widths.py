from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0029_measureitem_recording_ref"),
    ]

    operations = [
        migrations.AddField(
            model_name="registrypreference",
            name="widths",
            field=models.JSONField(blank=True, default=dict, verbose_name="Ширина столбцов"),
        ),
        migrations.AlterField(
            model_name="registrypreference",
            name="target",
            field=models.CharField(max_length=40, verbose_name="Реестр"),
        ),
    ]
