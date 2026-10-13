"""CSV для импорта в ПланФикс: каждый пункт фаз 0–10 с описанием под текущий контур app/."""

from __future__ import annotations

import csv
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "planfix_phase_tasks.csv"

PATH = {
    "M1-01": "app/docker-compose.yml, app/README.md, app/SERVER.md",
    "M1-02": "app/postgres/ais_3nf.sql и app/backend/apps/debts/models.py",
    "M1-03": "app/frontend/src/app",
    "M1-04": "app/backend/apps/users/auth.py и app/backend/apps/audit",
    "M1-05": "app/backend/apps/users",
    "M1-06": "app/backend/apps/nsi",
    "M1-07": "app/backend/apps/imports",
    "M1-08": "app/backend/apps/debts/services/grouping.py",
    "M1-09": "app/frontend/src/app/features/accounts и app/backend/apps/debts/views.py",
    "M1-10": "app/frontend/src/app/features/accounts/account-detail.component.ts",
    "M1-11": "app/backend/apps/debts (договоры поставщика ещё не заведены)",
    "M2-01": "новый пакет app/backend/apps/measures",
    "M2-02": "app/backend/apps/measures и карточка ЛС",
    "M2-03": "app/gateway/app/adapters и app/backend/apps/notifications",
    "M2-04": "app/backend/apps/notifications (шаблоны)",
    "M2-05": "новый пакет печатных форм рядом с app/backend/apps/notifications",
    "M2-06": "печатные формы и карточка ЛС",
    "M2-07": "задания поставщику в app/backend и кабинет в Angular",
    "M2-08": "новый реестр заданий в app/backend и app/frontend",
    "M2-09": "новый движок сценариев в app/backend",
    "M2-10": "app/backend/apps/imports (обратный CSV) и закрытие мер",
    "M3-01": "канбан взыскания в app/frontend и модель дела в app/backend",
    "M3-02": "app/backend/apps/nsi",
    "M3-03": "карточка исполнительной надписи в app/backend",
    "M3-04": "карточка иска в app/backend",
    "M3-05": "учёт ОПИ в карточке дела",
    "M3-06": "этап списания в карточке дела",
    "M3-07": "действия сценария для юридической службы",
    "M3-08": "партии обзвона в app/backend, канал voice шлюза",
    "M3-09": "app/gateway/app/adapters (AMI) и история в карточке ЛС",
    "M3-10": "app/backend/apps/users/scoping.py и app/backend/apps/audit",
    "M4-01": "витрины в PostgreSQL рядом со схемой public",
    "M4-02": "раздел аналитики в app/frontend",
    "M4-03": "отчёты по мероприятиям",
    "M4-04": "отчёты по повторным должникам",
    "M4-05": "отчёты по воронке и отключениям",
    "M4-06": "конструктор отчётов",
    "M4-07": "дашборды сводных показателей",
    "M4-08": "адаптер Белпочты в app/gateway",
    "M4-09": "app/gateway/app/integrations (БНП)",
    "M4-10": "app/gateway/app/integrations/pris",
    "M4-11": "экран настроек интеграций в Angular и журнал обмена",
    "M4-12": "app/nginx/default.conf, prod-настройки Django и шлюза",
    "M4-13": "хранение raw и команда purge_retained",
    "M4-14": "app/SERVER.md и нагрузочный прогон import_ais",
    "M4-15": "app/README.md и эксплуатационные инструкции",
    "M4-16": "приёмка на тестовом контуре из app/SERVER.md",
}


def place(task_id: str) -> str:
    return PATH.get(task_id[:5], "app/")


def load() -> tuple[str, str]:
    backlog = subprocess.check_output(["git", "show", "8b598a6:backlog.md"], cwd=ROOT).decode("utf-8-sig")
    checklist = subprocess.check_output(["git", "show", "8b598a6:planfix_checklist.txt"], cwd=ROOT).decode("utf-8-sig")
    return backlog, checklist


def parse_tasks(backlog: str) -> dict[str, dict]:
    tasks: dict[str, dict] = {}
    for block in re.split(r"\n#### ", backlog)[1:]:
        header = re.match(r"(M\d-\d\d-\d\d)\. ([^\n]+)", block)
        if not header:
            continue
        description = re.search(r"\*\*Описание реализации:\*\* (.+)", block)
        tz = re.search(r"\*\*Пункт ТЗ:\*\* (.+)", block)
        tasks[header.group(1)] = {
            "title": header.group(2).strip(),
            "desc": description.group(1).strip() if description else "",
            "tz": tz.group(1).strip() if tz else "",
            "dod": re.findall(r"- \[ \] (.+)", block),
        }
    return tasks


def parse_phases(backlog: str, checklist: str) -> list[tuple[str, list[tuple[str, str]]]]:
    section = backlog.split("## Соответствие исходным фазам", 1)[1].split("\n---", 1)[0]
    by_name: dict[str, list[str]] = {}
    for line in section.splitlines():
        if not line.startswith("| Фаза"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        by_name[cells[1]] = re.findall(r"M\d-\d\d-\d\d", cells[2])

    phases: list[tuple[str, list[tuple[str, str]]]] = []
    current = ""
    items: list[str] = []
    for raw in checklist.splitlines():
        if raw.startswith("Фаза"):
            if current:
                phases.append((current, list(items)))
            current = raw.strip()
            items = []
        elif raw.startswith("\t") and current:
            items.append(raw.strip())
    if current:
        phases.append((current, items))

    paired: list[tuple[str, list[tuple[str, str]]]] = []
    for name, points in phases:
        ids = by_name[name]
        if len(ids) != len(points):
            raise SystemExit(f"{name}: пунктов {len(points)}, задач {len(ids)}")
        paired.append((name, list(zip(ids, points, strict=True))))
    return paired


REQUIREMENT_443 = (
    "Горизонтально масштабируемая микросервисная архитектура, развёртывание на независимых площадках; "
    "отказоустойчивость интеграционного контура (файловый обмен + очереди)."
)
TASKS_443 = {"M1-01-01", "M1-01-03", "M1-07-02", "M4-13-02"}


def ground(text: str) -> str:
    """Уточнения путей в репозитории. Требование ТЗ 4.4.3 не подменяется текущим контуром."""
    replacements = (
        ("GitLab CI", "GitLab CI в app/.gitlab-ci.yml"),
        ("отдельной базой для архивного («холодного») хранилища", "схемами public, gateway и ais в одном PostgreSQL и сроками хранения raw"),
        ("ELK/OpenSearch, Prometheus, Grafana, AlertManager", "JSON-логи в stdout и журнал ошибок в приложении"),
        ("ELK/OpenSearch", "JSON-логи"),
    )
    for source, target in replacements:
        text = text.replace(source, target)
    return text


def description(phase: str, code: str, task_id: str, point: str, task: dict, nxt: str) -> str:
    where = place(task_id)
    text = ground(task["desc"])
    if task_id in TASKS_443 and REQUIREMENT_443 not in text:
        text = f"{text} По ТЗ 4.4.3: {REQUIREMENT_443}"
    result = (
        f"Изменение в {where}. Если меняется поведение, обновлён app/README.md. "
        f"Готов как input для {nxt}."
    )
    if task_id in TASKS_443:
        prompt = (
            f"В каталоге app/ сделай «{point}» ({task_id}, ТЗ {task['tz']}). "
            f"По ТЗ 4.4.3: {REQUIREMENT_443} "
            f"Место правки: {where}."
        )
    else:
        prompt = (
            f"В каталоге app/ сделай «{point}» ({task_id}, ТЗ {task['tz']}). "
            f"Контур: Django, шлюз FastAPI, Angular, PostgreSQL (схемы public, gateway, ais), Redis, Nginx. "
            f"Место правки: {where}."
        )
    return f"ID: {code}\n\nОписание: {text}\nРезультат задачи: {result}\nПромпт для агента: {prompt}"


def main() -> None:
    backlog, checklist = load()
    tasks = parse_tasks(backlog)
    phases = parse_phases(backlog, checklist)
    rows: list[tuple[str, str, str, str]] = []
    for phase, points in phases:
        number = re.search(r"Фаза (\d+)", phase).group(1)
        rows.append(("", phase, f"Фаза чек-листа ПланФикса. Пункты P{number}-01…P{number}-{len(points):02d}.", ""))
        codes = [f"P{number}-{index:02d}" for index in range(1, len(points) + 1)]
        for index, ((task_id, point), code) in enumerate(zip(points, codes, strict=True)):
            nxt = codes[index + 1] if index + 1 < len(codes) else "приёмку фазы"
            task = tasks[task_id]
            rows.append((phase, f"{code}. {point}", description(phase, code, task_id, point, task, nxt), "\n".join(task["dod"])))

    with OUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\r\n")
        writer.writerow(["Родительская задача", "Название", "Описание", "Чек-лист"])
        writer.writerows(rows)
    print(f"{OUT} rows={len(rows)}")


if __name__ == "__main__":
    main()
