"""Несколько специалистов на схему и закрепление лицевых счетов за ними.

Повтор не создаёт вторую учётную запись и не снимает специалиста, назначенного вручную.
Пароль новых пользователей: Passw0rd!x.
"""

import re

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from apps.debts.models import Account
from apps.users.models import Organization, User

PASSWORD = "Passw0rd!x"

PEOPLE = (
    ("Ковалёва", "Ольга", "Сергеевна"),
    ("Левчук", "Андрей", "Михайлович"),
    ("Гриневич", "Татьяна", "Ивановна"),
    ("Савич", "Пётр", "Николаевич"),
)


def _slug(schema_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", schema_name.lower()).strip("_") or "schema"


class Command(BaseCommand):
    help = "Добавить четырёх специалистов на каждую схему со счетами и разложить по ним свободные лицевые счета"

    @transaction.atomic
    def handle(self, *args, **options):
        created_users = pinned = 0
        lines = []
        for organization in Organization.objects.filter(is_active=True).order_by("schema_name"):
            if not Account.objects.filter(organization=organization).exists():
                continue
            users = []
            for index, person in enumerate(PEOPLE, start=1):
                user, was_created = self._user(organization, index, person)
                users.append(user)
                created_users += int(was_created)
            pinned += self._pin(organization, users)
            names = ", ".join(user.registry_name for user in users)
            lines.append(f"{organization.schema_name}: {names}")
        self.stdout.write(f"Новых специалистов: {created_users}. Закреплено лицевых счетов: {pinned}.")
        self.stdout.write(f"Пароль новых учёток: {PASSWORD}")
        for line in lines:
            self.stdout.write(line)

    def _user(self, organization, index: int, person: tuple[str, str, str]) -> tuple[User, bool]:
        last_name, first_name, middle_name = person
        username = f"spec_{_slug(organization.schema_name)}_{index}"
        user = User.objects.filter(username=username).first()
        if user is None:
            user = User.objects.create_user(
                username=username,
                password=PASSWORD,
                role=User.Role.SPECIALIST,
                contour=User.Contour.BILLING,
                organization=organization,
                first_name=first_name,
                last_name=last_name,
                middle_name=middle_name,
            )
            return user, True
        user.role = User.Role.SPECIALIST
        user.contour = User.Contour.BILLING
        user.organization = organization
        user.first_name = first_name
        user.last_name = last_name
        user.middle_name = middle_name
        user.is_active = True
        user.save()
        user.service_organizations.clear()
        return user, False

    def _pin(self, organization, users: list[User]) -> int:
        """Свободные счета и счета этих же демо-специалистов раскладываются по кругу."""
        mine = [user.pk for user in users]
        accounts = list(
            Account.objects.filter(organization=organization)
            .filter(Q(assigned_to__isnull=True) | Q(assigned_to_id__in=mine))
            .order_by("account_id", "id")
        )
        changed = 0
        for index, account in enumerate(accounts):
            target = users[index % len(users)]
            if account.assigned_to_id == target.id:
                continue
            account.assigned_to = target
            account.save(update_fields=["assigned_to", "updated_at"])
            changed += 1
        return changed
