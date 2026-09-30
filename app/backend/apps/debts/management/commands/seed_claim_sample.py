"""Выборка дел взыскания по уже загруженным лицевым счетам, чтобы канбан и список не были пустыми.

Повторный запуск не трогает дела, которые открыли вручную. Помечает свои карточки причиной «выборка для показа».
"""

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.debts.models import Account, ClaimAct, ClaimCase
from apps.nsi.models import PrintForm, PrintFormRevision
from apps.nsi.services.scenarios import STANDARD_STEPS, ensure_standard_scenario

MARK = "выборка для показа"
PLAN = (
    ("prep", False, 0),
    ("notary", True, 0),
    ("writ_done", True, 0),
    ("lawsuit", True, 0),
    ("court", True, 0),
    ("opi", True, 1),
    ("opi_measures", True, 1),
    ("impossible", True, 3),
)


class Command(BaseCommand):
    help = "Раскладывает до 8 дел взыскания по свободным лицевым счетам и центральный сценарий."

    def handle(self, *args, **options):
        ensure_standard_scenario()
        self._print_form()
        accounts = list(Account.objects.filter(claim_case__isnull=True).order_by("id")[: len(PLAN)])
        if not accounts:
            self.stdout.write("Свободных лицевых счетов нет: дела уже открыты. Новые карточки не созданы.")
            return
        for account, (stage, ready, acts) in zip(accounts, PLAN, strict=False):
            case = ClaimCase.objects.create(
                organization=account.organization,
                account=account,
                stage=stage,
                defendant_name=account.short_fio,
                skip_reason=MARK,
                warning_delivered_on=date(2026, 3, 1) if ready else None,
                notary_tariff=Decimal("48.00") if ready else None,
                submission_id=f"stub-{account.pk}" if stage != "prep" else "",
                submission_mode="stub" if stage != "prep" else "",
                lawsuit_kind=ClaimCase.LawsuitKind.COLLECTION if stage in {"lawsuit", "court"} else "",
                lawsuit_number=f"ИС-{account.client_account}" if stage in {"lawsuit", "court"} else "",
                court_status=ClaimCase.CourtStatus.PENDING if stage == "court" else "",
                opi_number=f"ОПИ-{account.pk}" if stage in {"opi", "opi_measures", "impossible"} else "",
                opi_status="меры приняты" if stage == "opi_measures" else ("возбуждено" if stage == "opi" else ""),
                opi_mode="manual" if acts or stage in {"opi", "opi_measures"} else "",
            )
            for index in range(acts):
                ClaimAct.objects.create(
                    organization=account.organization, case=case, title=f"Акт ОПИ №{index + 1}",
                )
            self.stdout.write(f"{account.client_account}: {case.get_stage_display()}")
        self.stdout.write(self.style.SUCCESS(f"Готово дел: {len(accounts)}. Сценарий: Стандартное взыскание, шагов {len(STANDARD_STEPS)}."))

    def _print_form(self):
        body = "Уважаемый {fio}, по счёту {account} долг {amount}, пеня учтена в АИС. Адрес: {address}. Услуги: {services}. Срок {due_days} дн. {organization}."
        form = PrintForm.objects.filter(organization=None, code="warning-demo").first()
        if form is None:
            form = PrintForm.objects.create(
                organization=None, code="warning-demo", name="Предупреждение для показа",
                doc_kind="warning", body=body, version=1,
            )
        if not form.revisions.filter(version=form.version).exists():
            PrintFormRevision.objects.create(form=form, version=form.version, body=form.body)
