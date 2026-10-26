from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0008_organization_mail"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("superadmin", "Суперадминистратор"),
                    ("local_admin", "Локальный администратор"),
                    ("specialist", "Специалист"),
                    ("legal", "Специалист ЮС"),
                    ("observer", "Наблюдатель"),
                    ("viewer", "Специалист «Просмотр»"),
                ],
                default="specialist",
                max_length=20,
                verbose_name="Роль",
            ),
        ),
    ]
