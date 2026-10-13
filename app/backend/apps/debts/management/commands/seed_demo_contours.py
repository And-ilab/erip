"""Две демо-схемы с ЖЭС, поставщиками и лицевыми счетами для проверки контуров.

Повтор не создаёт вторую карточку и не меняет пароль уже существующей учётной записи.
Пароль новых пользователей: Passw0rd!x.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.debts.models import Account, AccountService
from apps.debts.services.portfolio import rating_letter
from apps.debts.services.territory import TerritoryIndex
from apps.users.models import Organization, ServiceOrganization, User

PASSWORD = "Passw0rd!x"

SCHEMAS = (
    ("demo_minsk", "Демо: ЖКХ Минск", "190000001"),
    ("demo_fanipol", "Демо: ЖКХ Фаниполь", "190000002"),
)

BILLING = (
    (9101, "ЖЭС-1"),
    (9102, "ЖЭС-2"),
)

SUPPLIERS = (
    (9201, "Водоканал", "Вода", 1, 10),
    (9202, "Газоснабжение", "Газ", 2, 20),
    (9203, "Электросети", "Электричество", 3, 30),
)

ACCOUNTS = (
    (1, 0, "Ковалёв А.С.", "г. Минск, Центральный район, ул. Немига, д. 5, кв. 12", "12", 2, "48.20", (0, 1)),
    (2, 0, "Левчук М.И.", "г. Минск, Центральный район, ул. Комсомольская, д. 13, кв. 4", "4", 1, "22.10", (0,)),
    (3, 1, "Гриневич О.П.", "г. Минск, Центральный район, пр-т Независимости, д. 19, кв. 8", "8", 3, "61.00", (1, 2)),
    (4, 1, "Савич Т.В.", "г. Минск, Советский район, ул. Якуба Коласа, д. 37, кв. 21", "21", 4, "36.80", (0, 1, 2)),
    (5, 0, "Романовский И.Д.", "г. Минск, Советский район, ул. Сурганова, д. 29, кв. 6", "6", 2, "19.50", (2,)),
    (6, 1, "Юркевич Н.А.", "г. Минск, Советский район, ул. Богдановича, д. 80, кв. 15", "15", 3, "27.90", (0, 2)),
)

USERS = (
    ("spec", "Специалист", "Демо", None),
    ("water", "Вода", "Поставщик", 0),
    ("gas", "Газ", "Поставщик", 1),
    ("power", "Свет", "Поставщик", 2),
)


class Command(BaseCommand):
    help = "Добавить две демо-схемы, ЖЭС, поставщиков воды, газа и электричества и лицевые счета с разными услугами"

    @transaction.atomic
    def handle(self, *args, **options):
        created_orgs = created_accounts = created_users = 0
        for schema_name, title, unp in SCHEMAS:
            organization, was_created = Organization.objects.get_or_create(
                schema_name=schema_name, defaults={"name": title, "unp": unp},
            )
            created_orgs += int(was_created)
            billing = [self._service_org(organization, code, name, False) for code, name in BILLING]
            suppliers = [self._service_org(organization, code, name, True) for code, name, *_rest in SUPPLIERS]
            created_accounts += self._accounts(organization, schema_name, billing, suppliers)
            created_users += self._users(organization, schema_name, suppliers)
        linked = TerritoryIndex().assign_queryset(
            Account.objects.filter(organization__schema_name__in=[item[0] for item in SCHEMAS]),
        )
        self.stdout.write(
            f"Новых схем: {created_orgs}. Новых лицевых счетов: {created_accounts}. "
            f"Новых пользователей: {created_users}. Привязок к адресу: {linked}."
        )
        self.stdout.write(f"Пароль новых учёток: {PASSWORD}")
        for schema_name, _title, _unp in SCHEMAS:
            suffix = schema_name.removeprefix("demo_")
            self.stdout.write(
                f"{schema_name}: demo_spec_{suffix} (вся схема); "
                f"demo_water_{suffix}, demo_gas_{suffix}, demo_power_{suffix} (своя услуга)"
            )

    def _service_org(self, organization, provider_id, short_name, is_supplier):
        org, _created = ServiceOrganization.objects.get_or_create(
            organization=organization,
            provider_id=provider_id,
            defaults={"short_name": short_name, "is_supplier": is_supplier},
        )
        changed = []
        if org.short_name != short_name:
            org.short_name = short_name
            changed.append("short_name")
        if org.is_supplier != is_supplier:
            org.is_supplier = is_supplier
            changed.append("is_supplier")
        if changed:
            org.save(update_fields=[*changed, "updated_at"])
        return org

    def _accounts(self, organization, schema_name, billing, suppliers):
        base = 91_000_000 if schema_name == "demo_minsk" else 92_000_000
        created = 0
        for offset, billing_index, fio, address, flat, group, balance, service_indexes in ACCOUNTS:
            house = billing[billing_index]
            account, was_created = Account.objects.get_or_create(
                organization=organization,
                provider_id=house.provider_id,
                account_id=base + offset,
                defaults={
                    "client_account": f"{base + offset:08d}",
                    "schema_name": schema_name,
                    "provider_short_name": house.short_name,
                    "short_fio": fio,
                    "house_address": address,
                    "account_address": address,
                    "flat_number": flat,
                    "debt_group": group,
                    "balance_out": Decimal(balance),
                    "funnel_stage": "new",
                    "months_debt": group,
                    "rating": rating_letter(group, False),
                },
            )
            created += int(was_created)
            for index in service_indexes:
                provider_id, short_name, service_name, service_list_id, service_id = SUPPLIERS[index]
                AccountService.objects.get_or_create(
                    account=account,
                    service_list_id=service_list_id,
                    defaults={
                        "organization": organization,
                        "service_id": service_id,
                        "service_name": service_name,
                        "provider_id": provider_id,
                        "shot_name": short_name,
                        "balance_out": Decimal(balance),
                        "debt_group": group,
                        "debt_period": group,
                    },
                )
        return created

    def _users(self, organization, schema_name, suppliers):
        suffix = schema_name.removeprefix("demo_")
        created = 0
        for key, first_name, last_name, supplier_index in USERS:
            username = f"demo_{key}_{suffix}"
            user = User.objects.filter(username=username).first()
            if user is None:
                user = User.objects.create_user(
                    username=username,
                    password=PASSWORD,
                    role=User.Role.SPECIALIST,
                    organization=organization,
                    contour=User.Contour.SUPPLIER if supplier_index is not None else User.Contour.BILLING,
                    first_name=first_name,
                    last_name=last_name,
                )
                created += 1
            if supplier_index is None:
                user.service_organizations.clear()
            else:
                user.service_organizations.set([suppliers[supplier_index]])
        return created
