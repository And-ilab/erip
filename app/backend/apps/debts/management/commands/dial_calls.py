"""Прогон автообзвона в окне сценария. Результат пишет адаптер, не специалист."""

from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.debts.services.autocall import dial_due_calls


class Command(BaseCommand):
    help = "Прозванивает открытые партии автообзвона, если момент попадает в окно сценария."

    def add_arguments(self, parser):
        parser.add_argument(
            "--at",
            default="",
            help="Момент прогона, ГГГГ-ММ-ДДTЧЧ:ММ. Пусто — текущее время.",
        )

    def handle(self, *args, **options):
        raw = (options.get("at") or "").strip()
        moment = None
        if raw:
            try:
                moment = datetime.fromisoformat(raw)
            except ValueError as exc:
                raise CommandError("Время в формате ГГГГ-ММ-ДДTЧЧ:ММ") from exc
            if timezone.is_naive(moment):
                moment = timezone.make_aware(moment, timezone.get_current_timezone())
        result = dial_due_calls(moment)
        when = timezone.localtime(moment) if moment else timezone.localtime()
        self.stdout.write(f"Момент: {when.strftime('%d.%m.%Y %H:%M')}.")
        self.stdout.write(
            f"Строк с результатом: {result['dialed']}. "
            f"Открытых партий: {result['open_parties']}, в окне: {result['in_window']}."
        )
        if result["dialed"] == 0:
            self.stdout.write("В это время обзвон не идёт: вне окна сценария или раньше дня старта.")
