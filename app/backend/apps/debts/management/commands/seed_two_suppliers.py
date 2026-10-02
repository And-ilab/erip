"""Схема с двумя поставщиками на трёх лицевых счетах.

Повтор обновляет суммы, пароли и привязку к карте, вторую карточку не создаёт.
Пароль учёток: Passw0rd!x.
"""

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.debts.models import Account, AccountService
from apps.debts.services.portfolio import PortfolioRefresher
from apps.debts.services.territory import TerritoryIndex
from apps.users.models import Organization, ServiceOrganization, User

PASSWORD = "Passw0rd!x"

# Группа 2 — 2 месяца, 3 — 3 месяца, 4 — 6 месяцев. Число в debt_period — месяцы, не номер группы.
ACCOUNTS = (
    (1, "Иванов И.И.", "40.00", "4.00", "70.00", "7.00", 3, 3,
     "г. Минск, Центральный район, ул. Немига, д. 5, кв. 1", "1", 2),
    (2, "Петров П.П.", "25.00", "2.50", "15.00", "1.50", 2, 2,
     "г. Минск, Советский район, ул. Якуба Коласа, д. 37, кв. 2", "2", 1),
    (3, "Сидоров С.С.", "10.00", "1.00", "90.00", "9.00", 4, 6,
     "г. Минск, Московский район, ул. Притыцкого, д. 62, кв. 3", "3", 3),
)


class Command(BaseCommand):
    help = "Схема test_two: ЖЭС и ЖКХ, три лицевых счёта с долями и точками на карте"

    @transaction.atomic
    def handle(self, *args, **options):
        organization, _created = Organization.objects.get_or_create(
            schema_name="test_two",
            defaults={"name": "Проверка двух поставщиков", "unp": "193000003"},
        )
        zhes = self._supplier(organization, 9301, "Тест ЖЭС")
        zhkh = self._supplier(organization, 9302, "Тест ЖКХ")
        operational = timezone.localdate().replace(day=1)
        refresher = PortfolioRefresher()
        for number, fio, zhes_debt, zhes_fine, zhkh_debt, zhkh_fine, group, months, address, flat, people in ACCOUNTS:
            account = self._account(
                organization, zhes, number, fio, address, flat, people, group, months,
                Decimal(zhes_debt) + Decimal(zhkh_debt), operational,
            )
            self._service(organization, account, 1, zhes, "Содержание", Decimal(zhes_debt), Decimal(zhes_fine), months)
            self._service(organization, account, 2, zhkh, "Коммунальные", Decimal(zhkh_debt), Decimal(zhkh_fine), months)
            refresher.refresh_account(account)
        linked = TerritoryIndex().assign_queryset(Account.objects.filter(organization=organization))
        self._user("test_zhes", "Тест ЖЭС", User.Contour.SUPPLIER, organization, [zhes])
        self._user("test_zhkh", "Тест ЖКХ", User.Contour.SUPPLIER, organization, [zhkh])
        self._user("test_spec", "Специалист", User.Contour.BILLING, organization, [])
        self.stdout.write(f"Схема test_two. Привязок к карте: {linked}. Пароль трёх учёток: {PASSWORD}")
        self.stdout.write("test_zhes — только долг Тест ЖЭС; test_zhkh — только долг Тест ЖКХ; test_spec — обе доли")
        self.stdout.write("ЛС 93000001: ЖЭС 40+4, ЖКХ 70+7, группа 3, ул. Немига, д. 5")
        self.stdout.write("ЛС 93000002: ЖЭС 25+2.50, ЖКХ 15+1.50, группа 2, ул. Якуба Коласа, д. 37")
        self.stdout.write("ЛС 93000003: ЖЭС 10+1, ЖКХ 90+9, группа 4, ул. Притыцкого, д. 62")

    def _supplier(self, organization, provider_id, name):
        row, _created = ServiceOrganization.objects.update_or_create(
            organization=organization,
            provider_id=provider_id,
            defaults={"short_name": name, "full_name": name, "is_supplier": True},
        )
        return row

    def _account(self, organization, house, number, fio, address, flat, people, group, months, balance, operational: date):
        account_id = 93_000_000 + number
        account, _created = Account.objects.update_or_create(
            organization=organization,
            provider_id=house.provider_id,
            account_id=account_id,
            defaults={"client_account": f"{account_id:08d}", "funnel_stage": "new"},
        )
        account.schema_name = organization.schema_name
        account.provider_short_name = house.short_name
        account.short_fio = fio
        account.account_address = address
        account.house_address = address
        account.flat_number = flat
        account.subj_count = people
        account.debt_group = group
        account.months_debt = months
        account.balance_out = balance
        account.operational_date = operational
        account.save()
        return account

    def _service(self, organization, account, service_list_id, provider, service_name, principal, penalty, months):
        service, _created = AccountService.objects.update_or_create(
            account=account,
            service_list_id=service_list_id,
            defaults={"organization": organization, "service_id": provider.provider_id},
        )
        service.organization = organization
        service.service_id = provider.provider_id
        service.service_name = service_name
        service.provider_id = provider.provider_id
        service.shot_name = provider.short_name
        service.full_name = provider.full_name
        service.balance_out = principal
        service.balance_mulct_out = penalty
        service.debt_period = months
        service.initial_principal = principal
        service.initial_penalty = penalty
        service.save()

    def _user(self, username, first_name, contour, organization, orgs):
        row = User.objects.filter(username=username).first()
        if row is None:
            row = User.objects.create_user(
                username=username,
                password=PASSWORD,
                role=User.Role.SPECIALIST,
                organization=organization,
                contour=contour,
                first_name=first_name,
            )
        else:
            row.organization = organization
            row.contour = contour
            row.role = User.Role.SPECIALIST
            row.first_name = first_name
            row.is_active = True
            row.set_password(PASSWORD)
            row.save()
        row.service_organizations.set(orgs)
        return row
