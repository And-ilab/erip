"""Открытая работа уходит другому сотруднику той же схемы, когда учётную запись блокируют."""

from django.db.models import Case, IntegerField, Value, When

from apps.debts.models import Account, Measure, MeasureTask
from apps.users.models import User

OPEN_MEASURE = (Measure.Status.ASSIGNED, Measure.Status.RUNNING, Measure.Status.PAUSED)


def reassign_work(user: User) -> None:
    """Закреплённые счета, незакрытые мероприятия и открытые задания."""
    if user.is_active:
        return
    replacement = _replacement(user)
    Account.objects.filter(assigned_to=user).update(assigned_to=replacement)
    Measure.objects.filter(assignee=user, status__in=OPEN_MEASURE).update(assignee=replacement)
    MeasureTask.objects.filter(assignee=user, status=MeasureTask.Status.OPEN).update(assignee=replacement)


def _replacement(user: User) -> User | None:
    if user.organization_id is None:
        return None
    base = User.objects.filter(organization_id=user.organization_id, is_active=True).exclude(pk=user.pk)
    same_contour = base.filter(
        contour=user.contour, role__in=(User.Role.LOCAL_ADMIN, User.Role.SPECIALIST),
    )
    picked = _first(same_contour)
    if picked:
        return picked
    if user.contour == User.Contour.SUPPLIER:
        return _first(base.filter(role=User.Role.LOCAL_ADMIN))
    return _first(base.filter(contour=User.Contour.BILLING, role__in=(User.Role.LOCAL_ADMIN, User.Role.SPECIALIST)))


def _first(qs):
    return qs.annotate(
        rank=Case(
            When(role=User.Role.LOCAL_ADMIN, then=Value(0)),
            When(role=User.Role.SPECIALIST, then=Value(1)),
            default=Value(2),
            output_field=IntegerField(),
        ),
    ).order_by("rank", "id").first()
