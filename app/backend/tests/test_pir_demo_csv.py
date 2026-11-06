"""Выгрузка «Тестовая выборка для тестов»: один ЛС проходит проверки данных цикла ПИР."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from apps.debts.models import Account
from apps.debts.services.bnp_package import PERSONAL_ID_RE, _debtor_problems, _suggest_debtors
from apps.debts.services.writ_draft import AIS_WRIT_WARNING, _eligible_periods, _gate_messages
from apps.imports.services import AisImporter
from apps.users.models import Organization, User

from .conftest import make_user

DEMO_DIR = Path(__file__).resolve().parents[3] / "Тестовая выборка для тестов"
FILES = (
    ("account", "Карточка ЛС demo_minsk.csv"),
    ("service", "Услуги demo_minsk.csv"),
    ("payment", "Оплата demo_minsk.csv"),
    ("registration", "Регистрация demo_minsk.csv"),
)


@pytest.fixture
def pir_account(db):
    org = Organization.objects.create(schema_name="demo_minsk", name="Демо: ЖКХ Минск")
    for entity, name in FILES:
        path = DEMO_DIR / name
        job = AisImporter(entity, org).run(path.read_bytes(), path.name)
        assert job.rejected == 0, job.errors
        assert job.created + job.updated >= 1
    return Account.objects.get(organization=org, client_account="00091091")


@pytest.mark.django_db
def test_pir_demo_csv_passes_data_checks(pir_account):
    account = pir_account
    assert account.account_id == 91091001
    assert account.schema_name == "demo_minsk"
    assert account.short_fio == "Ковалёв П.С."
    assert account.account_address == "г. Минск, пр-т Независимости, д. 17, кв. 5"
    assert account.contact_phone == "+375291112233"
    assert account.balance_out == Decimal("600.75")
    assert account.months_debt == 6
    assert account.debt_group == 4
    assert account.operational_date == date(2026, 11, 6)
    assert account.payer_identifier == "4111111A111AA1"
    assert account.inheritance_case is False
    assert account.stop_date == date(2100, 1, 1)

    services = {row.service_name: row for row in account.services.all()}
    assert services["Холодное водоснабжение"].debt_group == 4
    assert services["Холодное водоснабжение"].balance_out == Decimal("420.50")
    assert services["Холодное водоснабжение"].balance_mulct_out == Decimal("18.40")
    assert services["Теплоснабжение"].debt_group == 3
    assert services["Теплоснабжение"].balance_out == Decimal("180.25")
    assert services["Теплоснабжение"].balance_mulct_out == Decimal("7.15")

    months = {(row.period.year, row.period.month) for row in _eligible_periods(account)}
    assert months == {(2026, 6), (2026, 8)}

    person = account.registrations.get()
    assert person.fam == "Ковалёв"
    assert person.im == "Пётр"
    assert person.ot == "Сергеевич"
    assert person.email == "kovalev.pir@example.com"
    assert person.subj_is_main is True
    assert person.subj_is_check_out is False
    assert person.subj_legal_entity is False
    assert PERSONAL_ID_RE.fullmatch(person.personal_num)

    debtors = _suggest_debtors(account)
    assert len(debtors) == 1
    assert _debtor_problems(debtors[0], 1) == []

    specialist = make_user("pir_spec", User.Role.SPECIALIST, account.organization)
    messages = _gate_messages(account, specialist)
    assert "группой задолженности 2" not in " ".join(messages)
    assert AIS_WRIT_WARNING in messages
