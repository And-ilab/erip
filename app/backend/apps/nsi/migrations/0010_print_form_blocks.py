from django.db import migrations, models


COURT = [
    {
        "code": "claim-debt",
        "name": "Исковое заявление о взыскании задолженности",
        "doc_kind": "lawsuit",
        "body": (
            "Исковое заявление о взыскании задолженности\n\n"
            "Истец: {organization}\n"
            "Ответчик: {fio}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n"
            "Идентификационный номер: {personal_id}\n"
            "УНП: {unp}\n\n"
            "Прошу взыскать задолженность за жилищно-коммунальные услуги.\n\n"
            "Исходящее сальдо по данным АИС «Расчет-ЖКУ»: {amount}\n"
            "Пеня по данным АИС «Расчет-ЖКУ»: {penalty}\n"
            "Дата вручения предупреждения: {warning_date}\n"
            "Услуги: {services}\n\n"
            "Суммы подставлены из АИС. ПМ их не рассчитывает."
        ),
    },
    {
        "code": "claim-eviction",
        "name": "Исковое заявление о выселении",
        "doc_kind": "eviction",
        "body": (
            "Исковое заявление о выселении\n\n"
            "Истец: {organization}\n"
            "Ответчик: {fio}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n\n"
            "Вид иска и дата подачи пакета документов заполняются в деле.\n"
            "Задолженность по данным АИС: {amount}. Пеня: {penalty}."
        ),
    },
    {
        "code": "claim-alienation",
        "name": "Исковое заявление о понуждении к отчуждению",
        "doc_kind": "alienation",
        "body": (
            "Исковое заявление о понуждении к отчуждению жилого помещения\n\n"
            "Истец: {organization}\n"
            "Ответчик: {fio}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n\n"
            "Задолженность по данным АИС: {amount}. Пеня: {penalty}."
        ),
    },
]


def seed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    Revision = apps.get_model("nsi", "PrintFormRevision")
    for row in COURT:
        form, created = PrintForm.objects.get_or_create(
            organization=None,
            code=row["code"],
            addressee="debtor",
            defaults={
                "name": row["name"],
                "doc_kind": row["doc_kind"],
                "body": row["body"],
                "font_size": 12,
                "block_order": ["body", "signatory"],
                "signatory": "{organization}",
                "blocks": [],
                "version": 1,
                "is_active": True,
            },
        )
        if created:
            Revision.objects.create(form=form, version=1, body=form.body, layout={})


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0009_notary_print_forms"),
    ]

    operations = [
        migrations.AddField(
            model_name="printform",
            name="blocks",
            field=models.JSONField(blank=True, default=list, verbose_name="Блоки макета"),
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
