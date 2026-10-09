"""Две учётные записи для проверки ролей. Пароль постоянный, роль выбирается после входа."""

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired

from apps.users.models import User
from apps.users.role_stub import bind_role, stub_role_choices

TESTER_USERNAMES = (
    "a.poleshchuk@raschet.by",
    "a.galdytskaya@raschet.by",
)
PASSWORD = "Raschet-Test-2026"
TICKET_SALT = "erip-role-tester"
TICKET_MAX_AGE = 600


def is_role_tester(username: str) -> bool:
    return (username or "").strip().lower() in TESTER_USERNAMES


def ensure_role_testers() -> int:
    """Создаёт обе записи и каждый раз возвращает известный пароль."""
    created = 0
    for username in TESTER_USERNAMES:
        user = User.objects.filter(username__iexact=username).first()
        if user is None:
            user = User(username=username, email=username, role=User.Role.SPECIALIST, contour=User.Contour.BILLING)
            created += 1
        user.username = username
        user.email = username
        user.is_active = True
        user.is_staff = False
        user.is_superuser = False
        user.set_password(PASSWORD)
        user.save()
    return created


def issue_ticket(user: User) -> str:
    return signing.dumps(user.pk, salt=TICKET_SALT)


def role_choices() -> list[dict]:
    return stub_role_choices()


def user_from_ticket(ticket: str) -> User:
    try:
        pk = signing.loads(ticket, salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
    except SignatureExpired as exc:
        raise ValueError("expired") from exc
    except BadSignature as exc:
        raise ValueError("bad") from exc
    user = User.objects.filter(pk=pk, is_active=True).first()
    if user is None or not is_role_tester(user.username):
        raise ValueError("bad")
    return user


def apply_tester_role(user: User, code: str) -> User:
    if not is_role_tester(user.username):
        raise ValueError("bad")
    return bind_role(user, code)
