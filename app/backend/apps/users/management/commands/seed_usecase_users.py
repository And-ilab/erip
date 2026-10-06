"""Учётные записи для проверки сценариев по каждой схеме.

Повтор не создаёт вторую запись и не меняет уже заданный пароль.
Пароль новых пользователей: Passw0rd!x.

На каждую действующую схему: локальный администратор, специалист начисляющей
организации и наблюдатель. На каждого поставщика схемы — специалист, который
видит только его услуги. Плюс один суперадминистратор на все схемы.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import Organization, ServiceOrganization, User

PASSWORD = "Passw0rd!x"
SUPER_USERNAME = "uc_super"

BILLING = (
    ("admin", User.Role.LOCAL_ADMIN, "Администратор"),
    ("spec", User.Role.SPECIALIST, "Специалист"),
    ("view", User.Role.OBSERVER, "Наблюдатель"),
)


class Command(BaseCommand):
    help = "Учётные записи по каждой схеме: администратор, специалист, наблюдатель и поставщики"

    @transaction.atomic
    def handle(self, *args, **options):
        created = self._superadmin()
        lines = [f"uc_super — суперадминистратор, все схемы"]
        for organization in Organization.objects.filter(is_active=True).order_by("schema_name"):
            schema = organization.schema_name.lower()
            for key, role, label in BILLING:
                username = f"uc_{schema}_{key}"
                created += self._ensure(
                    username,
                    role=role,
                    contour=User.Contour.BILLING,
                    organization=organization,
                    first_name=label,
                    last_name=organization.name[:150],
                    suppliers=(),
                )
                lines.append(f"{username} — {label}, {organization.name}")
            suppliers = list(
                ServiceOrganization.objects.filter(
                    organization=organization, is_active=True, is_supplier=True,
                ).order_by("provider_id")
            )
            if not suppliers:
                lines.append(f"  поставщиков в {organization.schema_name} нет")
            for supplier in suppliers:
                username = f"uc_{schema}_p{supplier.provider_id}"
                created += self._ensure(
                    username,
                    role=User.Role.SPECIALIST,
                    contour=User.Contour.SUPPLIER,
                    organization=organization,
                    first_name=supplier.short_name[:150],
                    last_name="Поставщик",
                    suppliers=(supplier,),
                )
                lines.append(f"{username} — поставщик {supplier.short_name}, {organization.name}")
        self.stdout.write(f"Новых учётных записей: {created}. Пароль новых: {PASSWORD}")
        for line in lines:
            self.stdout.write(line)

    def _superadmin(self) -> int:
        return self._ensure(
            SUPER_USERNAME,
            role=User.Role.SUPERADMIN,
            contour=User.Contour.BILLING,
            organization=None,
            first_name="Суперадминистратор",
            last_name="Все схемы",
            suppliers=(),
        )

    def _ensure(self, username, *, role, contour, organization, first_name, last_name, suppliers) -> int:
        user = User.objects.filter(username=username).first()
        created = 0
        if user is None:
            user = User.objects.create_user(
                username=username,
                password=PASSWORD,
                role=role,
                contour=contour,
                organization=organization,
                first_name=first_name,
                last_name=last_name,
            )
            created = 1
        else:
            user.role = role
            user.contour = contour
            user.organization = organization
            user.first_name = first_name
            user.last_name = last_name
            user.is_active = True
            user.save()
        if suppliers:
            user.service_organizations.set(suppliers)
        else:
            user.service_organizations.clear()
        return created
