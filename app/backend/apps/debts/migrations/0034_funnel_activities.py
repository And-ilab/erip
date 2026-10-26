import django.utils.timezone
from django.db import migrations, models


LEGACY = {
    "prevention": "call",
    "warning": "notice",
    "enforcement": "prep",
    "court": "opi",
    "closed": "recovered",
}
RANK = {
    "new": 0, "call": 1, "notice": 2, "disconnect": 3, "prep": 4, "notary": 5,
    "writ_done": 6, "refused": 7, "lawsuit": 8, "judgment": 9, "opi": 10,
    "opi_measures": 11, "recovered": 12, "impossible": 13, "writeoff": 14,
}
MEASURES = (
    ("call", "call"),
    ("notice", "notice"),
    ("warning", "notice"),
    ("disconnect", "disconnect"),
    ("collection", "prep"),
)
CLAIMS = (
    ("prep", "prep"),
    ("notary", "notary"),
    ("writ_done", "writ_done"),
    ("refused", "refused"),
    ("lawsuit", "lawsuit"),
    ("court", "judgment"),
    ("opi", "opi"),
    ("opi_measures", "opi_measures"),
    ("recovered", "recovered"),
    ("impossible", "impossible"),
    ("writeoff", "writeoff"),
)


def _below(stage: str) -> list[str]:
    limit = RANK[stage]
    return [code for code, rank in RANK.items() if rank < limit]


def forwards(apps, schema_editor):
    Account = apps.get_model("debts", "Account")
    Account.objects.filter(funnel_stage="").update(funnel_stage="new")
    for old, new in LEGACY.items():
        Account.objects.filter(funnel_stage=old).update(funnel_stage=new)
    for kind, stage in MEASURES:
        Account.objects.filter(
            measure_items__status__in=["assigned", "running"],
            measure_items__measure__kind=kind,
            funnel_stage__in=_below(stage),
        ).distinct().update(funnel_stage=stage)
    for claim_stage, stage in CLAIMS:
        below = _below(stage)
        if not below:
            continue
        Account.objects.filter(
            claim_case__stage=claim_stage,
            funnel_stage__in=below,
        ).distinct().update(funnel_stage=stage)


class Migration(migrations.Migration):

    dependencies = [
        ("debts", "0033_search_trgm"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="parallel_stage",
            field=models.CharField(
                blank=True,
                default="",
                help_text="P1 или P2 для групп 4–6. Колонку основной ветви не меняет.",
                max_length=20,
                verbose_name="Параллельная ветвь выселения",
            ),
        ),
        migrations.CreateModel(
            name="StageActivity",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Создано")),
                ("updated_at", models.DateTimeField(default=django.utils.timezone.now, editable=False, verbose_name="Изменено")),
                ("stage", models.CharField(max_length=20, verbose_name="Этап")),
                ("code", models.CharField(max_length=40, verbose_name="Код пункта")),
                ("parent_code", models.CharField(blank=True, max_length=40, verbose_name="Код группы")),
                ("title", models.CharField(max_length=200, verbose_name="Название")),
                ("kind", models.CharField(max_length=20, verbose_name="Вид шага")),
                ("status", models.CharField(
                    choices=[("running", "В работе"), ("done", "Завершено")],
                    default="running", max_length=20, verbose_name="Статус",
                )),
                ("sort", models.PositiveSmallIntegerField(default=0, verbose_name="Порядок")),
                ("note", models.CharField(blank=True, max_length=500, verbose_name="Результат шага")),
                ("account", models.ForeignKey(
                    on_delete=models.deletion.CASCADE, related_name="stage_activities",
                    to="debts.account", verbose_name="ЛС",
                )),
                ("measure", models.ForeignKey(
                    blank=True, null=True, on_delete=models.deletion.SET_NULL,
                    related_name="stage_activities", to="debts.measure", verbose_name="Мероприятие",
                )),
                ("organization", models.ForeignKey(
                    on_delete=models.deletion.PROTECT, related_name="+",
                    to="users.organization", verbose_name="Организация",
                )),
            ],
            options={
                "verbose_name": "Активность этапа",
                "verbose_name_plural": "Активности этапа",
                "ordering": ["sort", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="stageactivity",
            constraint=models.UniqueConstraint(fields=("account", "stage", "code"), name="uniq_stage_activity"),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
