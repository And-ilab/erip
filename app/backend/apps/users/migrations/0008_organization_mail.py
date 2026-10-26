from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0007_scenario_dates_calls_notes"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="mail_from",
            field=models.CharField(
                blank=True,
                help_text="Адрес From для писем этой схемы. Пусто — боевой SMTP письмо не примет.",
                max_length=254,
                verbose_name="E-mail отправителя",
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="mail_from_name",
            field=models.CharField(blank=True, max_length=250, verbose_name="Имя отправителя"),
        ),
        migrations.AddField(
            model_name="organization",
            name="mail_subject",
            field=models.CharField(
                blank=True,
                help_text="Берётся, если у шаблона тема пустая.",
                max_length=250,
                verbose_name="Тема письма",
            ),
        ),
        migrations.AddField(
            model_name="organization",
            name="mail_signature",
            field=models.CharField(
                blank=True,
                help_text="Пусто — шлюз ставит «С уважением, ЖКУ». Прочтение письма не отмечается.",
                max_length=500,
                verbose_name="Подпись письма",
            ),
        ),
    ]
