"""Чек-лист создания исполнительной надписи в шаге сценария (ТЗ 4.2.4.2, 4.2.4.6, 4.2.5.2).

Название, порядок и текст критерия задаёт администратор. Коды законных этапов
нельзя убрать и нельзя сделать пропуском: дату вручения, срок добровольной оплаты,
пакет и нотариальный тариф проверяет система, а не формулировка критерия.
"""

from apps.core.exceptions import ServiceError

LOCKED = ("warning", "voluntary", "package", "tariff")
OPTIONAL = ("disconnect",)

CATALOG = {
    "warning": {
        "name": "Предупреждение вручено",
        "criteria": "Есть дата вручения предупреждения или уведомления",
    },
    "voluntary": {
        "name": "Срок добровольной оплаты истёк",
        "criteria": "С даты вручения прошло не меньше срока, заданного для схемы",
    },
    "package": {
        "name": "Пакет документов",
        "criteria": "Сформирован пакет на исполнительную надпись",
    },
    "tariff": {
        "name": "Нотариальный тариф",
        "criteria": "Тариф из АИС больше нуля, заявление не отозвано",
    },
    "disconnect": {
        "name": "Отключение услуг",
        "criteria": "Услуги отключены. Неприменимый этап пропускается с записанной причиной",
    },
}


class ChecklistInvalid(ServiceError):
    default_detail = "Чек-лист надписи не сохранён"
    default_code = "checklist_invalid"


def default_checklist() -> list[dict]:
    rows = []
    for index, code in enumerate(LOCKED, start=1):
        spec = CATALOG[code]
        rows.append({
            "code": code,
            "order": index,
            "name": spec["name"],
            "criteria": spec["criteria"],
            "mandatory": True,
        })
    return rows


def normalize_checklist(raw) -> list[dict]:
    """Пустой чек-лист шага заменяется законным набором. Явный список проверяется."""
    if raw is None:
        return default_checklist()
    if not isinstance(raw, list) or not raw:
        raise ChecklistInvalid("В чек-листе надписи нет этапов")
    rows = []
    seen = set()
    orders = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ChecklistInvalid("Этап чек-листа — это название, порядок и критерий")
        code = str(item.get("code") or "").strip()
        if code not in CATALOG:
            raise ChecklistInvalid(f"Неизвестный этап чек-листа: {code or '—'}")
        if code in seen:
            raise ChecklistInvalid(f"Этап «{CATALOG[code]['name']}» указан дважды")
        seen.add(code)
        order = item.get("order")
        if not isinstance(order, int) or isinstance(order, bool) or order < 1:
            raise ChecklistInvalid(f"У этапа «{CATALOG[code]['name']}» нет порядкового номера")
        if order in orders:
            raise ChecklistInvalid("Порядковые номера этапов чек-листа не повторяются")
        orders.add(order)
        name = str(item.get("name") or "").strip()
        criteria = str(item.get("criteria") or "").strip()
        if not name:
            raise ChecklistInvalid("У этапа чек-листа нет названия")
        if len(name) > 120:
            raise ChecklistInvalid("Название этапа длиннее 120 символов")
        if not criteria:
            raise ChecklistInvalid(f"У этапа «{name}» нет критерия приёмки")
        if len(criteria) > 400:
            raise ChecklistInvalid(f"Критерий этапа «{name}» длиннее 400 символов")
        if "mandatory" in item and not isinstance(item.get("mandatory"), bool):
            raise ChecklistInvalid("Обязательность этапа — да или нет")
        mandatory = True if "mandatory" not in item else bool(item["mandatory"])
        if code in LOCKED and not mandatory:
            raise ChecklistInvalid(f"Этап «{CATALOG[code]['name']}» обязателен, его нельзя сделать пропуском")
        rows.append({
            "code": code,
            "order": order,
            "name": name,
            "criteria": criteria,
            "mandatory": mandatory,
        })
    missing = [CATALOG[code]["name"] for code in LOCKED if code not in seen]
    if missing:
        raise ChecklistInvalid(f"Из чек-листа нельзя убрать: {', '.join(missing)}")
    rows.sort(key=lambda row: row["order"])
    return rows
