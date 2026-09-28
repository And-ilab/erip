"""Временный вход по роли без пароля. Включён только при DEBUG. Удалить вместе с кнопками на экране входа."""

from django.db.models import Count

from apps.users.models import Organization, ServiceOrganization, User

STUB_ROLES = (
    ("superadmin", "Суперадминистратор", User.Role.SUPERADMIN, User.Contour.BILLING),
    ("local_admin", "Локальный администратор", User.Role.LOCAL_ADMIN, User.Contour.BILLING),
    ("specialist", "Специалист", User.Role.SPECIALIST, User.Contour.BILLING),
    ("observer", "Наблюдатель", User.Role.OBSERVER, User.Contour.BILLING),
    ("supplier", "Поставщик услуг", User.Role.SPECIALIST, User.Contour.SUPPLIER),
)


def stub_role_choices() -> list[dict]:
    return [{"id": code, "label": label} for code, label, _role, _contour in STUB_ROLES]


def issue_stub_user(code: str) -> User:
    spec = next((item for item in STUB_ROLES if item[0] == code), None)
    if spec is None:
        raise KeyError(code)
    _code, label, role, contour = spec
    username = f"stub-{code.replace('_', '-')}"
    user, _created = User.objects.get_or_create(username=username, defaults={"role": role, "contour": contour})
    user.role = role
    user.contour = contour
    user.is_active = True
    user.is_staff = False
    user.is_superuser = False
    user.first_name = label
    user.last_name = ""
    user.middle_name = ""
    user.set_unusable_password()
    if role == User.Role.SUPERADMIN:
        user.organization = None
        user.save()
        user.service_organizations.clear()
        return user
    organization = _schema_with_data()
    user.organization = organization
    user.save()
    if contour == User.Contour.SUPPLIER:
        suppliers = ServiceOrganization.objects.filter(organization=organization, is_active=True, is_supplier=True)
        bound = suppliers if suppliers.exists() else ServiceOrganization.objects.filter(
            organization=organization, is_active=True,
        )
        user.service_organizations.set(bound)
    else:
        user.service_organizations.clear()
    return user


def _schema_with_data() -> Organization:
    from apps.debts.models import Account

    busiest = (
        Account.objects.values("organization")
        .annotate(n=Count("id"))
        .order_by("-n")
        .first()
    )
    if busiest:
        return Organization.objects.get(pk=busiest["organization"])
    existing = Organization.objects.filter(is_active=True).order_by("id").first()
    if existing:
        return existing
    return Organization.objects.create(schema_name="stub", name="Тестовая схема")
