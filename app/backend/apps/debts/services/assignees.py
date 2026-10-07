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
    """Одно полное имя на всех схемах контура.

    На каждую схему заводится свой пользователь с тем же ФИО. В фильтре это один пункт:
    выборка идёт по имени, а не по идентификатору одной схемы.
    """
    rows = (
        accounts.exclude(assigned_to_id=None)
        .annotate(specialist_name=specialist_label())
        .order_by()
        .values_list("specialist_name", flat=True)
        .distinct()
    )
    names = sorted({name.strip() for name in rows if name and name.strip()})
    return [{"name": name} for name in names]
