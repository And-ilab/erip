from django.db import migrations, models


CASE = {
    "notary-application": "writ",
    "notary-proxy": "proxy",
    "claim-debt": "lawsuit",
    "claim-eviction": "eviction",
    "claim-alienation": "alienation",
}


def seed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    for code, blank in CASE.items():
        PrintForm.objects.filter(organization=None, code=code).update(blank=blank)


def unseed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    PrintForm.objects.filter(organization=None, code__in=list(CASE)).update(blank="")


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0011_official_blanks"),
    ]

    operations = [
        migrations.AlterField(
            model_name="printform",
            name="blank",
            field=models.CharField(
                blank=True,
                default="",
                help_text="warning, reminder, notice-137, notice-80, notice-86, notice-tko, calculation, writ, proxy, lawsuit, eviction, alienation",
                max_length=40,
                verbose_name="Бланк образца",
            ),
        ),
        migrations.RunPython(seed, unseed),
    ]
