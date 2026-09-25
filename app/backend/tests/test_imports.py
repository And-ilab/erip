"""Критерий приёмки 1: импорт тестовых CSV по спецификациям «Примеры данных», повторный импорт без дублей."""

import csv
import io
from pathlib import Path

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.debts.models import Account, AccountService, Payment, Registration
from apps.imports.field_maps import ENTITY_MAPS
from apps.imports.models import ImportJob
from apps.imports.parsing import bind_columns, convert, decode
from apps.imports.samples import SampleGenerator, read_spec
from apps.imports.services import AisImporter
from apps.users.models import ServiceOrganization

SPEC_DIR = Path(settings.AIS_SPEC_DIR)
needs_spec = pytest.mark.skipif(not SPEC_DIR.is_dir(), reason="Нет каталога «Примеры данных»")
ORDER = ("account", "service", "payment", "registration")


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


def generate(tmp_path, schema="schema_a", accounts=12):
    return SampleGenerator(SPEC_DIR, schema, accounts).write_all(tmp_path)


def run_all(files, org):
    return {entity: AisImporter(entity, org).run(files[entity].read_bytes(), files[entity].name) for entity in ORDER}


@needs_spec
@pytest.mark.django_db
def test_import_all_entities_and_reimport_is_idempotent(tmp_path, org_a):
    files = generate(tmp_path)
    jobs = run_all(files, org_a)
    for entity, job in jobs.items():
        assert job.status == ImportJob.Status.DONE, (entity, job.errors[:3])
        assert job.rejected == 0
        assert job.encoding == "cp1251"
    assert Account.objects.count() == 12
    assert AccountService.objects.count() == 24
    assert Payment.objects.count() == 12
    assert Registration.objects.count() == 24

    account = Account.objects.get(account_id=100000)
    assert account.client_account == "00000001"  # ведущие нули сохранены
    assert account.raw["ACCOUNT_ID#2"] in {"0", "1"}  # дубль колонки в raw
    assert ServiceOrganization.objects.filter(organization=org_a, is_supplier=False).count() == 2
    assert ServiceOrganization.objects.filter(organization=org_a, provider_id=900, is_supplier=True).exists()
    payment = Payment.objects.first()
    assert payment.payment_type == Payment.PaymentType.FILE

    # Группы: у ЛС i услуга с долгом DEBT_MONTHS[i % 6] мес. → группы 1..6
    groups = sorted(set(Account.objects.values_list("debt_group", flat=True)))
    assert groups == [1, 2, 3, 4, 5, 6]

    again = run_all(files, org_a)
    for job in again.values():
        assert job.created == 0 and job.updated == 0 and job.unchanged == job.total
    assert Account.objects.count() == 12
    assert AccountService.objects.count() == 24


@needs_spec
@pytest.mark.django_db
def test_rows_of_foreign_schema_rejected(tmp_path, org_a):
    files = generate(tmp_path, schema="other_schema", accounts=2)
    job = AisImporter("account", org_a).run(files["account"].read_bytes(), "a.csv")
    assert job.rejected == 2
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
    assert convert("1 234,50", "dec") == __import__("decimal").Decimal("1234.50")
    assert convert("01.02.2026", "date").isoformat() == "2026-02-01"
    assert convert("Зачисление из зарплаты", "payment_type") == "salary"
    assert convert("", "bool") is False
    assert decode("тест".encode("cp1251"))[1] == "cp1251"
    bindings, unknown = bind_columns(["ACCOUNT_ID", "ACCOUNT_ID", "EXTRA"], ENTITY_MAPS["account"])
    assert bindings[1].spec.field == "is_private_enterprise"
    assert unknown == ["EXTRA"]


@needs_spec
@pytest.mark.django_db
def test_import_api(api, admin_a, specialist_a, tmp_path):
    files = generate(tmp_path, accounts=3)
    upload = SimpleUploadedFile("account.csv", files["account"].read_bytes(), content_type="text/csv")
    assert api(specialist_a).post("/api/v1/imports/", {"entity": "account", "file": upload}).status_code == 403
    upload.seek(0)
    response = api(admin_a).post("/api/v1/imports/", {"entity": "account", "file": upload})
    assert response.status_code == 201, response.json()
    assert response.json()["created"] == 3
    assert api(admin_a).get("/api/v1/imports/").json()["count"] == 1


@needs_spec
def test_generated_csv_has_spec_headers(tmp_path):
    text = SampleGenerator(SPEC_DIR, accounts=1).generate("payment")
    header = next(csv.reader(io.StringIO(text), delimiter=";"))
    assert "PAYMENT_TYPE" in header and header.count("CLIENT_ACCOUNT") == 2


@needs_spec
@pytest.mark.django_db
def test_management_commands(tmp_path, capsys):
    from django.core.management import call_command

    call_command("generate_ais_samples", str(tmp_path), "--accounts", "2", "--schema", "cmd_schema")
    call_command("import_ais", "account", str(tmp_path / "account.csv"), "--schema", "cmd_schema", "--create-org")
    assert "создано 2" in capsys.readouterr().out
