"""Порядок столбцов реестра: скрытый столбец помнит место, с которого его убрали."""

from rest_framework.exceptions import ValidationError

COLUMN_MARK = "__explicit"
HIDE_PREFIX = "__hide__:"


def column_layout(stored: list, allowed: list[str]) -> tuple[list[str], list[str]]:
    """Видимые столбцы и полный порядок, включая скрытые."""
    raw = [item for item in (stored or []) if isinstance(item, str)]
    explicit = COLUMN_MARK in raw
    visible: list[str] = []
    order: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if item == COLUMN_MARK:
            break
        hidden = item.startswith(HIDE_PREFIX)
        name = item[len(HIDE_PREFIX):] if hidden else item
        if name not in allowed or name in seen:
            continue
        seen.add(name)
        order.append(name)
        if not hidden:
            visible.append(name)
    if explicit:
        for name in allowed:
            if name not in seen:
                _insert_by_catalog(order, name, allowed)
                seen.add(name)
        if not visible:
            visible = list(order)
        return visible, order
    for name in allowed:
        if name in seen:
            continue
        if name == "schema_label":
            order.insert(0, name)
            visible.insert(0, name)
        else:
            order.append(name)
            visible.append(name)
        seen.add(name)
    return visible, order


def save_column_layout(pref, payload, allowed: list[str], order_payload=None) -> tuple[list[str], list[str]]:
    """Сохраняет видимые столбцы. Скрытые остаются в порядке на своём месте."""
    chosen = _names(payload, allowed)
    if not chosen:
        raise ValidationError({"columns": "Оставьте хотя бы один столбец"})
    previous_visible, previous_order = column_layout(pref.columns, allowed)
    if isinstance(order_payload, list):
        layout = _names(order_payload, allowed)
        seen = set(layout)
        for name in allowed:
            if name not in seen:
                _insert_by_catalog(layout, name, allowed)
                seen.add(name)
    else:
        layout = _merge_visibility(previous_order, previous_visible, chosen, allowed)
    chosen_set = set(chosen)
    pref.columns = [
        name if name in chosen_set else f"{HIDE_PREFIX}{name}"
        for name in layout
    ]
    pref.columns.append(COLUMN_MARK)
    pref.save(update_fields=["columns", "updated_at"])
    visible = [name for name in layout if name in chosen_set]
    return visible, layout


def _names(payload, allowed: list[str]) -> list[str]:
    if not isinstance(payload, list):
        return []
    allowed_set = set(allowed)
    chosen: list[str] = []
    seen: set[str] = set()
    for name in payload:
        if isinstance(name, str) and name in allowed_set and name not in seen:
            chosen.append(name)
            seen.add(name)
    return chosen


def _merge_visibility(
    previous_order: list[str], previous_visible: list[str], chosen: list[str], allowed: list[str],
) -> list[str]:
    layout = list(previous_order)
    seen = set(layout)
    for name in allowed:
        if name not in seen:
            _insert_by_catalog(layout, name, allowed)
            seen.add(name)
    chosen_set = set(chosen)
    prev_visible_set = set(previous_visible)
    old_seq = [name for name in previous_visible if name in chosen_set]
    new_seq = [name for name in chosen if name in prev_visible_set]
    if old_seq == new_seq:
        return layout
    hidden = [(index, name) for index, name in enumerate(layout) if name not in chosen_set]
    result = list(chosen)
    for index, name in hidden:
        result.insert(min(index, len(result)), name)
    return result


def _insert_by_catalog(order: list[str], name: str, catalog: list[str]) -> None:
    rank = {item: index for index, item in enumerate(catalog)}
    name_rank = rank.get(name, len(catalog))
    insert_at = 0
    for index, existing in enumerate(order):
        if rank.get(existing, -1) < name_rank:
            insert_at = index + 1
    order.insert(insert_at, name)
