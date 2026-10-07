"""Имя закреплённого специалиста для реестра и группировки.

В колонке и в группе одна и та же строка: фамилия, имя, отчество.
Пустые части пропускаются, чтобы «Анна Петровна» без фамилии не обрастала пробелами.
"""

from django.db.models import CharField, Value
from django.db.models.functions import Coalesce, Concat, Trim


def specialist_label(prefix: str = ""):
    """Выражение SQL: фамилия, имя и отчество закреплённого специалиста."""
    return Trim(
        Concat(
            Coalesce(f"{prefix}assigned_to__last_name", Value("")),
            Value(" "),
            Coalesce(f"{prefix}assigned_to__first_name", Value("")),
            Value(" "),
            Coalesce(f"{prefix}assigned_to__middle_name", Value("")),
            output_field=CharField(),
        )
    )


def specialist_choices(accounts) -> list[dict]:
    """Специалисты, за которыми в этой выборке закреплён хотя бы один лицевой счёт."""
    rows = (
        accounts.exclude(assigned_to_id=None)
        .order_by()
        .values(
            "assigned_to_id",
            "assigned_to__last_name",
            "assigned_to__first_name",
            "assigned_to__middle_name",
        )
        .distinct()
    )
    people = []
    for row in rows:
        name = " ".join(
            part for part in (
                row["assigned_to__last_name"],
                row["assigned_to__first_name"],
                row["assigned_to__middle_name"],
            ) if part
        )
        people.append({"id": row["assigned_to_id"], "name": name or str(row["assigned_to_id"])})
    people.sort(key=lambda item: item["name"])
    return people
