"""Глава 4: приостановка мероприятия не принимает прошлую дату."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.debts.models import Measure
from apps.debts.services.extra_measures import ExtraMeasureError, hold_measure


@pytest.mark.django_db
def test_hold_rejects_past_date(admin_a, account_a):
    measure = Measure.objects.create(
        organization=account_a.organization,
        kind=Measure.Kind.WARNING,
        status=Measure.Status.ASSIGNED,
        template_name="Предупреждение",
        created_by=admin_a,
    )
    measure.accounts.add(account_a)
    yesterday = timezone.localdate() - timedelta(days=1)
    with pytest.raises(ExtraMeasureError) as err:
        hold_measure(measure, admin_a, yesterday.isoformat(), "тест")
    assert "раньше сегодняшней" in str(err.value.detail)


@pytest.mark.django_db
def test_hold_indefinite_keeps_null_until(admin_a, account_a):
    measure = Measure.objects.create(
        organization=account_a.organization,
        kind=Measure.Kind.WARNING,
        status=Measure.Status.ASSIGNED,
        template_name="Предупреждение",
        created_by=admin_a,
    )
    measure.accounts.add(account_a)
    hold_measure(measure, admin_a, "", "навсегда", indefinite=True)
    measure.refresh_from_db()
    assert measure.status == Measure.Status.PAUSED
    assert measure.pause_until is None
    assert measure.pause_reason == "навсегда"
