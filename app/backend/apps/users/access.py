"""Кто может пропустить мероприятие или этап. Подпись документов здесь не решается."""

from apps.users.models import User


def can_skip_stage(user) -> bool:
    """Администратор схемы, суперадминистратор и специалист с признаком «согласует»."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    role = getattr(user, "role", "")
    if role in {User.Role.SUPERADMIN, User.Role.LOCAL_ADMIN} or getattr(user, "is_superadmin", False):
        return True
    return role == User.Role.SPECIALIST and bool(getattr(user, "can_approve", False))
