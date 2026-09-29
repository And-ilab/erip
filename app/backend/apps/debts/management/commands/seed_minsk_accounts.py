"""Двадцать тестовых лицевых счетов по разным адресам Минска.

Коды 90000001–90000020. Повтор не создаёт вторую карточку и не меняет остальные счета.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from apps.debts.models import Account
from apps.debts.services.portfolio import rating_letter
from apps.debts.services.territory import KNOWN_POINTS, TerritoryIndex

BASE = 90_000_001

PEOPLE = (
    ("Ковалёв А.С.", "г. Минск, Центральный район, ул. Немига, д. 5, кв. 12", "12", 1, "18.40", 2),
    ("Левчук М.И.", "г. Минск, Центральный район, ул. Комсомольская, д. 13, кв. 4", "4", 2, "22.10", 1),
    ("Гриневич О.П.", "г. Минск, Центральный район, пр-т Независимости, д. 19, кв. 8", "8", 3, "41.00", 3),
    ("Савич Т.В.", "г. Минск, Советский район, ул. Якуба Коласа, д. 37, кв. 21", "21", 4, "16.80", 2),
    ("Романовский И.Д.", "г. Минск, Советский район, ул. Сурганова, д. 29, кв. 6", "6", 5, "33.50", 4),
    ("Юркевич Н.А.", "г. Минск, Советский район, ул. Богдановича, д. 80, кв. 15", "15", 6, "27.90", 2),
    ("Пашкевич Е.Л.", "г. Минск, Первомайский район, ул. Калиновского, д. 68, кв. 3", "3", 1, "11.20", 1),
    ("Бондарь С.Г.", "г. Минск, Первомайский район, ул. Волгоградская, д. 12, кв. 40", "40", 2, "19.60", 3),
    ("Мельник Д.О.", "г. Минск, Партизанский район, ул. Ваупшасова, д. 20, кв. 9", "9", 3, "24.30", 2),
    ("Крук В.Н.", "г. Минск, Партизанский район, ул. Плеханова, д. 44, кв. 17", "17", 4, "14.70", 1),
    ("Остапенко Л.С.", "г. Минск, Заводской район, ул. Ангарская, д. 7, кв. 2", "2", 5, "38.00", 2),
    ("Шевцов П.А.", "г. Минск, Заводской район, ул. Кабушкина, д. 58, кв. 11", "11", 6, "21.40", 3),
    ("Гончар И.В.", "г. Минск, Ленинский район, ул. Маяковского, д. 11, кв. 5", "5", 1, "12.80", 2),
    ("Лапицкая А.Е.", "г. Минск, Ленинский район, ул. Ульяновская, д. 31, кв. 28", "28", 2, "17.50", 1),
    ("Воробей К.М.", "г. Минск, Октябрьский район, ул. Кижеватова, д. 7, кв. 1", "1", 3, "29.10", 2),
    ("Семёнова Р.И.", "г. Минск, Октябрьский район, ул. Аранская, д. 14, кв. 19", "19", 4, "15.00", 4),
    ("Ткачук Б.С.", "г. Минск, Московский район, ул. Притыцкого, д. 62, кв. 33", "33", 5, "26.40", 2),
    ("Ильина Ж.П.", "г. Минск, Московский район, мкр. Грушевка, ул. Кольцова, д. 4, кв. 7", "7", 6, "13.30", 1),
    ("Макаревич Г.А.", "г. Минск, Фрунзенский район, пр-т Пушкина, д. 28, кв. 10", "10", 1, "20.00", 3),
    ("Демидович Ф.Л.", "г. Минск, Фрунзенский район, ул. Бурдейного, д. 15, кв. 6", "6", 2, "18.90", 2),
)


class Command(BaseCommand):
    help = "Добавить 20 тестовых лицевых счетов по Минску (коды 90000001–90000020) и разложить их по карте"

    def handle(self, *args, **options):
        sample = Account.objects.order_by("id").first()
        if sample is None:
            raise CommandError("В базе нет лицевых счетов: неясно, в какую схему класть новые")
        ids = []
        created = 0
        for index, person in enumerate(PEOPLE):
            account_id = BASE + index
            ids.append(account_id)
            fio, address, flat, group, balance, subj = person
            _, was_created = Account.objects.get_or_create(
                organization=sample.organization,
                provider_id=sample.provider_id,
                account_id=account_id,
                defaults={
                    "client_account": f"{account_id:08d}",
                    "schema_name": sample.schema_name,
                    "provider_short_name": sample.provider_short_name,
                    "short_fio": fio,
                    "house_address": address,
                    "account_address": address,
                    "flat_number": flat,
                    "debt_group": group,
                    "balance_out": Decimal(balance),
                    "subj_count": subj,
                    "funnel_stage": "new",
                    "months_debt": group,
                    "rating": rating_letter(group, False),
                },
            )
            created += int(was_created)
        demo = Account.objects.filter(
            organization=sample.organization, provider_id=sample.provider_id, account_id__in=ids,
        )
        rated = 0
        for account in demo.filter(rating=""):
            account.rating = rating_letter(account.debt_group, False)
            account.save(update_fields=["rating", "updated_at"])
            rated += 1
        linked = TerritoryIndex().assign_queryset(demo)
        self.stdout.write(f"Новых лицевых счетов: {created}. Привязок обновлено: {linked}. Рейтингов проставлено: {rated}")
        for account in demo.select_related("territory"):
            house = account.territory
            street = house.parent if house else None
            known = KNOWN_POINTS.get(("street", street.name_key)) if street else None
            if house is None or street is None or known is None:
                self.stdout.write(f"{account.client_account} без привязки к известной улице: {account.house_address}")
                continue
            shift_m = ((float(house.latitude) - known[0]) ** 2 + (float(house.longitude) - known[1]) ** 2) ** 0.5 * 111_000
            self.stdout.write(
                f"{account.client_account} {street.name} {house.name}: "
                f"улица {known[0]:.4f},{known[1]:.4f}; дом сдвинут на {shift_m:.0f} м"
            )
