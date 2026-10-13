"""Шкала групп: без пересечений и без пропусков (ТЗ 4.2.5, FR-CFG-05)."""

from apps.core.exceptions import ServiceError


class ScaleInvalid(ServiceError):
    default_detail = "Шкала групп не сохранена"
    default_code = "scale_invalid"


def scale_problem(bands: list[tuple[int, int, int | None]]) -> str:
    """bands: (группа, месяцев от, месяцев до). Пустая строка — шкала сплошная."""
    if not bands:
        return "Шкала групп пуста"
    ordered = sorted(bands, key=lambda band: (band[1], band[0]))
    if ordered[0][1] != 0:
        return "Шкала должна начинаться с 0 месяцев"
    cursor: int | None = 0
    seen_open = False
    for group, start, end in ordered:
        if seen_open:
            return "Только последняя группа без верхней границы"
        if cursor is None:
            return "Только последняя группа без верхней границы"
        if start < cursor:
            return f"Группа {group} пересекается с предыдущим диапазоном"
        if start > cursor:
            return f"Пропуск между {cursor} и {start} месяцами"
        if end is None:
            seen_open = True
            cursor = None
            continue
        if end <= start:
            return f"У группы {group} верхняя граница должна быть больше нижней"
        cursor = end
    if not seen_open:
        return "Последняя группа должна быть без верхней границы"
    return ""


def assert_continuous(bands: list[tuple[int, int, int | None]]) -> None:
    problem = scale_problem(bands)
    if problem:
        raise ScaleInvalid(problem)


def rating_problem(b_group: int, c_from: int, c_to: int, e_from: int) -> str:
    if not 2 <= b_group <= 6:
        return "Рейтинг B начинается с группы от 2 до 6"
    if c_from != b_group + 1:
        return "Между рейтингом B и C есть пропуск или пересечение"
    if c_to < c_from:
        return "Верхняя группа рейтинга C меньше нижней"
    if e_from != c_to + 1:
        return "Между рейтингом C и E есть пропуск или пересечение"
    if e_from > 7:
        return "Рейтинг E выходит за шкалу групп"
    return ""
