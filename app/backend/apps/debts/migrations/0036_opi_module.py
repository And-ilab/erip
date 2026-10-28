from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0035_chapter3_remarks"),
    ]

    operations = [
        migrations.AlterField(
            model_name="claimcase",
            name="opi_status",
            field=models.CharField(blank=True, max_length=120, verbose_name="Статус ОПИ"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_department",
            field=models.CharField(blank=True, max_length=250, verbose_name="Орган ОПИ"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_sent_on",
            field=models.DateField(blank=True, null=True, verbose_name="Дата направления в ОПИ"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_started_on",
            field=models.DateField(blank=True, null=True, verbose_name="Дата возбуждения ИП"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_ended_on",
            field=models.DateField(blank=True, null=True, verbose_name="Дата окончания ИП"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_bailiff",
            field=models.CharField(blank=True, max_length=250, verbose_name="Судебный исполнитель"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_note",
            field=models.CharField(blank=True, max_length=500, verbose_name="Примечание по ОПИ"),
        ),
        migrations.AddField(
            model_name="claimcase",
            name="opi_measures_taken",
            field=models.JSONField(blank=True, default=list, verbose_name="Принятые меры ОПИ"),
        ),
        migrations.AddField(
            model_name="claimact",
            name="act_number",
            field=models.CharField(blank=True, max_length=80, verbose_name="Номер акта"),
        ),
        migrations.AddField(
            model_name="claimact",
            name="act_date",
            field=models.DateField(blank=True, null=True, verbose_name="Дата акта"),
        ),
        migrations.AddField(
            model_name="claimact",
            name="reason",
            field=models.CharField(blank=True, max_length=500, verbose_name="Основание невозможности взыскания"),
        ),
        migrations.AddField(
            model_name="claimact",
            name="attachment",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="claim_acts", to="debts.attachment", verbose_name="Файл акта",
            ),
        ),
    ]
