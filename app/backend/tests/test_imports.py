"""Импорт CSV и Excel: спецификации «Примеры данных» и обезличенная выборка fixtures/ais_sample."""

from decimal import Decimal
from pathlib import Path

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook

from apps.debts.models import Account, AccountService, Measure, Payment, Registration
from apps.imports.field_maps import ENTITY_MAPS
from apps.imports.models import ImportJob
from apps.imports.parsing import bind_columns, convert, decode
from apps.imports.sample_catalog import sample_files
from apps.imports.samples import read_spec
from apps.imports.services import AisImporter
from apps.users.models import Organization

SPEC_DIR = Path(settings.AIS_SPEC_DIR)
SAMPLE_DIR = Path(settings.AIS_SAMPLE_DIR)
needs_spec = pytest.mark.skipif(not SPEC_DIR.is_dir(), reason="Нет каталога «Примеры данных»")
needs_sample = pytest.mark.skipif(not sample_files(SAMPLE_DIR), reason="Нет каталога fixtures/ais_sample")


def file_of(schema: str, entity: str) -> Path:
    return next(path for code, kind, path in sample_files(SAMPLE_DIR) if code == schema and kind == entity)


@needs_spec
@pytest.mark.parametrize("entity", list(ENTITY_MAPS))
def test_field_map_matches_spec(entity):
    """Каждая колонка карты есть в спецификации; дубли разведены по COMMENTS в том же порядке."""
    entity_map = ENTITY_MAPS[entity]
    spec = read_spec(SPEC_DIR / entity_map.spec_file)
    occurrences: dict[str, list[str]] = {}
    for column in spec:
        occurrences.setdefault(column.column, []).append(column.comment)
    by_column: dict[str, list] = {}
    for field_spec in entity_map.specs:
        by_column.setdefault(field_spec.column, []).append(field_spec)
    for column, specs in by_column.items():
        assert column in occurrences, f"{entity}: колонки {column!r} нет в спецификации"
        comments = occurrences[column]
        assert len(specs) <= len(comments)
        if len(comments) > 1:
            for field_spec, comment in zip(specs, comments, strict=False):
                assert field_spec.comment and field_spec.comment.lower() in comment.lower(), (column, comment)


@needs_sample
@pytest.mark.django_db
def test_sample_import_and_reimport_is_idempotent():
    from django.core.management import call_command

    call_command("load_ais_sample")
    assert Account.objects.count() == 160
    assert AccountService.objects.count() == 2974
    assert Payment.objects.count() == 69
    assert Registration.objects.count() == 792
    assert set(Organization.objects.values_list("schema_name", flat=True)) >= {"BR2000", "GR5000", "MG6000", "MN7000"}
    brest = Organization.objects.get(schema_name="BR2000")
    assert "ЖРЭУ" in brest.name

    account = Account.objects.get(organization__schema_name="BR2000", account_id=367826)
    assert account.client_account == "50498"
    assert account.unified_account is None
    assert "E+" in account.raw["Уникальный единый номер ЛС (УЕН ЛС)"].upper()
    assert account.house_address == "ул. Гоголя, д.32"

    payment = Payment.objects.get(receipt_id=17207356)
    assert payment.client_account == "06551633"
    assert payment.payment_type == Payment.PaymentType.FILE
    service = AccountService.objects.get(service_list_id=2210598)
    assert service.service_name == "Плата за пользование арендным жильем (пониж.коэфф.)"
    assert Account.objects.filter(schema_name="GR5000", phone__icontains="E+").exists()
    assert Account.objects.filter(schema_name="MN7000", debt_group__gt=1).exists()
    grodno_groups = set(Account.objects.filter(schema_name="GR5000").values_list("debt_group", flat=True))
    assert grodno_groups <= {None, 1}

    call_command("load_ais_sample")
    assert Account.objects.count() == 160
    assert AccountService.objects.count() == 2974
    again = ImportJob.objects.order_by("-id")[:16]
    assert all(job.created == 0 and job.updated == 0 and job.rejected == 0 for job in again)


@needs_sample
@pytest.mark.django_db
def test_rows_of_foreign_schema_rejected(org_a):
    path = file_of("BR2000", "account")
    job = AisImporter("account", org_a).run(path.read_bytes(), path.name)
    assert job.rejected == 20
    assert job.created == 0
    assert Account.objects.count() == 0


@pytest.mark.django_db
def test_child_without_account_rejected(org_a):
    content = b"ACCOUNT_ID;SERVICE_LIST_ID;BALANCE_OUT\n999;1;10,00\n"
    job = AisImporter("service", org_a).run(content, "s.csv")
    assert job.status == ImportJob.Status.DONE_WITH_ERRORS
    assert "не найден" in job.errors[0]["reason"]


@pytest.mark.django_db
def test_missing_key_column_fails(org_a):
    job = AisImporter("account", org_a).run(b"CLIENT_ACCOUNT\n001\n", "a.csv")
    assert job.status == ImportJob.Status.FAILED


@pytest.mark.django_db
def test_bad_value_rejects_row(org_a):
    content = b"ACCOUNT_ID;PROVIDER_ID;CLIENT_ACCOUNT;BALANCE_OUT\n1;2;0001;abc\n2;2;0002;5,5\n"
    job = AisImporter("account", org_a).run(content, "a.csv")
    assert job.created == 1 and job.rejected == 1
    assert job.encoding == "utf-8-sig"


def test_parsing_helpers():
    assert convert("1 234,50", "dec") == Decimal("1234.50")
    assert convert("01.02.2026", "date").isoformat() == "2026-02-01"
    assert convert("Зачисление из зарплаты", "payment_type") == "salary"
    assert convert("", "bool") is False
    assert convert("1,2E+11", "int") is None
    assert decode("тест".encode("cp1251"))[1] == "cp1251"
    bindings, unknown = bind_columns(["ACCOUNT_ID", "ACCOUNT_ID", "EXTRA"], ENTITY_MAPS["account"])
    assert bindings[1].spec.field == "is_private_enterprise"
    assert unknown == ["EXTRA"]
    russian, unknown_ru = bind_columns(["Код ЛС", "Код схемы", "Код схемы"], ENTITY_MAPS["account"])
    assert russian[0].spec.field == "account_id"
    assert russian[1].spec.field == "schema_name"
    assert russian[2].spec is None
    assert unknown_ru == ["Код схемы#2"]


@needs_sample
@pytest.mark.django_db
def test_import_api(api, admin_a, specialist_a):
    payload = file_of("BR2000", "account").read_bytes()
    upload = SimpleUploadedFile("account.csv", payload, content_type="text/csv")
    assert api(specialist_a).post("/api/v1/imports/", {"entity": "account", "file": upload}).status_code == 403
    upload.seek(0)
    upload = SimpleUploadedFile("account.csv", payload, content_type="text/csv")
    response = api(admin_a).post("/api/v1/imports/", {"entity": "account", "file": upload})
    assert response.status_code == 201, response.json()
    assert response.json()["rejected"] == 20
    assert response.json()["created"] == 0


@pytest.mark.django_db
def test_excel_import(api, admin_a, org_a, tmp_path):
    book = Workbook()
    sheet = book.active
    sheet.append([
        "Код схемы", "Код ЛС", "Код обслуживающей организации",
        "Лицевой счёт (Номер ЛС)", "Исходящее сальдо", "Наличие ЧУП (0 – нет, 1 – есть) (ЧУП)",
    ])
    sheet.append(["schema_a", 1001, 501, "00001001", 10.5, 0])
    path = tmp_path / "accounts.xlsx"
    book.save(path)
    job = AisImporter("account", org_a).run_path(path)
    assert job.status == ImportJob.Status.DONE, job.errors[:3]
    assert job.encoding == "xlsx"
    assert job.created == 1
    account = Account.objects.get(account_id=1001)
    assert account.client_account == "00001001"
    assert account.balance_out == Decimal("10.5")
    assert account.is_private_enterprise is False

    upload = SimpleUploadedFile(
        "accounts.xlsx", path.read_bytes(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response = api(admin_a).post("/api/v1/imports/", {"entity": "account", "file": upload})
    assert response.status_code == 201, response.json()
    assert response.json()["unchanged"] == 1
    rejected = SimpleUploadedFile("notes.docx", b"PK\x03\x04", content_type="application/octet-stream")
    assert api(admin_a).post("/api/v1/imports/", {"entity": "account", "file": rejected}).status_code == 400


@pytest.mark.django_db
def test_reimport_updates_changed_fields_and_shows_measure(org_a):
    account_csv = "ACCOUNT_ID;PROVIDER_ID;CLIENT_ACCOUNT;BALANCE_OUT;SHORT_FIO\n10;501;00000010;100,00;Иванов\n"
    created = AisImporter("account", org_a).run(account_csv.encode(), "a.csv")
    assert created.created == 1
    service_csv = "ACCOUNT_ID;SERVICE_LIST_ID;SERVICE_ID;BALANCE_OUT;DEBT_PERIOD;SERVICE_NAME\n10;77;5;100,00;4;Отопление\n"
    services = AisImporter("service", org_a).run(service_csv.encode(), "s.csv")
    assert services.created == 1
    account = Account.objects.get(account_id=10)
    assert account.debt_group == 3
    measure = Measure.objects.get(accounts=account)
    assert measure.status == Measure.Status.FAILED
    assert "375" in measure.note

    changed = "ACCOUNT_ID;PROVIDER_ID;CLIENT_ACCOUNT;BALANCE_OUT;SHORT_FIO\n10;501;00000010;80,00;Петров\n"
    again = AisImporter("account", org_a).run(changed.encode(), "a2.csv")
    assert again.updated == 1
    account.refresh_from_db()
    assert account.balance_out == Decimal("80.00")
    assert account.short_fio == "Петров"
    assert Measure.objects.filter(accounts=account).count() == 1


@needs_sample
@pytest.mark.django_db
def test_management_command_reports_created(capsys):
    from django.core.management import call_command

    call_command("import_ais", "account", str(file_of("BR2000", "account")), "--schema", "BR2000", "--create-org")
    assert "создано 20" in capsys.readouterr().out


@pytest.mark.django_db
def test_reload_ais_sample_replaces_only_sample_schemas(org_a, tmp_path):
    from django.core.management import call_command

    from .conftest import make_account

    kept = make_account(org_a, 1, client_account="00000001")
    sample_org = Organization.objects.create(schema_name="BR2000", name="старое имя")
    old = make_account(sample_org, 9, client_account="00000009")
    Measure.objects.create(organization=sample_org, kind=Measure.Kind.CALL, status=Measure.Status.ASSIGNED, template_name="старое")
    path = tmp_path / "Карточка ЛС BR2000.csv"
    path.write_bytes(
        "ACCOUNT_ID;PROVIDER_ID;CLIENT_ACCOUNT;SCHEMA_NAME;SHORT_FIO;Наименование схемы\n"
        "10;501;00000010;BR2000;Новый;Брест\n".encode("cp1251"),
    )
    call_command("reload_ais_sample", dir=str(tmp_path))
    assert Account.objects.filter(pk=kept.pk).exists()
    assert not Account.objects.filter(pk=old.pk).exists()
    assert not Measure.objects.filter(template_name="старое").exists()
    fresh = Account.objects.get(organization__schema_name="BR2000", account_id=10)
    assert fresh.short_fio == "Новый"
    assert fresh.organization.name == "Брест"
