from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0007_tz_421_gaps"),
    ]

    operations = [
        migrations.AddField(
            model_name="accountservice",
            name="repayment_due_on",
            field=models.DateField(blank=True, null=True, verbose_name="Срок погашения"),
        ),
        migrations.AddField(
            model_name="registration",
            name="social_category",
            field=models.CharField(blank=True, max_length=250, verbose_name="Социальная категория"),
        ),
        migrations.AddField(
            model_name="registration",
            name="unfit_for_work",
            field=models.BooleanField(default=False, verbose_name="Нетрудоспособен"),
        ),
        migrations.AddField(
            model_name="registration",
            name="heritage_transfer",
            field=models.CharField(
                blank=True,
                choices=[("accept", "Принятие наследства"), ("escheat", "Выморочное"), ("other", "Иной")],
                max_length=30,
                verbose_name="Способ перехода прав",
            ),
        ),
        migrations.AddField(
            model_name="measure",
            name="suspension_confirmed_on",
            field=models.DateField(blank=True, null=True, verbose_name="Факт приостановления"),
        ),
        migrations.AddField(
            model_name="measure",
            name="suspension_source",
            field=models.CharField(blank=True, max_length=10, verbose_name="Источник подтверждения приостановления"),
        ),
        migrations.AddField(
            model_name="measure",
            name="resumed_on",
            field=models.DateField(blank=True, null=True, verbose_name="Факт возобновления"),
        ),
        migrations.AddField(
            model_name="measure",
            name="resume_source",
            field=models.CharField(blank=True, max_length=10, verbose_name="Источник подтверждения возобновления"),
        ),
    ]
