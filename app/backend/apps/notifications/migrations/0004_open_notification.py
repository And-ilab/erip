from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0003_messagetemplate_debt_group"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(
                fields=["recipient_user", "channel", "is_read", "status"], name="notif_inbox_unread",
            ),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["organization", "status", "created_at"], name="notif_org_status"),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                fields=["created_by", "account", "template", "channel"],
                condition=models.Q(status__in=["new", "queued"], account__isnull=False, template__isnull=False),
                name="uniq_open_account_notification",
            ),
        ),
    ]
