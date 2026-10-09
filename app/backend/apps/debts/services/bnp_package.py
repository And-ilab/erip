"""Пакет заявления в личный кабинет БНП.

Собирает манифест, PDF и слоты ЭЦП (.pdf.sgn / .pdf.p7s). В кабинет ничего не отправляет:
это делает заглушка send_to_notary, когда появится способ подачи. Правила полей те же,
что у BnpManifest в шлюзе (app/gateway/app/integrations/bnp/schemas.py).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.core.files.base import ContentFile
from django.utils import timezone

from apps.debts.models import (
    Account,
    ClaimCase,
    ClaimEvent,
    ClaimPackage,
    ClaimPackageDocument,
    WritCheck,
)
from apps.debts.services.artifacts import ensure_writ_checks, render_text_pdf
from apps.debts.services.claims import ClaimBlocked
from apps.nsi.models import BnpDebtType, BnpDocType, BnpService

MAX_FILE_BYTES = 15 * 1024 * 1024
HOUSING_SERVICES = {571, 572, 576}
REQUIRED_DOCS = ("application", "debt_calculation", "proxy")
OUTGOING_DOCS = (
    "application",
    "debt_calculation",
    "proxy",
    "agreement_contract",
    "other_document",
    "transfer_document",
    "acknowledgment_document",
    "payment_order",
)
SIGNER_OF = {"proxy": "head"}
SIGNER_LABEL = {
    "applicant": "ЭЦП представителя, создавшего кабинет",
    "head": "ЭЦП руководителя",
}
DEBTOR_FIELDS = (
    "personType", "personalId", "secondName", "firstName", "middleName",
    "unp", "regNumber", "regName",
)
PERSONAL_ID_RE = re.compile(r"^\d{7}[A-Z]\d{3}[A-Z]{2}\d$")
UNP_RE = re.compile(r"^\d{9}$")
AMOUNT_RE = re.compile(r"^\d+\.\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
PERSON_TYPES = {"natural", "legal", "sole_trader"}


def package_payload(case: ClaimCase) -> dict:
    catalog = _catalog()
    labels = catalog.pop("doc_labels")
    package = stored_package(case)
    if package is None:
        draft = _suggestion(case)
        draft.update({
            "persisted": False,
            "formed_at": None,
            "documents": [],
            "problems": [],
            "manifest": {},
            "send_blockers": ["Сначала сформируйте пакет для личного кабинета БНП"],
            **catalog,
        })
        return draft
    debts = [_with_live_amount(case.account, row) for row in package.debts]
    return {
        "persisted": True,
        "formed_at": package.formed_at.isoformat() if package.formed_at else None,
        "service_id": package.service_id,
        "contact_data": package.contact_data,
        "notification_email": package.notification_email,
        "user_message": package.user_message,
        "debtors": package.debtors,
        "debts": debts,
        "documents": [_document_payload(doc, labels) for doc in package.documents.all()],
        "problems": list(package.problems or []),
        "manifest": package.manifest if package.formed_at else {},
        "send_blockers": send_blockers(case, package),
        **catalog,
    }


def save_package(case: ClaimCase, data: dict) -> ClaimPackage:
    package = _ensure(case)
    service_id = data.get("service_id")
    try:
        package.service_id = int(service_id) if service_id else None
    except (TypeError, ValueError) as exc:
        raise ClaimBlocked("Услуга БНП задаётся числом") from exc
    package.contact_data = str(data.get("contact_data") or "")[:500]
    package.notification_email = str(data.get("notification_email") or "")[:250]
    package.user_message = str(data.get("user_message") or "")[:2000]
    package.debtors = _normalize_debtors(data.get("debtors"))
    package.debts = _normalize_debts(case.account, data.get("debts"))
    _invalidate(package)
    return package


def generate_application(case: ClaimCase) -> ClaimPackageDocument:
    package = _ensure(case)
    name = f"zayavlenie-{_safe_token(case.account.client_account)}.pdf"
    payload = render_text_pdf(_application_lines(case, package))
    if len(payload) > MAX_FILE_BYTES:
        raise ClaimBlocked("Заявление больше 15 МБ")
    document = package.documents.filter(doc_type="application").first()
    kind = "sgn" if document and document.signature_name.lower().endswith(".pdf.sgn") else "p7s"
    if document is None:
        document = ClaimPackageDocument(
            organization=case.organization, package=package, doc_type="application", file_name=name,
            signature_name=_signature_name(name, kind), signer="applicant", generated=True,
        )
    else:
        _drop_signature(document)
        document.file_name = name
        document.signature_name = _signature_name(name, kind)
        document.signer = "applicant"
        document.generated = True
        document.doc_type = "application"
    document.pdf.save(name, ContentFile(payload), save=False)
    document.save()
    _invalidate(package)
    return document


def store_document(
    case: ClaimCase, *, doc_type: str, pdf=None, signature=None, signature_kind: str = "p7s", doc_id=None,
) -> ClaimPackageDocument:
    package = _ensure(case)
    doc_type = (doc_type or "").strip()
    if doc_type not in OUTGOING_DOCS:
        raise ClaimBlocked("Этот тип документа в исходящий пакет не входит")
    if signature_kind not in {"p7s", "sgn"}:
        raise ClaimBlocked("Формат ЭЦП: p7s или sgn")
    document = _find_document(package, doc_type, doc_id)
    manifest_changed = False
    if pdf is not None:
        name = _pdf_name(getattr(pdf, "name", "") or f"{doc_type}.pdf")
        _reject_size(pdf)
        clash = package.documents.exclude(pk=getattr(document, "pk", None)).filter(file_name=name)
        if clash.exists():
            raise ClaimBlocked("Файл с таким именем уже есть в пакете")
        if document is None:
            document = ClaimPackageDocument(
                organization=case.organization, package=package, doc_type=doc_type, file_name=name,
                signature_name=_signature_name(name, signature_kind), signer=_signer(doc_type),
            )
        else:
            _drop_signature(document)
            document.file_name = name
            document.generated = False
        document.doc_type = doc_type
        document.signer = _signer(doc_type)
        document.signature_name = _signature_name(document.file_name, signature_kind)
        document.pdf.save(name, ContentFile(_read(pdf)), save=False)
        manifest_changed = True
    elif document is None:
        raise ClaimBlocked("Сначала приложите PDF")
    elif _signature_name(document.file_name, signature_kind) != document.signature_name:
        _drop_signature(document)
        document.signature_name = _signature_name(document.file_name, signature_kind)
        manifest_changed = True
    if signature is not None:
        _reject_size(signature)
        _check_signature_upload(getattr(signature, "name", ""), document.signature_name)
        document.signature.save(document.signature_name, ContentFile(_read(signature)), save=False)
    document.save()
    if manifest_changed:
        _invalidate(package)
    return document


def delete_document(case: ClaimCase, doc_id: int) -> None:
    package = stored_package(case)
    document = package.documents.filter(pk=doc_id).first() if package is not None else None
    if document is None:
        raise ClaimBlocked("Документ не из этого пакета")
    _drop_signature(document)
    if document.pdf:
        document.pdf.delete(save=False)
    document.delete()
    _invalidate(package)


def form_package(case: ClaimCase, user) -> ClaimPackage:
    package = stored_package(case)
    if package is None:
        raise ClaimBlocked("Сначала сохраните состав пакета")
    problems = _problems(case, package)
    package.problems = problems
    if problems:
        package.formed_at = None
        package.manifest = {}
        package.save(update_fields=["problems", "formed_at", "manifest", "updated_at"])
        WritCheck.objects.filter(account_id=case.account_id, code="package").update(done=False)
        raise ClaimBlocked("; ".join(problems))
    package.manifest = _manifest(case, package)
    package.formed_at = timezone.now()
    package.save(update_fields=["problems", "manifest", "formed_at", "updated_at"])
    ensure_writ_checks(case.account)
    WritCheck.objects.filter(account_id=case.account_id, code="package").update(done=True)
    ClaimEvent.objects.create(
        case=case,
        actor=user if getattr(user, "is_authenticated", False) else None,
        old_stage=case.stage,
        new_stage=case.stage,
        reason="Сформирован пакет для личного кабинета БНП",
    )
    return package


def drop_formed_package(case: ClaimCase) -> None:
    """Заявление в PDF содержит дату вручения и тариф. После их смены пакет собирают заново."""
    package = stored_package(case)
    if package is not None and package.formed_at:
        _invalidate(package)


def require_formed_package(case: ClaimCase) -> None:
    blockers = send_blockers(case, stored_package(case))
    if blockers:
        raise ClaimBlocked("; ".join(blockers))


def manifest_bytes(case: ClaimCase) -> bytes:
    package = stored_package(case)
    if package is None or not package.formed_at:
        raise ClaimBlocked("Сначала сформируйте пакет")
    return json.dumps(package.manifest, ensure_ascii=False, indent=2).encode("utf-8")


def open_document(case: ClaimCase, doc_id: int, kind: str):
    package = stored_package(case)
    document = package.documents.filter(pk=doc_id).first() if package is not None else None
    if document is None:
        raise ClaimBlocked("Документ не из этого пакета")
    if kind == "pdf":
        if not document.pdf:
            raise ClaimBlocked("PDF ещё не приложен")
        return document.pdf, document.file_name
    if not document.signature:
        raise ClaimBlocked("Файл ЭЦП ещё не приложен")
    return document.signature, document.signature_name


def send_blockers(case: ClaimCase, package: ClaimPackage | None) -> list[str]:
    if package is None or not package.formed_at:
        return ["Сначала сформируйте пакет для личного кабинета БНП"]
    blockers = []
    if _amounts_changed(case.account, package):
        blockers.append("Сумма в АИС изменилась. Сформируйте пакет снова")
    missing = [doc.file_name for doc in package.documents.all() if doc.pdf and not doc.signature]
    if missing:
        blockers.append("Нет файла ЭЦП: " + ", ".join(missing))
    return blockers


def stored_package(case: ClaimCase) -> ClaimPackage | None:
    # Не читать case.package: Django запоминает отсутствие связи и после создания пакета снова кидает DoesNotExist.
    return ClaimPackage.objects.filter(case=case).first()


def _ensure(case: ClaimCase) -> ClaimPackage:
    package = stored_package(case)
    if package is not None:
        return package
    suggested = _suggestion(case)
    return ClaimPackage.objects.create(
        organization=case.organization,
        case=case,
        service_id=suggested["service_id"],
        contact_data=suggested["contact_data"],
        notification_email=suggested["notification_email"],
        user_message=suggested["user_message"],
        debtors=suggested["debtors"],
        debts=suggested["debts"],
    )


def _invalidate(package: ClaimPackage) -> None:
    package.formed_at = None
    package.manifest = {}
    package.problems = []
    package.save()
    WritCheck.objects.filter(account_id=package.case.account_id, code="package").update(done=False)


def _suggestion(case: ClaimCase) -> dict:
    account = case.account
    email = ""
    for reg in account.registrations.all():
        if reg.subj_is_main and reg.email:
            email = reg.email
            break
    return {
        "service_id": None,
        "contact_data": account.contact_phone or account.phone or "",
        "notification_email": email,
        "user_message": (
            "Прошу совершить исполнительную надпись по задолженности за жилищно-коммунальные услуги. "
            f"Лицевой счёт {account.client_account}."
        ),
        "debtors": _suggest_debtors(account),
        "debts": [_debt_row(account, "balance", "", timezone.localdate().isoformat(), "", "")],
    }


def _suggest_debtors(account: Account) -> list[dict]:
    regs = [reg for reg in account.registrations.all() if not reg.subj_is_check_out]
    mains = [reg for reg in regs if reg.subj_is_main] or [None]
    rows = [_debtor_from(account, reg, solidary=False) for reg in mains[:1]]
    rows.extend(_debtor_from(account, reg, solidary=True) for reg in regs if not reg.subj_is_main)
    return rows


def _debtor_from(account: Account, reg, *, solidary: bool) -> dict:
    if reg is not None:
        second, first, middle = reg.fam, reg.im, reg.ot
        personal = reg.personal_num
        legal = bool(reg.subj_legal_entity)
    else:
        second, first, middle = _split_fio(account.short_fio)
        personal = account.payer_identifier
        legal = False
    personal = (personal or account.payer_identifier or "").strip().upper()
    unp = (account.payer_unp or "").strip()
    if legal or (unp and not personal):
        person = "legal"
    else:
        person = "natural"
    return {
        "personType": person,
        "personalId": personal,
        "secondName": second or "",
        "firstName": first or "",
        "middleName": middle or "",
        "unp": unp,
        "regNumber": "",
        "regName": account.short_fio if person == "legal" else "",
        "solidary": solidary,
    }


def _split_fio(short: str) -> tuple[str, str, str]:
    parts = [part for part in (short or "").replace(".", " ").split() if len(part) > 1]
    second = parts[0] if parts else ""
    first = parts[1] if len(parts) > 1 else ""
    middle = parts[2] if len(parts) > 2 else ""
    return second, first, middle


def _catalog() -> dict:
    labels = {row.code: row.name for row in BnpDocType.objects.filter(code__in=OUTGOING_DOCS)}
    services = []
    for service in BnpService.objects.filter(type_id="exec_order").prefetch_related("debt_types"):
        services.append({
            "id": service.pk,
            "name": service.name,
            "housing": service.pk in HOUSING_SERVICES,
            "debt_type_ids": sorted(service.debt_types.values_list("code", flat=True)),
        })
    services.sort(key=lambda row: (not row["housing"], row["id"]))
    return {
        "services": services,
        "debt_types": [{"id": row.code, "name": row.name} for row in BnpDebtType.objects.all()],
        "doc_types": [{"id": code, "name": labels.get(code, code)} for code in OUTGOING_DOCS],
        "doc_labels": labels,
        "required_docs": list(REQUIRED_DOCS),
    }


def _document_payload(doc: ClaimPackageDocument, labels: dict) -> dict:
    size = 0
    if doc.pdf:
        try:
            size = doc.pdf.size
        except OSError:
            size = 0
    return {
        "id": doc.pk,
        "doc_type": doc.doc_type,
        "doc_type_label": labels.get(doc.doc_type, doc.doc_type),
        "file_name": doc.file_name,
        "signature_name": doc.signature_name,
        "signer": doc.signer,
        "signer_label": SIGNER_LABEL.get(doc.signer, doc.signer),
        "has_pdf": bool(doc.pdf),
        "has_signature": bool(doc.signature),
        "generated": doc.generated,
        "size": size,
    }


def _normalize_debtors(raw) -> list[dict]:
    if not isinstance(raw, list):
        raise ClaimBlocked("Должники передаются списком")
    if len(raw) > 20:
        raise ClaimBlocked("В одном заявлении не больше 20 должников")
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            raise ClaimBlocked("Должник передан не объектом")
        person = str(item.get("personType") or "natural")
        if person not in PERSON_TYPES:
            raise ClaimBlocked("Тип лица: natural, legal или sole_trader")
        row = {key: str(item.get(key) or "").strip() for key in DEBTOR_FIELDS}
        row["personType"] = person
        row["personalId"] = row["personalId"].upper()
        row["solidary"] = bool(item.get("solidary"))
        rows.append(row)
    return rows


def _normalize_debts(account: Account, raw) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ClaimBlocked("Нужна хотя бы одна строка задолженности из АИС")
    seen = set()
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            raise ClaimBlocked("Строка задолженности передана не объектом")
        source = item.get("source")
        if source not in {"balance", "penalty"}:
            raise ClaimBlocked("Сумма берётся из исходящего сальдо ЛС или из пени АИС")
        if source in seen:
            raise ClaimBlocked("Такая строка задолженности уже есть")
        seen.add(source)
        start = _iso(item.get("startDate"), "startDate")
        end = _iso(item.get("endDate"), "endDate")
        at = _iso(item.get("dateAt"), "dateAt")
        rows.append(_debt_row(account, source, str(item.get("typeId") or "").strip(), at or "", start or "", end or ""))
    return rows


def _debt_row(account: Account, source: str, type_id: str, date_at: str, start: str, end: str) -> dict:
    row = {
        "source": source,
        "typeId": type_id,
        "amount": _amount_for(account, source),
        "currency": "BYN",
    }
    if start and end:
        row["startDate"] = start
        row["endDate"] = end
    elif date_at:
        row["dateAt"] = date_at
    return row


def _with_live_amount(account: Account, row: dict) -> dict:
    fresh = dict(row)
    fresh["amount"] = _amount_for(account, row.get("source") or "balance")
    fresh["currency"] = "BYN"
    return fresh


def _amount_for(account: Account, source: str) -> str:
    if source == "penalty":
        total = sum((service.balance_mulct_out or Decimal("0")) for service in account.services.all())
    else:
        total = account.balance_out or Decimal("0")
    return f"{Decimal(total).quantize(Decimal('0.01')):.2f}"


def _iso(value, label: str) -> str:
    if value in (None, ""):
        return ""
    text = str(value)[:10]
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise ClaimBlocked(f"{label}: дата в формате YYYY-MM-DD") from exc
    return text


def _problems(case: ClaimCase, package: ClaimPackage) -> list[str]:
    problems = []
    if not BnpService.objects.exists():
        return ["Справочники БНП не загружены"]
    service = BnpService.objects.filter(pk=package.service_id, type_id="exec_order").first() if package.service_id else None
    if service is None:
        problems.append("Выберите услугу исполнительной надписи из справочника БНП")
    if not package.contact_data.strip():
        problems.append("Нет контактных данных")
    emails = [item.strip() for item in package.notification_email.split(",") if item.strip()]
    if not emails or any(EMAIL_RE.fullmatch(item) is None for item in emails):
        problems.append("Нужен e-mail для уведомлений. Несколько адресов — через запятую")
    if not package.user_message.strip():
        problems.append("Нет сообщения нотариусу")
    if not package.debtors:
        problems.append("Нет должника")
    for index, debtor in enumerate(package.debtors, start=1):
        problems.extend(_debtor_problems(debtor, index))
    allowed = set(service.debt_types.values_list("code", flat=True)) if service is not None else set()
    known_types = set(BnpDebtType.objects.values_list("code", flat=True))
    if not package.debts:
        problems.append("Нет строки задолженности")
    for debt in package.debts:
        problems.extend(_debt_problems(case.account, debt, allowed, known_types))
    present = {doc.doc_type for doc in package.documents.all() if doc.pdf}
    labels = dict(BnpDocType.objects.filter(code__in=REQUIRED_DOCS).values_list("code", "name"))
    for code in REQUIRED_DOCS:
        if code not in present:
            problems.append(f"Нет документа «{labels.get(code, code)}»")
    for doc in package.documents.all():
        problems.extend(_file_problems(doc))
    return problems


def _debtor_problems(debtor: dict, index: int) -> list[str]:
    person = debtor.get("personType")
    prefix = f"Должник {index}"
    missing = []
    if person in {"natural", "sole_trader"}:
        if not PERSONAL_ID_RE.fullmatch(debtor.get("personalId") or ""):
            missing.append("личный номер (14 символов, латинские прописные)")
        for key, title in (("secondName", "фамилия"), ("firstName", "имя"), ("middleName", "отчество")):
            if not (debtor.get(key) or "").strip():
                missing.append(title)
    if person in {"legal", "sole_trader"}:
        if not UNP_RE.fullmatch(debtor.get("unp") or ""):
            missing.append("УНП из 9 цифр")
    if person == "legal":
        if not (debtor.get("regNumber") or "").strip():
            missing.append("регистрационный номер")
        if not (debtor.get("regName") or "").strip():
            missing.append("наименование")
    if person not in PERSON_TYPES:
        return [f"{prefix}: тип лица natural, legal или sole_trader"]
    if not missing:
        return []
    return [f"{prefix}: укажите " + ", ".join(missing)]


def _debt_problems(account: Account, debt: dict, allowed: set[str], known_types: set[str]) -> list[str]:
    problems = []
    amount = _amount_for(account, debt.get("source") or "balance")
    if not AMOUNT_RE.fullmatch(amount) or Decimal(amount) <= 0:
        source = "пени" if debt.get("source") == "penalty" else "исходящего сальдо"
        problems.append(f"В АИС нет положительной суммы {source}")
    type_id = debt.get("typeId") or ""
    if not type_id:
        problems.append("Выберите тип задолженности")
    elif type_id not in known_types:
        problems.append(f"Тип задолженности {type_id} отсутствует в справочнике БНП")
    elif allowed and type_id not in allowed:
        problems.append(f"Тип задолженности {type_id} недопустим для выбранной услуги")
    start, end, at = debt.get("startDate"), debt.get("endDate"), debt.get("dateAt")
    if not ((start and end) or at):
        problems.append("Укажите период задолженности или одну дату")
    if start and end and start > end:
        problems.append("Дата начала задолженности позже даты окончания")
    return problems


def _file_problems(doc: ClaimPackageDocument) -> list[str]:
    problems = []
    if not doc.file_name.lower().endswith(".pdf"):
        problems.append(f"{doc.file_name}: документ только .pdf")
    lower = doc.signature_name.lower()
    if not (lower.endswith(".pdf.p7s") or lower.endswith(".pdf.sgn")):
        problems.append(f"{doc.file_name}: файл ЭЦП называется .pdf.sgn или .pdf.p7s")
    if not doc.pdf:
        problems.append(f"{doc.file_name}: нет PDF")
        return problems
    try:
        size = doc.pdf.size
    except OSError:
        size = MAX_FILE_BYTES + 1
    if size > MAX_FILE_BYTES:
        problems.append(f"{doc.file_name}: больше 15 МБ")
    if doc.signature:
        try:
            sign_size = doc.signature.size
        except OSError:
            sign_size = MAX_FILE_BYTES + 1
        if sign_size > MAX_FILE_BYTES:
            problems.append(f"{doc.signature_name}: больше 15 МБ")
    return problems


def _manifest(case: ClaimCase, package: ClaimPackage) -> dict:
    docs = list(package.documents.all())
    order = {code: index for index, code in enumerate(OUTGOING_DOCS)}
    docs.sort(key=lambda doc: (order.get(doc.doc_type, 99), doc.pk))
    return {
        "version": 1,
        "applications": [{
            "externalId": f"claim-{case.pk}",
            "contactData": package.contact_data.strip(),
            "notificationE-mail": package.notification_email.strip(),
            "userMessage": package.user_message.strip(),
            "serviceId": package.service_id,
            "debtors": [_manifest_debtor(row) for row in package.debtors],
            "debts": [_manifest_debt(case.account, row) for row in package.debts],
            "docs": [
                {
                    "fileName": doc.file_name,
                    "signatureName": doc.signature_name,
                    "docType": doc.doc_type,
                    "detachedSign": True,
                }
                for doc in docs
                if doc.pdf
            ],
        }],
    }


def _manifest_debtor(row: dict) -> dict:
    person = row.get("personType")
    payload = {"personType": person}
    if person in {"natural", "sole_trader"}:
        payload.update({
            "personalId": row.get("personalId") or "",
            "secondName": row.get("secondName") or "",
            "firstName": row.get("firstName") or "",
            "middleName": row.get("middleName") or "",
        })
    if person in {"legal", "sole_trader"}:
        payload["unp"] = row.get("unp") or ""
    if person == "legal":
        payload["regNumber"] = row.get("regNumber") or ""
        payload["regName"] = row.get("regName") or ""
    return payload


def _manifest_debt(account: Account, row: dict) -> dict:
    payload = {
        "amount": _amount_for(account, row.get("source") or "balance"),
        "currency": "BYN",
        "typeId": row.get("typeId") or "",
    }
    if row.get("startDate") and row.get("endDate"):
        payload["startDate"] = row["startDate"]
        payload["endDate"] = row["endDate"]
    elif row.get("dateAt"):
        payload["dateAt"] = row["dateAt"]
    return payload


def _amounts_changed(account: Account, package: ClaimPackage) -> bool:
    frozen = (package.manifest or {}).get("applications", [{}])[0].get("debts", [])
    current = [_amount_for(account, row.get("source") or "balance") for row in package.debts]
    return [row.get("amount") for row in frozen] != current


def _application_lines(case: ClaimCase, package: ClaimPackage) -> list[str]:
    account = case.account
    debtor = package.debtors[0] if package.debtors else {}
    name = " ".join(
        part for part in (debtor.get("secondName"), debtor.get("firstName"), debtor.get("middleName"), debtor.get("regName"))
        if part
    )
    return [
        "Заявление о совершении исполнительной надписи",
        "",
        f"Заявитель: {case.organization.name}",
        f"Лицевой счёт: {account.client_account}",
        f"Адрес: {account.account_address}",
        f"Должник: {name}",
        f"Исходящее сальдо по данным АИС: {_amount_for(account, 'balance')} BYN",
        f"Пеня по данным АИС: {_amount_for(account, 'penalty')} BYN",
        f"Дата вручения предупреждения: {case.warning_delivered_on or 'не указана'}",
        f"Нотариальный тариф: {case.notary_tariff if case.notary_tariff is not None else 'не указан'}",
        "",
        package.user_message or "",
        "",
        "Документ собран в ПМ и готовится к подписанию ЭЦП. В личный кабинет БНП он не направлялся.",
    ]


def _find_document(package: ClaimPackage, doc_type: str, doc_id) -> ClaimPackageDocument | None:
    if doc_id:
        document = package.documents.filter(pk=int(doc_id)).first()
        if document is None:
            raise ClaimBlocked("Документ не из этого пакета")
        return document
    if doc_type in REQUIRED_DOCS:
        return package.documents.filter(doc_type=doc_type).first()
    return None


def _signer(doc_type: str) -> str:
    return SIGNER_OF.get(doc_type, "applicant")


def _signature_name(file_name: str, kind: str) -> str:
    return f"{file_name}.{kind}"


def _pdf_name(original: str) -> str:
    name = Path(original).name.strip()
    name = re.sub(r"[^\w.\- ()]+", "_", name, flags=re.UNICODE)
    lower = name.lower()
    if lower.endswith(".pdf.p7s") or lower.endswith(".pdf.sgn"):
        raise ClaimBlocked("Это файл ЭЦП, а не документ PDF")
    if not lower.endswith(".pdf"):
        raise ClaimBlocked("В пакет принимается документ .pdf")
    return name[:180]


def _safe_token(value: str) -> str:
    token = re.sub(r"[^0-9A-Za-z_-]", "", value or "")
    return token or "ls"


def _check_signature_upload(original: str, signature_name: str) -> None:
    upload = Path(original or "").name.lower()
    if not (upload.endswith(".pdf.p7s") or upload.endswith(".pdf.sgn")):
        raise ClaimBlocked("Файл ЭЦП: .pdf.sgn или .pdf.p7s")
    expected = ".pdf.sgn" if signature_name.lower().endswith(".pdf.sgn") else ".pdf.p7s"
    if not upload.endswith(expected):
        raise ClaimBlocked(f"Для этого документа файл ЭЦП называется {signature_name}")


def _reject_size(uploaded) -> None:
    size = getattr(uploaded, "size", None)
    if size is None:
        size = len(_read(uploaded))
    if not size:
        raise ClaimBlocked("Пустой файл")
    if size > MAX_FILE_BYTES:
        raise ClaimBlocked("Файл больше 15 МБ")


def _read(uploaded) -> bytes:
    if hasattr(uploaded, "seek"):
        uploaded.seek(0)
    return uploaded.read()


def _drop_signature(document: ClaimPackageDocument) -> None:
    if document.signature:
        document.signature.delete(save=False)
