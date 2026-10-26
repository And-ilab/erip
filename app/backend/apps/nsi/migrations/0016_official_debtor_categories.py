import django.utils.timezone
from django.db import migrations, models


BASE = "Основные категории ЛС (базовые в АИС «Расчет-ЖКУ»):"
USED = "Наиболее часто используемые категории ЛС пользователями АИС «Расчет-ЖКУ»"

# Строки «Основные документы/Категории должников.docx» без правок и без добавлений.
# Код — технический ключ: в документе кодов нет.
OFFICIAL_DEBTOR_CATEGORIES = (
    ("ais-01", "Пенсионеры одинокопроживающие", BASE),
    ("ais-02", "Малообеспеченные семьи", BASE),
    ("ais-03", "Неполные семьи", BASE),
    ("ais-04", "Опекунские семьи", BASE),
    ("ais-05", "Неблагополучные семьи", BASE),
    ("ais-06", "Безработные", BASE),
    ("ais-07", "Многодетные семьи", BASE),
    ("ais-08", "Граждане, проживающие за рубежом", USED),
    ("ais-09", "Невозможно найти собственника", USED),
    ("ais-10", "Дети-сироты", USED),
    ("ais-11", "В местах лишения свободы", USED),
    ("ais-12", "Собственник умер", USED),
    ("ais-13", "Наниматель умер", USED),
    ("ais-14", "Инвалиды", USED),
    ("ais-15", "Прочие", USED),
    ("ais-16", "Лишенные родительских прав", USED),
    (
        "ais-17",
        "Не занятые в экономике (и вариации: Незанятые в экономике, Трудоспособные граждане, не занятые в экономике)",
        USED,
    ),
    ("ais-18", "Выселены / Выселен (и вариации с долгом)", USED),
    ("ais-19", "СОП / Находятся в СОП / Семья в СОП", USED),
    ("ais-20", "Закрепленное жилье за несовершеннолетними (и вариации)", USED),
    ("ais-21", "Выморочное / Наследство выморочено", USED),
    ("ais-22", "Асоциальные / Ведущие асоциальный образ жизни", USED),
    ("ais-23", "Одиноко проживающие пенсионеры", USED),
    ("ais-24", "Приемные семьи", USED),
    ("ais-25", "Должники / Разделенный ЛС с задолженностью", USED),
)

RETIRED = (
    ("pensioner", "Пенсионер", "Мягкий график уведомлений"),
    ("idler", "Не занят в экономике", "Отягчающий признак рейтинга D"),
    ("large_family", "Многодетная семья", "Ограничение отключения"),
    ("bankrupt", "Банкротство", "Отягчающий признак рейтинга D"),
)


def load_official(apps, schema_editor):
    DebtorCategory = apps.get_model("nsi", "DebtorCategory")
    now = django.utils.timezone.now()
    DebtorCategory.objects.filter(
        organization__isnull=True, code__in=[code for code, _name, _note in RETIRED],
    ).update(is_active=False, deactivated_at=now)
    for order, (code, name, section) in enumerate(OFFICIAL_DEBTOR_CATEGORIES, start=1):
        DebtorCategory.objects.update_or_create(
            code=code,
            organization=None,
            defaults={
                "name": name,
                "note": "",
                "section": section,
                "sort_order": order,
                "is_active": True,
                "deactivated_at": None,
            },
        )


def restore_previous(apps, schema_editor):
    DebtorCategory = apps.get_model("nsi", "DebtorCategory")
    now = django.utils.timezone.now()
    DebtorCategory.objects.filter(
        organization__isnull=True, code__in=[code for code, _name, _section in OFFICIAL_DEBTOR_CATEGORIES],
    ).update(is_active=False, deactivated_at=now)
    for code, name, note in RETIRED:
        DebtorCategory.objects.filter(organization__isnull=True, code=code).update(
            name=name, note=note, is_active=True, deactivated_at=None, section="", sort_order=1000,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("nsi", "0015_scenario_dates_calls_notes"),
    ]

    operations = [
        migrations.AddField(
            model_name="debtorcategory",
            name="section",
            field=models.CharField(blank=True, max_length=250, verbose_name="Раздел списка"),
        ),
        migrations.AddField(
            model_name="debtorcategory",
            name="sort_order",
            field=models.PositiveIntegerField(default=1000, verbose_name="Порядок в списке"),
        ),
        migrations.RunPython(load_official, restore_previous),
    ]
