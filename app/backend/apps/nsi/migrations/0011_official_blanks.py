from django.db import migrations, models


NEW_FORMS = [
    {
        "code": "reminder",
        "name": "Напоминание о задолженности",
        "doc_kind": "reminder",
        "blank": "reminder",
        "addressee": "debtor",
    },
    {
        "code": "notice-137",
        "name": "Уведомление о задолженности (ст. 137 ЖК)",
        "doc_kind": "notice",
        "blank": "notice-137",
        "addressee": "debtor",
    },
    {
        "code": "notice-80",
        "name": "Уведомление о задолженности (ст. 80, 87 ЖК)",
        "doc_kind": "notice",
        "blank": "notice-80",
        "addressee": "debtor",
    },
    {
        "code": "notice-86",
        "name": "Уведомление о задолженности (ст. 86 ЖК)",
        "doc_kind": "notice",
        "blank": "notice-86",
        "addressee": "debtor",
    },
    {
        "code": "notice-tko",
        "name": "Уведомление о задолженности за обращение с ТКО",
        "doc_kind": "notice",
        "blank": "notice-tko",
        "addressee": "debtor",
    },
]

NOTE = (
    "Бланк образца АИС «Расчет-ЖКУ». Статичный текст бланка печатается как в образце. "
    "Подставляются поля лицевого счёта. Суммы из АИС не пересчитываются."
)


def seed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    Revision = apps.get_model("nsi", "PrintFormRevision")
    PrintForm.objects.filter(organization=None, code="notary-warning").update(blank="warning")
    PrintForm.objects.filter(organization=None, code="notary-calculation").update(blank="calculation")
    for row in NEW_FORMS:
        form, created = PrintForm.objects.get_or_create(
            organization=None,
            code=row["code"],
            addressee=row["addressee"],
            defaults={
                "name": row["name"],
                "doc_kind": row["doc_kind"],
                "blank": row["blank"],
                "body": NOTE,
                "font_size": 12,
                "block_order": ["body", "signatory"],
                "signatory": "{organization}",
                "blocks": [],
                "version": 1,
                "is_active": True,
            },
        )
        if created:
            Revision.objects.create(form=form, version=1, body=form.body, layout={"blank": row["blank"]})
        elif not form.blank:
            form.blank = row["blank"]
            form.save(update_fields=["blank"])


def unseed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    PrintForm.objects.filter(organization=None, code__in=[row["code"] for row in NEW_FORMS]).delete()
    PrintForm.objects.filter(organization=None, code__in=["notary-warning", "notary-calculation"]).update(blank="")


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0010_print_form_blocks"),
    ]

    operations = [
        migrations.AddField(
            model_name="printform",
            name="blank",
            field=models.CharField(
                blank=True,
                default="",
                help_text="warning, reminder, notice-137, notice-80, notice-86, notice-tko, calculation",
                max_length=40,
                verbose_name="Бланк образца",
            ),
        ),
        migrations.RunPython(seed, unseed),
    ]
