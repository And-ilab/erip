from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0007_cfg_425"),
    ]

    operations = [
        migrations.AddField(
            model_name="printform",
            name="outdent_mm",
            field=models.PositiveSmallIntegerField(default=0, verbose_name="Выступ, мм"),
        ),
        migrations.AddField(
            model_name="printform",
            name="block_order",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="logo, requisites, body, signatory",
                verbose_name="Порядок блоков",
            ),
        ),
    ]
