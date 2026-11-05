"""Такт автоопроса АИС ПРИС. Период читается из настройки на экране интеграций."""

import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from apps.debts.services.pris_live import tick_pris_poll


class Command(BaseCommand):
    help = "Ждёт период с экрана «АИС ПРИС» и обновляет ход принятых дел. Пустой период контур не вызывает."

    def handle(self, *args, **options):
        self.stdout.write("Автоопрос ПРИС запущен. Период берётся из «Настройка → Интеграции → АИС ПРИС».")
        while True:
            close_old_connections()
            try:
                result = tick_pris_poll()
            except Exception as exc:
                self.stderr.write(f"Такт автоопроса не выполнен: {exc}")
                result = {"ran": False, "wait": 30}
            if result.get("ran"):
                self.stdout.write(result.get("summary") or "Такт выполнен.")
            close_old_connections()
            time.sleep(int(result.get("wait") or 30))
