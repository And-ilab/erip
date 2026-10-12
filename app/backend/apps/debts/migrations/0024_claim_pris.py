from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0023_claim_document_layout"),
    ]

    operations = [
        migrations.AddField(
            model_name="claimcase",
            name="pris_cl_num",
            field=models.CharField(blank=True, max_length=80, verbose_name="Идентификатор задолженности в ПРИС"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="pris_process_message",
            field=models.CharField(blank=True, max_length=500, verbose_name="Ответ ПРИС"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="pris_process_status",
            field=models.CharField(blank=True, max_length=10, verbose_name="Код обработки ПРИС"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="pris_request",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Коды справочников 120, 201, 214, 217, 309 и выбранные файлы. Пустые коды не подставляются.",
                verbose_name="Реквизиты пакета ПРИС",
            ),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="pris_response_id",
            field=models.CharField(blank=True, max_length=64, verbose_name="Идентификатор запроса ПРИС"),
        ),
    ]
