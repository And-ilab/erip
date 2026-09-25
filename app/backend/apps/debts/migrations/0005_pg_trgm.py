from django.db import migrations


def add_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    schema_editor.execute(
        "CREATE INDEX IF NOT EXISTS account_fio_trgm ON debts_account USING gin (short_fio gin_trgm_ops)"
    )
    schema_editor.execute(
        "CREATE INDEX IF NOT EXISTS account_address_trgm ON debts_account "
        "USING gin (account_address gin_trgm_ops)"
    )
    schema_editor.execute(
        "CREATE INDEX IF NOT EXISTS registration_personal_trgm ON debts_registration "
        "USING gin (personal_num gin_trgm_ops)"
    )


def drop_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("DROP INDEX IF EXISTS registration_personal_trgm")
    schema_editor.execute("DROP INDEX IF EXISTS account_address_trgm")
    schema_editor.execute("DROP INDEX IF EXISTS account_fio_trgm")


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0004_scale_indexes"),
    ]

    operations = [
        migrations.RunPython(add_trgm, drop_trgm),
    ]
