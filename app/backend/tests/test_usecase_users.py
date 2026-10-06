from django.core.management import call_command

from apps.users.models import Organization, ServiceOrganization, User


def test_usecase_users_cover_each_schema_and_stay_idempotent(db):
    brest = Organization.objects.create(schema_name="BR2000", name="Брест ЖРЭУ")
    grodno = Organization.objects.create(schema_name="GR5000", name="Гродно ЕИРКЦ")
    Organization.objects.create(schema_name="gone", name="Закрытая", is_active=False)
    water = ServiceOrganization.objects.create(
        organization=brest, provider_id=11, short_name="Водоканал", is_supplier=True,
    )
    ServiceOrganization.objects.create(
        organization=brest, provider_id=12, short_name="ЖЭС", is_supplier=False,
    )

    call_command("seed_usecase_users")
    spec = User.objects.get(username="uc_br2000_spec")
    spec.set_password("other-secret")
    spec.save()
    call_command("seed_usecase_users")

    assert User.objects.filter(username="uc_br2000_spec").count() == 1
    spec.refresh_from_db()
    assert spec.check_password("other-secret")
    assert spec.role == User.Role.SPECIALIST
    assert spec.contour == User.Contour.BILLING
    assert spec.organization_id == brest.id
    assert list(spec.service_organizations.all()) == []

    admin = User.objects.get(username="uc_br2000_admin")
    assert admin.role == User.Role.LOCAL_ADMIN
    assert admin.check_password("Passw0rd!x")
    view = User.objects.get(username="uc_gr5000_view")
    assert view.role == User.Role.OBSERVER
    assert view.organization_id == grodno.id

    supplier = User.objects.get(username="uc_br2000_p11")
    assert supplier.contour == User.Contour.SUPPLIER
    assert list(supplier.service_organizations.all()) == [water]
    assert not User.objects.filter(username="uc_br2000_p12").exists()
    assert not User.objects.filter(username="uc_gone_spec").exists()

    root = User.objects.get(username="uc_super")
    assert root.role == User.Role.SUPERADMIN
    assert root.organization_id is None
