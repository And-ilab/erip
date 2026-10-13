"""Пакет в АИС ПРИС по регламенту подключения (сервисы 3.11.02–3.11.05).

Коды справочников не выдумываются: чего нет в карточке, регистрации или реквизитах
организации, то остаётся в списке замечаний и в ПРИС не уходит.
"""

from __future__ import annotations

import base64
import re
from datetime import date, datetime
from decimal import Decimal

from apps.debts.models import Attachment, ClaimCase, ClaimPackageDocument, Payment, Registration
from apps.debts.services.claims import ClaimBlocked, move_case
from apps.debts.services.pris_gateway import get_pris_transport

_DATE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
_SEND_STAGES = {ClaimCase.Stage.WRIT_DONE, ClaimCase.Stage.COURT, ClaimCase.Stage.OPI}
_ACCEPTED = {"1000", "1001"}
REQUEST_KEYS = (
    "opi", "req_init", "doc_code", "doc_num", "doc_date", "doc_org_code", "doc_org", "doc_date_in",
    "debtor_np_type", "debtor_street_type", "debtor_country", "debtor_opf", "debtor_region", "debtor_area", "debtor_np",
    "debtor_street", "debtor_house", "debtor_flat", "debtor_full_adr", "debtor_post_index",
    "pdf_id", "signature_id",
)
CLAIMANT_KEYS = (
    "opf", "country", "full_adr", "region", "area", "np_type", "np", "street_type", "street",
    "house", "corp", "flat", "post_index", "bank_unp", "bank_code", "acc_num", "acc_type",
    "curr_code", "budget_code",
)
_ADDRESS_KEYS = (
    "full_adr", "country", "region", "area", "np_type", "np", "street_type", "street",
    "house", "corp", "flat", "post_index",
)


def pris_card(case: ClaimCase) -> dict:
    problems = _problems(case)
    return {
        "problems": problems,
        "ready": not problems,
        "cl_num": _cl_num(case),
        "response_id": case.pris_response_id,
        "process_status": case.pris_process_status,
        "process_message": case.pris_process_message,
        "request": case.pris_request or {},
        "claimant": case.organization.pris_claimant or {},
    }


def save_pris_draft(case: ClaimCase, data: dict) -> ClaimCase:
    request = dict(case.pris_request or {})
    for key in REQUEST_KEYS:
        if key in data:
            request[key] = _clean(data.get(key))
    case.pris_request = request
    claimant = data.get("claimant")
    if isinstance(claimant, dict):
        stored = dict(case.organization.pris_claimant or {})
        for key in CLAIMANT_KEYS:
            if key in claimant:
                stored[key] = _clean(claimant.get(key))
        case.organization.pris_claimant = stored
        case.organization.save(update_fields=["pris_claimant", "updated_at"])
    case.save(update_fields=["pris_request", "updated_at"])
    return case


def submit_pris(case: ClaimCase, user, data: dict | None = None) -> ClaimCase:
    if data:
        save_pris_draft(case, data)
    if case.opi_mode == "pris" and case.pris_process_status in _ACCEPTED:
        raise ClaimBlocked("Задолженность уже принята ПРИС. Обновите ход производства или передайте погашение.")
    problems = _problems(case)
    if problems:
        raise ClaimBlocked("Пакет ПРИС не собран: " + "; ".join(problems))
    payload, wofe = _payload(case)
    path = "/gw/v1/integrations/pris/save-data-debt-wofe" if wofe else "/gw/v1/integrations/pris/save-data-debt/validate"
    result = get_pris_transport().post(path, payload)
    _remember_acceptance(case, result)
    if result.get("mode") == "http":
        case.opi_mode = "pris"
        note = f"ПРИС принял пакет, код {case.pris_process_status}. Номер производства появится после обновления."
    else:
        case.opi_mode = "stub"
        case.pris_process_message = "Пакет прошёл проверку регламента. В АИС ПРИС не отправлен: канал-заглушка."
        note = case.pris_process_message
    case.pris_cl_num = _cl_num(case)
    case.save(update_fields=[
        "opi_mode", "pris_cl_num", "pris_response_id", "pris_process_status", "pris_process_message", "updated_at",
    ])
    from apps.debts.services.claims import _event

    _event(case, user, case.stage, case.stage, note)
    return case


def refresh_pris(case: ClaimCase, user) -> ClaimCase:
    if case.opi_number.strip():
        result = get_pris_transport().post(
            "/gw/v1/integrations/pris/claimant-info", {"p_proc_num": case.opi_number.strip()},
        )
    elif case.pris_cl_num.strip():
        result = get_pris_transport().post(
            "/gw/v1/integrations/pris/claimant-info-by-debt", {"p_cl_num": case.pris_cl_num.strip()},
        )
    else:
        raise ClaimBlocked("Сначала передайте задолженность в ПРИС или запишите номер производства")
    if result.get("mode") != "http":
        from apps.debts.services.claims import _event

        _event(case, user, case.stage, case.stage, "Заглушка ПРИС: ход производства не записывался")
        case.opi_mode = case.opi_mode or "stub"
        case.save(update_fields=["opi_mode", "updated_at"])
        return case
    items = result.get("items") or []
    if not items:
        raise ClaimBlocked("ПРИС не вернул сведений по этому производству")
    info = items[0]
    docs = info.get("p_ispdoc") or []
    proc = str((docs[0] if docs else {}).get("proc_num") or "").strip()
    actual = next((row for row in info.get("p_status") or [] if str(row.get("actual")) == "1"), None)
    status = str((actual or {}).get("status") or "").strip()
    if proc:
        case.opi_number = proc[:50]
    if status:
        case.opi_status = status[:40]
    case.opi_mode = "pris"
    case.save(update_fields=["opi_number", "opi_status", "opi_mode", "updated_at"])
    if proc and case.stage in {ClaimCase.Stage.WRIT_DONE, ClaimCase.Stage.COURT}:
        case = move_case(case, ClaimCase.Stage.OPI, user, f"ПРИС: производство {proc}, статус {status}")
    actions = info.get("p_action") or []
    if actions and case.stage == ClaimCase.Stage.OPI:
        case = move_case(case, ClaimCase.Stage.OPI_MEASURES, user, f"ПРИС: мер {len(actions)}, статус {status}")
    return case


def repay_pris(case: ClaimCase, user) -> ClaimCase:
    if not case.pris_cl_num.strip():
        raise ClaimBlocked("Погашение уходит в ПРИС после передачи задолженности")
    payload, problems = _repay_payload(case)
    if problems:
        raise ClaimBlocked("Погашение ПРИС не собрано: " + "; ".join(problems))
    result = get_pris_transport().post("/gw/v1/integrations/pris/save-repay-debt", payload)
    _remember_acceptance(case, result)
    if result.get("mode") == "http":
        note = f"ПРИС принял погашение, код {case.pris_process_status}"
    else:
        case.pris_process_message = "Погашение прошло проверку регламента. В АИС ПРИС не отправлено: канал-заглушка."
        note = case.pris_process_message
        case.opi_mode = case.opi_mode or "stub"
    case.save(update_fields=["opi_mode", "pris_response_id", "pris_process_status", "pris_process_message", "updated_at"])
    from apps.debts.services.claims import _event

    _event(case, user, case.stage, case.stage, note)
    return case


def _remember_acceptance(case: ClaimCase, result: dict) -> None:
    rows = result.get("data") or []
    first = rows[0] if rows else {}
    case.pris_response_id = str(first.get("responseId") or "")[:64]
    case.pris_process_status = str(first.get("processStatus") or "")[:10]
    case.pris_process_message = str(first.get("processMessage") or "")[:500]


def _problems(case: ClaimCase) -> list[str]:
    problems: list[str] = []
    if case.stage not in _SEND_STAGES:
        problems.append("исполнительный документ направляется после надписи или решения суда")
    request = case.pris_request or {}
    if not _text(request.get("opi")):
        problems.append("нет кода ОПИ (справочник 120)")
    for key, label in (
        ("doc_code", "вида документа (справочник 201)"),
        ("doc_num", "номера документа"),
        ("doc_date", "даты документа"),
        ("doc_org_code", "кода органа (справочник 217)"),
        ("doc_org", "наименования органа"),
        ("doc_date_in", "даты вступления в силу"),
    ):
        if not _text(request.get(key)):
            problems.append(f"нет {label}")
        elif key in {"doc_date", "doc_date_in"} and not _DATE.match(_pris_date(request.get(key))):
            problems.append(f"{label} нужна в формате ДД.ММ.ГГГГ")
    if _pair(case) is None:
        problems.append("нет PDF исполнительного документа и отдельного файла подписи (.p7s или .sgn)")
    debtor, debtor_problems = _debtor(case)
    problems += debtor_problems
    if debtor is not None and not debtor["p_arr_sum"]:
        problems.append("нет положительной суммы требования")
    problems += _claimant_problems(case)
    return problems


def _payload(case: ClaimCase) -> tuple[dict, bool]:
    request = case.pris_request or {}
    debtor, _problems_debtor = _debtor(case)
    pdf_name, pdf_field, sign_name, sign_field = _pair(case)
    wofe = sign_name.lower().endswith(".sgn")
    file_body = _b64(sign_field if wofe else pdf_field)
    file_ecp = pdf_name if wofe else _b64(sign_field)
    document = {
        "p_doc_code": _text(request.get("doc_code")),
        "p_doc_date": _pris_date(request.get("doc_date")),
        "p_doc_num": _text(request.get("doc_num")),
        "p_doc_org_code": _text(request.get("doc_org_code")),
        "p_doc_org": _text(request.get("doc_org")),
        "p_doc_date_in": _pris_date(request.get("doc_date_in")),
        "p_files": [{"file_body": file_body, "file_ecp": file_ecp}],
    }
    item = {
        "identif": {
            "p_cl_num": _cl_num(case),
            "p_opi": _text(request.get("opi")),
            "p_solidar_num": "",
        },
        "debtor": debtor,
        "claimant": _claimant(case),
        "documents": [document],
    }
    return {"package": [item]}, wofe


def _debtor(case: ClaimCase) -> tuple[dict | None, list[str]]:
    person = _registration(case)
    if person is None:
        return None, ["нет регистрации плательщика на лицевом счёте"]
    problems: list[str] = []
    if person.subj_legal_entity:
        name = _text(person.fam) or case.account.short_fio
        unp = _text(person.payer_unp) or _text(case.account.payer_unp)
        if not name:
            problems.append("нет наименования должника-юрлица")
        if not unp:
            problems.append("нет УНП должника")
        address, address_problems = _firm_address(case, person)
        problems += address_problems
        opf = _text((case.pris_request or {}).get("debtor_opf"))
        if not opf:
            problems.append("нет кода ОПФ должника-юрлица")
        body = _empty_party("p_d_")
        body.update({
            "p_d_firm_name": name,
            "p_d_reg_num": unp,
            "p_d_opf": opf,
            "p_d_firm_adr": address,
            "p_r_req_init": _text((case.pris_request or {}).get("req_init")),
            "p_arr_sum": _sums(case.account),
        })
        return body, problems
    if not (_text(person.fam) and _text(person.im)):
        problems.append("у должника нет фамилии и имени в регистрации")
    country = _text((case.pris_request or {}).get("debtor_country")) or _country(person.citizenship_name)
    if not country:
        problems.append("нет кода страны гражданства должника (справочник 306)")
    if country == "112" and not _text(person.personal_num):
        problems.append("нет идентификационного номера должника")
    if person.birthday is None:
        problems.append("нет даты рождения должника")
    address, address_problems = _person_address(case, person, country)
    problems += address_problems
    phones = []
    phone = _text(person.contact_phone) or _text(case.account.contact_phone) or _text(case.account.phone)
    if phone:
        phones.append({"phone": phone})
    emails = [{"email": person.email}] if _text(person.email) else []
    body = _empty_party("p_d_")
    body.update({
        "p_d_country": country,
        "p_d_surname": person.fam,
        "p_d_first_name": person.im,
        "p_d_father_name": person.ot,
        "p_d_date_reg": person.birthday.strftime("%d.%m.%Y") if person.birthday else "",
        "p_d_idf_num": person.personal_num,
        "p_d_adr_reg": address,
        "p_d_phones": phones,
        "p_d_emails": emails,
        "p_r_req_init": _text((case.pris_request or {}).get("req_init")),
        "p_arr_sum": _sums(case.account),
    })
    return body, problems


def _person_address(case: ClaimCase, person: Registration, country: str) -> tuple[dict, list[str]]:
    request = case.pris_request or {}
    place = _place(case.account)
    country = _text(request.get("debtor_country")) or country
    address = _blank_address()
    address.update({
        "full_adr": _text(request.get("debtor_full_adr")) or _text(person.registration_address) or _text(case.account.account_address),
        "country": country,
        "region": _text(request.get("debtor_region")) or place.get("oblast", ""),
        "area": _text(request.get("debtor_area")) or place.get("district", ""),
        "np_type": _text(request.get("debtor_np_type")),
        "np": _text(request.get("debtor_np")) or place.get("settlement", ""),
        "street_type": _text(request.get("debtor_street_type")),
        "street": _text(request.get("debtor_street")) or place.get("street", ""),
        "house": _text(request.get("debtor_house")) or place.get("house", ""),
        "flat": _text(request.get("debtor_flat")) or _text(case.account.flat_number),
        "post_index": _text(request.get("debtor_post_index")),
    })
    problems = []
    for key, label in (("np_type", "типа населённого пункта (справочник 309)"), ("np", "населённого пункта"), ("house", "номера дома")):
        if not address[key]:
            problems.append(f"в адресе должника нет {label}")
    if not address["country"]:
        problems.append("в адресе должника нет кода страны")
    if not address["full_adr"] and not address["region"]:
        problems.append("в адресе должника нет полного адреса или области")
    return address, problems


def _firm_address(case: ClaimCase, person: Registration) -> tuple[dict, list[str]]:
    address, problems = _person_address(case, person, _country(person.citizenship_name))
    if not address["full_adr"]:
        problems.append("в адресе должника-юрлица нет полного адреса")
    return address, problems


def _claimant(case: ClaimCase) -> dict:
    org = case.organization
    profile = org.pris_claimant or {}
    body = _empty_party("p_c_")
    body.update({
        "p_c_firm_name": org.name,
        "p_c_opf": _text(profile.get("opf")),
        "p_c_reg_num": _text(org.unp),
        "p_c_firm_adr": _profile_address(profile),
        "p_b_unp": _text(profile.get("bank_unp")) or _text(org.unp),
        "p_b_bank_code": _text(profile.get("bank_code")),
        "p_b_acc_num": _text(profile.get("acc_num")),
        "p_b_curr_code": _text(profile.get("curr_code")) or "933",
        "p_b_acc_type": _text(profile.get("acc_type")),
        "p_b_budjet_code": _text(profile.get("budget_code")),
    })
    return body


def _claimant_problems(case: ClaimCase) -> list[str]:
    org = case.organization
    profile = org.pris_claimant or {}
    problems = []
    if not _text(org.name):
        problems.append("нет наименования организации-взыскателя")
    if not _text(org.unp):
        problems.append("нет УНП организации-взыскателя")
    if not _text(profile.get("opf")):
        problems.append("нет кода ОПФ взыскателя")
    address = _profile_address(profile)
    for key, label in (
        ("full_adr", "полного адреса"),
        ("country", "кода страны (справочник 306)"),
        ("np_type", "типа населённого пункта (справочник 309)"),
        ("np", "населённого пункта"),
        ("house", "номера дома"),
    ):
        if not address[key]:
            problems.append(f"в адресе взыскателя нет {label}")
    if not _text(profile.get("bank_code")):
        problems.append("нет SWIFT банка взыскателя")
    if not _text(profile.get("acc_num")):
        problems.append("нет счёта взыскателя")
    if not _text(profile.get("acc_type")):
        problems.append("нет типа счёта взыскателя")
    return problems


def _profile_address(profile: dict) -> dict:
    address = _blank_address()
    for key in _ADDRESS_KEYS:
        address[key] = _text(profile.get(key))
    if not address["country"]:
        address["country"] = ""
    return address


def _repay_payload(case: ClaimCase) -> tuple[dict, list[str]]:
    problems = []
    request = case.pris_request or {}
    if not _text(request.get("req_init")):
        problems.append("нет типа требования (справочник 214)")
    sums = _sums(case.account)
    payments = []
    for payment in Payment.objects.filter(account_id=case.account_id).exclude(pay_date=None).order_by("pay_date", "id"):
        amount = _amount(payment.pay_service_summ) + _amount(payment.pay_mulct_summ)
        if amount <= 0 or payment.pay_date is None:
            continue
        number = _text(payment.pp_num) or str(payment.receipt_id)
        payments.append({
            "p_pay_date": payment.pay_date.strftime("%d.%m.%Y"),
            "p_pay_num": number,
            "p_pay_sum": f"{amount.quantize(Decimal('0.01'))}",
            "p_pay_curr": "933",
        })
    if not payments:
        problems.append("нет погашений с датой и суммой")
    rest = sum((_amount(row["p_rest_sum"]) for row in sums), Decimal("0"))
    if rest <= 0 and payments:
        status = "3"
    elif payments:
        status = "2"
    else:
        status = "1"
    payload = {"package": [{
        "p_cl_num": case.pris_cl_num,
        "p_status": status,
        "p_req_init": _text(request.get("req_init")),
        "req_arr": sums or [{"p_price": "0.00", "p_curr_code": "933", "p_rest_sum": "0.00"}],
        "repayment": payments,
    }]}
    return payload, problems


def _sums(account) -> list[dict]:
    penalty = sum((_amount(service.balance_mulct_out) for service in account.services.all()), Decimal("0"))
    total = _amount(account.balance_out)
    principal = total - penalty if total >= penalty else total
    rows = []
    if principal > 0:
        rows.append(_sum_row(principal))
    if penalty > 0:
        rows.append(_sum_row(penalty))
    return rows


def _sum_row(amount: Decimal) -> dict:
    text = f"{amount.quantize(Decimal('0.01'))}"
    return {"p_price": text, "p_curr_code": "933", "p_rest_sum": text}


def _pair(case: ClaimCase):
    request = case.pris_request or {}
    pdf_id = request.get("pdf_id")
    signature_id = request.get("signature_id")
    if pdf_id and signature_id:
        pdf = Attachment.objects.filter(account_id=case.account_id, pk=pdf_id).first()
        signature = Attachment.objects.filter(account_id=case.account_id, pk=signature_id).first()
        if pdf is None or signature is None or not pdf.file or not signature.file:
            return None
        return pdf.original_name, pdf.file, signature.original_name, signature.file
    document = (
        ClaimPackageDocument.objects.filter(package__case=case).exclude(pdf="").exclude(signature="").order_by("-id").first()
    )
    if document is None or not document.pdf or not document.signature:
        return None
    return document.file_name, document.pdf, document.signature_name, document.signature


def _registration(case: ClaimCase) -> Registration | None:
    rows = list(case.account.registrations.all())
    living = [row for row in rows if not row.subj_is_check_out]
    pool = living or rows
    main = next((row for row in pool if row.subj_is_main), None)
    return main or (pool[0] if pool else None)


def _place(account) -> dict[str, str]:
    found: dict[str, str] = {}
    node = account.territory
    guard = 0
    while node is not None and guard < 12:
        found[node.kind] = node.name
        node = node.parent
        guard += 1
    return found


def _empty_party(prefix: str) -> dict:
    body = {f"{prefix}{name}": "" for name in (
        "country", "surname", "first_name", "father_name", "date_reg", "idf_num", "unp_work",
        "firm_name", "opf", "reg_num",
    )}
    body[f"{prefix}adr_reg"] = _blank_address()
    body[f"{prefix}adr_fact"] = _blank_address()
    body[f"{prefix}firm_adr"] = _blank_address()
    body[f"{prefix}phones"] = []
    body[f"{prefix}emails"] = []
    return body


def _blank_address() -> dict:
    return {key: "" for key in _ADDRESS_KEYS}


def _cl_num(case: ClaimCase) -> str:
    if case.pris_cl_num.strip():
        return case.pris_cl_num.strip()
    return f"{case.organization.schema_name}-{case.account.client_account}"


def _country(text: str) -> str:
    raw = _text(text)
    if raw.isdigit():
        return raw
    folded = raw.lower().replace("ё", "е")
    if "беларус" in folded or folded in {"рб", "by", "blr"}:
        return "112"
    return ""


def _pris_date(value) -> str:
    raw = _text(value)
    if _DATE.match(raw):
        return raw
    if len(raw) >= 10 and raw[4] == "-":
        year, month, day = raw[:10].split("-")
        return f"{day}.{month}.{year}"
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.strftime("%d.%m.%Y")
    return raw


def _b64(field) -> str:
    with field.open("rb") as handle:
        return base64.b64encode(handle.read()).decode("ascii")


def _amount(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value))


def _text(value) -> str:
    return str(value or "").strip()


def _clean(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return value
