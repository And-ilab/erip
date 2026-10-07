from django.core.management import call_command

from apps.debts.models import Account, Measure
from apps.users.models import User


def test_yurkevich_keeps_water_and_power_apart(db):
    call_command("seed_demo_contours")
    call_command("seed_demo_contours")

    account = Account.objects.get(schema_name="demo_minsk", client_account="91000006")
    assert account.short_fio == "Юркевич Н.А."
    assert Account.objects.filter(client_account="91000006").count() == 1
    water = account.services.get(service_name="Вода")
    power = account.services.get(service_name="Электричество")
    assert water.debt_group == 1
    assert water.debt_period == 1
    assert water.scenario_name == "Превентивный обзвон и уведомления"
    assert power.debt_group == 6
    assert power.debt_period == 60
    assert power.scenario_name == "Взыскание, безнадёжная задолженность"
    services = list(
        Measure.objects.filter(accounts=account, kind=Measure.Kind.COLLECTION).values_list(
            "services__service_name", flat=True,
        )
    )
    assert services == ["Электричество"]

    fanipol = Account.objects.get(schema_name="demo_fanipol", client_account="92000006")
    assert fanipol.services.get(service_name="Вода").debt_group == 1
    assert fanipol.services.get(service_name="Электричество").debt_group == 6

    water_user = User.objects.get(username="demo_water_minsk")
    assert water_user.check_password("Passw0rd!x")
    assert list(water_user.service_organizations.values_list("short_name", flat=True)) == ["Водоканал"]
    power_user = User.objects.get(username="demo_power_minsk")
    assert list(power_user.service_organizations.values_list("short_name", flat=True)) == ["Электросети"]
