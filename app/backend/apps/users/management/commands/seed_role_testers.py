"""Учётные записи a.poleshchuk@raschet.by и a.galdytskaya@raschet.by.

Повтор команды не создаёт вторую запись и возвращает пароль Raschet-Test-2026.
Роль при входе выбирается отдельно и этой командой не задаётся.
"""

from django.core.management.base import BaseCommand

from apps.users.role_testers import PASSWORD, TESTER_USERNAMES, ensure_role_testers


class Command(BaseCommand):
    help = "Две тестовые учётные записи с выбором роли после пароля"

    def handle(self, *args, **options):
        created = ensure_role_testers()
        self.stdout.write(f"Новых учётных записей: {created}. Пароль: {PASSWORD}")
        for username in TESTER_USERNAMES:
            self.stdout.write(username)
