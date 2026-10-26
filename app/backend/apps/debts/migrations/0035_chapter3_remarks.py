from django.db import migrations, models


def backfill_registration_flags(apps, schema_editor):
    Registration = apps.get_model("debts", "Registration")
    batch = []
    for row in Registration.objects.iterator(chunk_size=500):
        status, left, removed = _flags(row.raw)
        changed = False
        if row.reg_status is None and status is not None:
            row.reg_status = status
            changed = True
        if left and not row.left_country:
            row.left_country = True
            changed = True
        if removed and not row.sheet_removed:
            row.sheet_removed = True
            changed = True
        if not changed:
            continue
        batch.append(row)
        if len(batch) >= 500:
            Registration.objects.bulk_update(batch, ["reg_status", "left_country", "sheet_removed"])
            batch = []
    if batch:
        Registration.objects.bulk_update(batch, ["reg_status", "left_country", "sheet_removed"])


def _flags(raw):
    status = None
    left = False
    removed = False
    for key, value in (raw or {}).items():
        folded = str(key or "").strip().casefold().replace("ё", "е")
        text = str(value or "").strip().casefold().replace("ё", "е")
        if "статус регистрации" in folded:
            status = _status(text)
        if "выехав" in folded:
            left = text in {"1", "да", "true", "yes"}
        if "снят" in folded and "снятия" not in folded and "убыт" not in folded:
            if text.startswith("1") or text in {"да", "true", "yes"}:
                removed = True
    return status, left, removed


def _status(text):
    if text in {"0", "нет", "false", "no"}:
        return 0
    if text in {"1", "да", "true", "yes"}:
        return 1
    try:
        return int(float(text.replace(",", ".")))
    except ValueError:
        return None


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0034_funnel_activities"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="payer_deceased",
            field=models.BooleanField(default=False, verbose_name="Плательщик умер"),
        ),
        migrations.AddField(
            model_name="account",
            name="deceased_payer_id",
            field=models.BigIntegerField(blank=True, null=True, verbose_name="Умерший плательщик"),
        ),
        migrations.AddField(
            model_name="registration",
            name="reg_status",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="Статус регистрации"),
        ),
        migrations.AddField(
            model_name="registration",
            name="left_country",
            field=models.BooleanField(default=False, verbose_name="Незанятые, выехавшие за пределы РБ"),
        ),
        migrations.AddField(
            model_name="registration",
            name="sheet_removed",
            field=models.BooleanField(default=False, verbose_name="Снят по колонке файла"),
        ),
        migrations.AddField(
            model_name="accountservice",
            name="agreement_number",
            field=models.CharField(blank=True, default="", max_length=100, verbose_name="Номер договора"),
        ),
        migrations.AddField(
            model_name="accountservice",
            name="payment_due_day",
            field=models.PositiveSmallIntegerField(
                blank=True, null=True, verbose_name="День срока погашения по договору",
            ),
        ),
        migrations.AddField(
            model_name="measure",
            name="extra",
            field=models.BooleanField(default=False, verbose_name="Дополнительное"),
        ),
        migrations.AddField(
            model_name="measure",
            name="pause_until",
            field=models.DateField(blank=True, null=True, verbose_name="Приостановлено до"),
        ),
        migrations.AddField(
            model_name="measure",
            name="pause_reason",
            field=models.CharField(blank=True, default="", max_length=500, verbose_name="Основание приостановки"),
        ),
        migrations.AlterField(
            model_name="measure",
            name="kind",
            field=models.CharField(
                choices=[
                    ("call", "Автообзвон"),
                    ("notice", "Уведомление"),
                    ("warning", "Предупреждение"),
                    ("disconnect", "Отключение"),
                    ("collection", "Взыскание"),
                    ("scenario", "Смена сценария"),
                    ("extra", "Дополнительное"),
                ],
                max_length=20,
                verbose_name="Вид",
            ),
        ),
        migrations.AlterField(
            model_name="statushistory",
            name="kind",
            field=models.CharField(
                choices=[
                    ("group", "Группа"),
                    ("rating", "Рейтинг"),
                    ("funnel", "Этап воронки"),
                    ("scenario", "Сценарий"),
                    ("contact", "Контакт"),
                    ("category", "Категория"),
                    ("inheritance", "Наследственное дело"),
                    ("registration", "Регистрация"),
                    ("residence", "Проживание"),
                    ("legal", "Статус лица"),
                    ("measure", "Мероприятие"),
                ],
                max_length=20,
                verbose_name="Вид",
            ),
        ),
        migrations.RunPython(backfill_registration_flags, migrations.RunPython.noop),
    ]
