from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0003_tz_421_gaps"),
    ]

    operations = [
        migrations.AddField(
            model_name="calculationsettings",
            name="dial_mobile_from_hour",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="С этого часа только мобильный"),
        ),
        migrations.AddField(
            model_name="calculationsettings",
            name="dial_mobile_to_hour",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="До этого часа только мобильный"),
        ),
    ]
