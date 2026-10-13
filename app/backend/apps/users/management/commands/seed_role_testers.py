"""Учётные записи с выбором роли после пароля.

Повтор команды не создаёт вторую запись и возвращает известный пароль.
Роль при входе выбирается отдельно и этой командой не задаётся.
"""

from django.core.management.base import BaseCommand

from apps.users.role_testers import TESTER_ACCOUNTS, ensure_role_testers


class Command(BaseCommand):
    help = "Тестовые учётные записи с выбором роли после пароля"

    def handle(self, *args, **options):
        created = ensure_role_testers()
        self.stdout.write(f"Новых учётных записей: {created}.")
        for username, password in TESTER_ACCOUNTS:
            self.stdout.write(f"{username} — пароль {password}")
