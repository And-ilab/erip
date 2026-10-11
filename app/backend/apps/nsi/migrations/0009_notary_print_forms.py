from django.db import migrations

FORMS = [
    {
        "code": "notary-application",
        "name": "Заявление о совершении исполнительной надписи",
        "doc_kind": "writ",
        "body": (
            "Заявление о совершении исполнительной надписи\n\n"
            "Заявитель: {organization}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n"
            "Должник: {fio}\n"
            "Идентификационный номер: {personal_id}\n"
            "УНП: {unp}\n\n"
            "Прошу совершить исполнительную надпись о взыскании задолженности за жилищно-коммунальные услуги.\n\n"
            "Исходящее сальдо по данным АИС «Расчет-ЖКУ»: {amount}\n"
            "Пеня по данным АИС «Расчет-ЖКУ»: {penalty}\n"
            "Нотариальный тариф: {tariff}\n"
            "Дата вручения предупреждения: {warning_date}\n"
            "Услуги: {services}\n\n"
            "Суммы долга и пени подставлены из АИС «Расчет-ЖКУ». ПМ их не рассчитывает и не исправляет."
        ),
    },
    {
        "code": "notary-calculation",
        "name": "Расчёт задолженности",
        "doc_kind": "calculation",
        "body": (
            "Расчёт задолженности по лицевому счёту {account}\n\n"
            "Должник: {fio}\n"
            "Адрес: {address}\n"
            "Группа задолженности: {debt_group}\n"
            "Рейтинг: {rating}\n"
            "Месяцев долга: {months_debt}\n"
            "Наиболее ранний период: {debt_started}\n"
            "Услуги: {services}\n\n"
            "Исходящее сальдо с пенями: {amount}\n"
            "Исходящие пени: {penalty}\n\n"
            "Цифры взяты из АИС «Расчет-ЖКУ». ПМ расчёт не выполняет."
        ),
    },
    {
        "code": "notary-proxy",
        "name": "Доверенность на обращение за исполнительной надписью",
        "doc_kind": "proxy",
        "body": (
            "Доверенность\n\n"
            "Организация: {organization}\n"
            "Должник: {fio}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n\n"
            "Полномочия представителя, дата и номер доверенности вносятся организацией.\n"
            "Электронный документ подписывает руководитель. ПМ содержание доверенности не проверяет."
        ),
    },
    {
        "code": "notary-warning",
        "name": "Предупреждение о задолженности",
        "doc_kind": "warning",
        "body": (
            "Предупреждение о задолженности\n\n"
            "{organization}\n"
            "Должник: {fio}\n"
            "Лицевой счёт: {account}\n"
            "Адрес: {address}\n"
            "Услуги: {services}\n\n"
            "Задолженность: {amount}\n"
            "Пеня: {penalty}\n"
            "Просим погасить в течение {due_days} дней.\n"
            "Дата, которая учитывается в чек-листе, — дата вручения предупреждения."
        ),
    },
]


def seed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    Revision = apps.get_model("nsi", "PrintFormRevision")
    for row in FORMS:
        form, created = PrintForm.objects.get_or_create(
            organization=None,
            code=row["code"],
            addressee="notary",
            defaults={
                "name": row["name"],
                "doc_kind": row["doc_kind"],
                "body": row["body"],
                "font_size": 12,
                "indent_mm": 0,
                "outdent_mm": 0,
                "block_order": ["body", "signatory"],
                "signatory": "{organization}",
                "version": 1,
                "is_active": True,
            },
        )
        if created:
            Revision.objects.create(form=form, version=1, body=form.body, layout={})


def unseed(apps, schema_editor):
    PrintForm = apps.get_model("nsi", "PrintForm")
    PrintForm.objects.filter(
        organization=None,
        addressee="notary",
        code__in=[row["code"] for row in FORMS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0008_print_blocks"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
