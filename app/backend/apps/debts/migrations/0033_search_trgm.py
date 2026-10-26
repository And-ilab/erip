from django.db import migrations

# Поиск по окнам — ILIKE '%текст%'. B-tree его не ускоряет, gin_trgm — ускоряет.
_INDEXES = (
    ("account_number_trgm", "debts_account", "client_account"),
    ("account_payer_id_trgm", "debts_account", "payer_identifier"),
    ("account_payer_unp_trgm", "debts_account", "payer_unp"),
    ("account_provider_trgm", "debts_account", "provider_short_name"),
    ("account_schema_trgm", "debts_account", "schema_name"),
    ("account_scenario_trgm", "debts_account", "scenario_name"),
    ("account_owner_trgm", "debts_account", "ownership_type_name"),
    ("account_housing_trgm", "debts_account", "acc_category_full"),
    ("service_name_trgm", "debts_accountservice", "service_name"),
    ("service_shot_trgm", "debts_accountservice", "shot_name"),
    ("measure_template_trgm", "debts_measure", "template_name"),
    ("measure_scenario_trgm", "debts_measure", "scenario_name"),
)


def add_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, column in _INDEXES:
        schema_editor.execute(
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({column} gin_trgm_ops)"
        )


def drop_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for name, _table, _column in _INDEXES:
        schema_editor.execute(f"DROP INDEX IF EXISTS {name}")


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0032_query_indexes"),
    ]

    operations = [
        migrations.RunPython(add_trgm, drop_trgm),
    ]
