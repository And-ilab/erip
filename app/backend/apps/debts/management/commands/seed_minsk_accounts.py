"""Двадцать демонстрационных лицевых счетов по разным адресам Минска.

Повтор не создаёт вторую карточку: счёт ищется по организации, поставщику и коду ЛС.
После записи адреса раскладываются в дерево карты.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from apps.debts.models import Account
from apps.debts.services.portfolio import rating_letter
from apps.debts.services.territory import KNOWN_POINTS, TerritoryIndex

# Как у уже загруженных пяти: одна схема, поставщик 501, этап «новый», сальдо порядка десятка.
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
    help = "Добавить 20 лицевых счетов по разным адресам Минска и разложить их по карте"

    def handle(self, *args, **options):
        sample = Account.objects.order_by("id").first()
        if sample is None:
            raise CommandError("В базе нет лицевых счетов: неясно, в какую схему класть новые")
        created = 0
        for offset, person in enumerate(PEOPLE, start=6):
            fio, address, flat, group, balance, subj = person
            _, was_created = Account.objects.get_or_create(
                organization=sample.organization,
                provider_id=sample.provider_id,
                account_id=offset,
                defaults={
                    "client_account": f"{offset:08d}",
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
        rated = self._fill_ratings(sample.organization_id, sample.provider_id)
        linked = TerritoryIndex().assign_queryset(
            Account.objects.filter(organization=sample.organization, account_id__gte=6, account_id__lte=25)
        )
        self.stdout.write(f"Новых лицевых счетов: {created}. Привязок обновлено: {linked}. Рейтингов проставлено: {rated}")
        self._report()

    @staticmethod
    def _fill_ratings(organization_id, provider_id) -> int:
        """Буква по группе, если расчёт портфеля её ещё не записал."""
        updated = 0
        pending = Account.objects.filter(
            organization_id=organization_id, provider_id=provider_id, account_id__lte=25, rating="",
        )
        for account in pending:
            letter = rating_letter(account.debt_group, False)
            if not letter:
                continue
            account.rating = letter
            account.save(update_fields=["rating", "updated_at"])
            updated += 1
        return updated

    def _report(self):
        for account in Account.objects.filter(account_id__gte=6, account_id__lte=25).select_related("territory"):
            house = account.territory
            street = house.parent if house else None
            known = KNOWN_POINTS.get(("street", street.name_key)) if street else None
            if house is None or street is None or known is None:
                self.stdout.write(f"{account.client_account} без привязки к известной улице: {account.house_address}")
                continue
            shift_m = _meters(float(house.latitude), float(house.longitude), known[0], known[1])
            self.stdout.write(
                f"{account.client_account} {street.name} {house.name}: "
                f"улица {known[0]:.4f},{known[1]:.4f}; дом сдвинут на {shift_m:.0f} м"
            )


def _meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return ((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2) ** 0.5 * 111_000
