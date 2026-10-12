"""Бланки АИС «Расчет-ЖКУ» из папки «Шаблоны».

Статичный текст бланка не меняется. Подставляются поля лицевого счёта, услуг и периодов долга.
Суммы берутся из выгрузки. ПМ их не считает и не подставляет числа из образца.
Законы и инструкции из папок мероприятий в бланк не копируются.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from html import escape
from pathlib import Path

_CSS = Path(__file__).with_name("official_blanks.css").read_text(encoding="utf-8")

BLANKS = ("warning", "reminder", "notice-137", "notice-80", "notice-86", "notice-tko", "calculation")
EDITABLE = {"organization", "locality", "date", "doc_number", "phone", "hours", "warning_date"}
_MONTHS = (
    "", "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)
_ONES = (
    ("", ""),
    ("один", "одна"),
    ("два", "две"),
    ("три", "три"),
    ("четыре", "четыре"),
    ("пять", "пять"),
    ("шесть", "шесть"),
    ("семь", "семь"),
    ("восемь", "восемь"),
    ("девять", "девять"),
)
_TEENS = (
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
    "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
)
_TENS = (
    "", "", "двадцать", "тридцать", "сорок", "пятьдесят",
    "шестьдесят", "семьдесят", "восемьдесят", "девяносто",
)
_HUNDREDS = (
    "", "сто", "двести", "триста", "четыреста", "пятьсот",
    "шестьсот", "семьсот", "восемьсот", "девятьсот",
)

_WARNING_AFTER = (
    "дней после получения данного предупреждения Вам будут отключены коммунальные услуги"
)
_WARNING_LAW = (
    "в соответствии с пунктом 7 Положения о порядке перерасчета платы за некоторые виды "
    "коммунальных услуг и приостановления (возобновления) оказания коммунальных услуг, "
    "утвержденного постановлением Совета Министров Республики Беларусь от 27.08.2025 № 465."
)
_WARNING_P2_BEFORE = (
    "Обращаем Ваше внимание, что в соответствии с пунктом 9 названного Положения затраты, "
    "связанные с возобновлением предоставления коммунальных услуг, возмещаются гражданином, "
    "проживающим в жилом помещении. Предоставление коммунальных услуг будет возобновлено "
    "в течение не более двух суток после представления в"
)
_WARNING_P2_AFTER = (
    "документов о погашении имеющейся задолженности и оплате затрат, связанных "
    "с возобновлением предоставления коммунальных услуг."
)
_NOTICE_TAIL = (
    "рублей уведомляем Вас, что в случае неоплаты данной суммы, задолженность будет "
    "взыскана в бесспорном порядке на основании исполнительной надписи."
)
_NOTICE_137 = (
    "В случае наличия у Вас без уважительных причин шестимесячной задолженности по плате "
    "за жилищно-коммунальные услуги на Вас может быть подан иск в суд о понуждении Вас "
    "к отчуждению жилого помещения (статья 137 Жилищного кодекса Республики Беларусь)."
)
_NOTICE_80 = (
    "В случае наличия у Вас без уважительных причин шестимесячной задолженности по плате "
    "за жилищно-коммунальные услуги и плате за пользование жилым помещением на Вас может "
    "быть подан иск в суд на выселение из жилого помещения (статьи 80, 87 Жилищного кодекса "
    "Республики Беларусь)."
)
_NOTICE_86 = (
    "В случае наличия без уважительных причин задолженности по внесению платы за пользование "
    "арендным жильем и (или) жилищно-коммунальные услуги в размере шестимесячной платы за "
    "пользование арендным жильем и (или) жилищно-коммунальные услуги Вы будете выселены из "
    "занимаемых жилых помещений со всеми проживающими с Вами членами семьи и иными лицами "
    "без предоставления других жилых помещений (статья 86 Жилищного кодекса Республики Беларусь)."
)
_CALC_CLOSE = (
    "письменного предупреждения о необходимости погашения задолженности в течение 7 дней "
    "и намерением обратиться за совершением исполнительной надписи в случае неоплаты "
    "задолженность не погашена. Судебного спора нет. Сведения о письменном соглашении "
    "о порядке пользования жилым помещением между плательщиком жилищно-коммунальных услуг "
    "и совершеннолетними дееспособными членами его семьи, исключающее солидарную ответственность "
    "членов семьи по задолженности по плате за жилищно-коммунальные услуги и плате за пользование "
    "жилым помещением государственного жилищного фонда, пене за несвоевременное и (или) не в полном "
    "объёме внесение такой платы, отсутствуют."
)


def known(blank: str) -> bool:
    return blank in BLANKS


def family_of(blank: str) -> str:
    if blank == "warning":
        return "warning"
    if blank == "reminder":
        return "reminder"
    if blank == "calculation":
        return "calculation"
    if blank.startswith("notice"):
        return "notice"
    return ""


def words_int(number: int) -> str:
    """Целое прописью. Нужно для итога расчёта в том виде, как в бланке r99117."""
    value = abs(int(number))
    if value == 0:
        return "ноль"
    millions, value = divmod(value, 1_000_000)
    thousands, rest = divmod(value, 1000)
    parts = []
    if millions:
        parts.append(_chunk(millions, False))
        parts.append(_plural(millions, "миллион", "миллиона", "миллионов"))
    if thousands:
        parts.append(_chunk(thousands, True))
        parts.append(_plural(thousands, "тысяча", "тысячи", "тысяч"))
    if rest:
        parts.append(_chunk(rest, False))
    return " ".join(part for part in parts if part)


def empty_context(blank: str) -> dict:
    copy = _copy(blank)
    values = {key: "" for key in _VALUE_KEYS}
    if blank == "notice-tko":
        values["services"] = "обращение с твердыми коммунальными отходами"
    return {
        "blank": blank,
        "family": family_of(blank),
        "copy": copy,
        "values": values,
        "pairs": [],
        "residents": [],
        "penalty_rows": [],
        "show_services": blank != "notice-tko",
    }


def blank_context(blank: str, values: dict | None = None, periods: list | None = None, residents: list | None = None) -> dict:
    ctx = empty_context(blank)
    for key, value in (values or {}).items():
        if key in ctx["values"]:
            ctx["values"][key] = "" if value is None else str(value)
    groups = list(periods or [])
    ctx["pairs"] = pair_periods(groups)
    ctx["penalty_rows"] = [
        {"month": group.get("label") or "", "principal": group.get("principal") or "", "penalty": group.get("penalty") or ""}
        for group in groups
    ]
    ctx["residents"] = list(residents or [])
    ctx["values"]["total_sentence"] = total_sentence(ctx["values"])
    return ctx


def context_for_account(account, tariff: str = "", warning_date: str = "") -> dict:
    """Поля одного лицевого счёта для бланка. Тариф заявления в расчётном бланке не печатается."""
    from apps.nsi.services.scenarios import placeholder_values

    del tariff  # сумма бланка — сальдо АИС, не нотариальный тариф
    raw = placeholder_values(account, warning_date=warning_date)
    letterhead, locality, address_org, unp, bik, bank_account = _organization_bits(account)
    penalty = _dec(raw.get("penalty"))
    total = _dec(account.balance_out)
    principal = None if total is None else total - (penalty or Decimal("0"))
    groups = _period_groups(account)
    residents = _residents(account)
    registered = account.registrations.filter(subj_is_check_out=False).count()
    values = {
        "organization": letterhead,
        "locality": locality,
        "address_org": address_org,
        "phone": "",
        "hours": "",
        "date": _date(account.operational_date) or _date(date.today()),
        "doc_number": "",
        "fio": _clean(raw.get("fio")),
        "address": _clean(raw.get("address")),
        "account": account.client_account or "",
        "amount": money_text(total),
        "penalty": money_text(penalty),
        "principal": money_text(principal),
        "total": money_text(total),
        "services": _clean(raw.get("services")),
        "due_days": _clean(raw.get("due_days")),
        "months_debt": "" if account.months_debt is None else str(account.months_debt),
        "as_of": _date(account.operational_date) or _date(date.today()),
        "due_date": _date(account.warning_due),
        "area": measure_text(account.acc_total_space),
        "living_area": "",
        "rooms": "" if account.room_count is None else str(account.room_count),
        "residents_count": "" if account.subj_count is None else str(account.subj_count),
        "registered_count": str(registered),
        "tenants": "",
        "beneficiaries": "" if account.priv_acc_count is None else str(account.priv_acc_count),
        "ownership": account.ownership_type_name or "",
        "duty_from": _date(account.start_date),
        "unp": unp,
        "bank": "",
        "bik": bik,
        "bank_account": bank_account,
        "warning_date": _date(warning_date) or _clean(raw.get("warning_date")),
        "debt_started": _date(account.debt_started_on),
        "total_sentence": "",
    }
    ctx = blank_context("warning", values=values, periods=groups, residents=residents)
    ctx["values"] = {key: values.get(key, "") for key in _VALUE_KEYS}
    ctx["values"]["total_sentence"] = total_sentence(ctx["values"])
    ctx["pairs"] = pair_periods(groups)
    ctx["penalty_rows"] = [
        {"month": group["label"], "principal": group["principal"], "penalty": group["penalty"]}
        for group in groups
    ]
    ctx["residents"] = residents
    return ctx


def context_for_blank(blank: str, account=None, *, warning_date: str = "", overrides: dict | None = None) -> dict:
    if not known(blank):
        raise ValueError("Такого бланка нет")
    if account is None:
        ctx = empty_context(blank)
    else:
        base = context_for_account(account, warning_date=warning_date)
        ctx = empty_context(blank)
        ctx["values"].update(base["values"])
        ctx["pairs"] = base["pairs"]
        ctx["residents"] = base["residents"]
        ctx["penalty_rows"] = base["penalty_rows"]
        if blank == "notice-tko":
            ctx["values"]["amount"] = _tko_amount(account)
            ctx["values"]["services"] = "обращение с твердыми коммунальными отходами"
            ctx["show_services"] = False
        if blank == "calculation" and ctx["pairs"]:
            principal, penalty = _sum_pairs(ctx["pairs"])
            ctx["values"]["principal"] = money_text(principal)
            ctx["values"]["penalty"] = money_text(penalty)
            ctx["values"]["total"] = money_text(principal + penalty)
            ctx["values"]["amount"] = ctx["values"]["total"]
    _apply_overrides(ctx, overrides)
    if blank == "calculation":
        ctx["values"]["total_sentence"] = total_sentence(ctx["values"])
    return ctx


def payload_of(ctx: dict) -> dict:
    return {
        "blank": ctx["blank"],
        "family": ctx["family"],
        "copy": ctx["copy"],
        "values": ctx["values"],
        "pairs": ctx["pairs"],
        "residents": ctx["residents"],
        "penalty_rows": ctx["penalty_rows"],
        "show_services": ctx["show_services"],
    }


def render_official_html(blank: str, ctx: dict) -> str:
    return _wrap(render_official_body(blank, ctx))


def render_official_body(blank: str, ctx: dict) -> str:
    family = family_of(blank)
    if family == "warning":
        return _html_warning(ctx)
    if family == "notice":
        return _html_notice(blank, ctx)
    if family == "reminder":
        return _html_reminder(ctx)
    if family == "calculation":
        return _html_calculation(ctx)
    return ""


def render_official_pdf(blank: str, ctx: dict) -> bytes | None:
    from apps.nsi.services.form_sheet import pdf_from_html

    return pdf_from_html(render_official_html(blank, ctx))


def package_html(blank: str, contexts: list[dict]) -> str:
    pages = "".join(f'<article class="page">{render_official_body(blank, ctx)}</article>' for ctx in contexts)
    return _wrap(pages)


def official_plaintext(blank: str, ctx: dict) -> str:
    values = ctx.get("values") or {}
    copy = ctx.get("copy") or _copy(blank)
    lines = [copy.get("title") or blank, ""]
    for key in ("organization", "locality", "date", "doc_number", "fio", "address", "account"):
        if values.get(key):
            lines.append(str(values[key]))
    if values.get("amount"):
        lines.append(f"Задолженность: {values['amount']}")
    if values.get("penalty"):
        lines.append(f"Пеня: {values['penalty']}")
    if ctx.get("show_services") and values.get("services"):
        lines.append(f"Услуги: {values['services']}")
    for paragraph in (copy.get("p2"), copy.get("law"), copy.get("close")):
        if paragraph:
            lines.extend(["", paragraph])
    if values.get("total_sentence"):
        lines.extend(["", values["total_sentence"]])
    return "\n".join(lines).strip()


def total_sentence(values: dict) -> str:
    total = values.get("total") or ""
    principal = values.get("principal") or ""
    penalty = values.get("penalty") or ""
    if not total and not principal and not penalty:
        return ""
    return (
        f"Всего к оплате: {total} белорусских рублей ({_words_money(total)}): "
        f"задолженность по плате за жилищно-коммунальные услуги и плате за пользование "
        f"жилым помещением в сумме {principal} белорусских рублей ({_words_money(principal)}), "
        f"пеня в сумме {penalty} белорусских рублей ({_words_money(penalty)})."
    )


def pair_periods(groups: list[dict]) -> list[dict]:
    pairs = []
    index = 0
    while index < len(groups):
        left = groups[index]
        right = groups[index + 1] if index + 1 < len(groups) else None
        pairs.append(_pair(left, right))
        index += 2
    return pairs


def measure_text(value) -> str:
    """Площадь как в бланке: 55, 67.2, без обрезки нулей в целой части."""
    number = _dec(value)
    if number is None:
        return ""
    text = f"{number.quantize(Decimal('0.01')):.2f}"
    if text.endswith("00"):
        return text[:-3]
    return text.rstrip("0")


def money_text(value) -> str:
    number = _dec(value)
    if number is None:
        return ""
    sign = "-" if number < 0 else ""
    quantized = abs(number).quantize(Decimal("0.01"))
    whole, frac = f"{quantized:.2f}".split(".")
    groups = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    return sign + " ".join(reversed(groups)) + "." + frac


def _html_warning(ctx: dict) -> str:
    copy = ctx["copy"]
    return (
        '<article class="page warning">'
        f'{_letterhead(ctx)}'
        f'<p class="meta">{_slot(ctx, "date")}, № {_slot(ctx, "doc_number")}</p>'
        '<p class="addressee">'
        f'{escape(copy["addressee_prefix"])} {_slot(ctx, "fio")},<br>'
        f'{escape(copy["living"])}<br>{_slot(ctx, "address")}</p>'
        f'<h1>{escape(copy["title"])}</h1>'
        "<p>"
        f'{escape(copy["before_amount"])} {_slot(ctx, "amount")} {escape(copy["after_amount"])} '
        f'{_slot(ctx, "due_days")} {escape(copy["after_days"])} {_slot(ctx, "services")} '
        f'{escape(copy["law"])}</p>'
        f'<p>{escape(copy["p2_before"])} {_slot(ctx, "organization")} {escape(copy["p2_after"])}</p>'
        f'<p class="phone">{escape(copy["phone_label"])} {_slot(ctx, "phone")}</p>'
        '<div class="signs">'
        f'<div><div>{escape(copy["handed"])}</div><div class="sign-line"></div>'
        f'<div class="hint">{escape(copy["handed_sign"])}</div></div>'
        f'<div><div>{escape(copy["received"])}</div><div class="sign-line"></div>'
        f'<div class="hint">{escape(copy["received_sign"])} {_slot(ctx, "fio")}</div></div>'
        "</div>"
        f'<p class="stamp">{escape(copy["stamp"])}</p>'
        "</article>"
    )


def _html_notice(blank: str, ctx: dict) -> str:
    copy = ctx["copy"]
    services = ""
    if blank != "notice-tko":
        services = f'{_slot(ctx, "services")} '
    second = f'<p>{escape(copy["p2"])}</p>' if copy.get("p2") else ""
    return (
        '<article class="page notice">'
        '<p class="addressee">'
        f'{_slot(ctx, "fio")}<br>{_slot(ctx, "address")}</p>'
        f'<h1>{escape(copy["title"])}</h1>'
        "<p>"
        f'{escape(copy["before_amount"])} {services}{escape(copy["mid_amount"])} '
        f'{_slot(ctx, "amount")} {escape(copy["after_amount"])}</p>'
        f"{second}"
        "<p>"
        f'{escape(copy["contact_before"])} {_slot(ctx, "organization")} {escape(copy["contact_mid"])} '
        f'{_slot(ctx, "address_org")} {escape(copy["hours_label"])} {_slot(ctx, "hours")}, '
        f'{escape(copy["phone_label"])} {_slot(ctx, "phone")}.</p>'
        f'{_letterhead(ctx)}'
        f'<p class="meta">{_slot(ctx, "date")}, {escape(copy["out_label"])}{_slot(ctx, "doc_number")}</p>'
        f'<p class="stamp">{escape(copy["stamp"])}</p>'
        "</article>"
    )


def _html_reminder(ctx: dict) -> str:
    copy = ctx["copy"]
    rows = ctx.get("penalty_rows") or []
    body = "".join(
        "<tr>"
        f"<td>{escape(row.get('month') or '')}</td>"
        f"<td class='num'>{escape(row.get('principal') or '')}</td>"
        f"<td class='num'>{escape(row.get('penalty') or '')}</td>"
        "</tr>"
        for row in rows
    )
    if not body:
        body = "<tr><td></td><td></td><td></td></tr>"
    return (
        '<article class="page reminder">'
        f'<p class="meta">{escape(copy["issued"])} {_slot(ctx, "date")}</p>'
        f'<p><span class="lbl">{escape(copy["where"])}</span> {_slot(ctx, "address")}</p>'
        f'<p><span class="lbl">{escape(copy["whom"])}</span> {_slot(ctx, "fio")}</p>'
        "<p>"
        f'{escape(copy["account_label"])} {_slot(ctx, "account")} '
        f'{escape(copy["area_label"])} {_slot(ctx, "area")} {escape(copy["area_unit"])} '
        f'{escape(copy["live_label"])} {_slot(ctx, "residents_count")} {escape(copy["live_unit"])}</p>'
        f'<p>{escape(copy["sender"])} {_slot(ctx, "address_org")}</p>'
        f'<h1>{escape(copy["title"])}</h1>'
        "<p>"
        f'{escape(copy["on_date"])} {_slot(ctx, "as_of")} {escape(copy["debt_text"])} '
        f'{_slot(ctx, "months_debt")}</p>'
        '<table class="sum"><thead><tr>'
        f'<th>{escape(copy["debt"])}</th><th>{escape(copy["mulct"])}</th><th>{escape(copy["grand"])}</th>'
        "</tr></thead><tbody><tr>"
        f'<td class="num">{_slot(ctx, "principal")}</td>'
        f'<td class="num">{_slot(ctx, "penalty")}</td>'
        f'<td class="num">{_slot(ctx, "total")}</td>'
        "</tr></tbody></table>"
        f'<p class="sub">{escape(copy["penalty_title"])}</p>'
        '<table class="grid"><thead><tr>'
        f'<th>{escape(copy["month"])}</th><th>{escape(copy["debt"])}</th><th>{escape(copy["mulct"])}</th>'
        f"</tr></thead><tbody>{body}</tbody></table>"
        "<p>"
        f'{escape(copy["pay_before"])} {_slot(ctx, "due_date")} {escape(copy["pay_after"])}</p>'
        f'<p class="phone">{escape(copy["phone_label"])} {_slot(ctx, "phone")}</p>'
        f'<p>{_slot(ctx, "address_org")}</p>'
        "</article>"
    )


def _html_calculation(ctx: dict) -> str:
    copy = ctx["copy"]
    values = ctx["values"]
    pairs = "".join(_pair_html(pair, copy) for pair in (ctx.get("pairs") or []))
    if not pairs:
        pairs = _pair_html({
            "left_label": "", "right_label": "", "rows": [],
            "l_principal": "", "l_penalty": "", "l_total": "",
            "r_principal": "", "r_penalty": "", "r_total": "",
        }, copy)
    people = "".join(_resident_html(row) for row in (ctx.get("residents") or []))
    if not people:
        people = "<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>"
    return (
        '<article class="page calculation">'
        "<h1>"
        f'{escape(copy["title_before"])} {_slot(ctx, "account")} '
        f'{escape(copy["title_after"])} {_slot(ctx, "as_of")}</h1>'
        f"{_letterhead(ctx)}"
        f'<p>{escape(copy["agent_label"])} {escape(copy["agent"])}</p>'
        f'<p>{escape(copy["bank_label"])} {_slot(ctx, "bank")}</p>'
        "<p>"
        f'{escape(copy["bik_label"])} {_slot(ctx, "bik")} {escape(copy["acc_label"])} {_slot(ctx, "bank_account")}</p>'
        f'<p>{escape(copy["unp_label"])} {_slot(ctx, "unp")}</p>'
        f'<p class="reg">{escape(copy["reg_label"])} {_slot(ctx, "doc_number")}</p>'
        '<table class="payer"><tbody>'
        "<tr>"
        f'<th>{escape(copy["payer"])}</th><td>{_slot(ctx, "fio")}</td>'
        f'<th>{escape(copy["counts"])}</th>'
        f'<td>{_slot(ctx, "registered_count")}/{_slot(ctx, "tenants")}/{_slot(ctx, "beneficiaries")}</td>'
        "</tr><tr>"
        f'<th>{escape(copy["address"])}</th><td>{_slot(ctx, "address")}</td>'
        f'<th>{escape(copy["rooms"])}</th><td>{_slot(ctx, "rooms")}</td>'
        "</tr><tr>"
        f'<th>{escape(copy["ownership"])}</th><td>{_slot(ctx, "ownership")}</td>'
        f'<th>{escape(copy["space"])}</th><td>{_slot(ctx, "area")}/{_slot(ctx, "living_area")}</td>'
        "</tr></tbody></table>"
        f'<p>{escape(copy["duty"])} {_slot(ctx, "duty_from")}</p>'
        f"{pairs}"
        f'<p class="total">{escape(values.get("total_sentence") or "")}</p>'
        f'<p class="sub">{escape(copy["people"])}</p>'
        '<table class="grid people"><thead><tr>'
        f'<th>{escape(copy["arrived"])}</th><th>{escape(copy["left"])}</th>'
        f'<th>{escape(copy["registered"])}</th><th>{escape(copy["ended"])}</th>'
        f'<th>{escape(copy["person"])}</th><th>{escape(copy["birthday"])}</th>'
        f'<th>{escape(copy["relation"])}</th>'
        f"</tr></thead><tbody>{people}</tbody></table>"
        "<p>"
        f'{escape(copy["after_hand"])} {_slot(ctx, "warning_date")} {escape(copy["close"])}</p>'
        '<div class="signs">'
        '<div><div class="sign-line"></div><div class="hint">(должность) (подпись) (И.О.Фамилия)</div></div>'
        '<div><div class="sign-line"></div><div class="hint">(должность) (подпись) (И.О.Фамилия)</div></div>'
        "</div></article>"
    )


def _pair_html(pair: dict, copy: dict) -> str:
    rows = "".join(
        "<tr>"
        f'<td class="name">{escape(row.get("name") or "")}</td>'
        f'<td class="num">{escape(row.get("l_principal") or "")}</td>'
        f'<td class="num">{escape(row.get("l_penalty") or "")}</td>'
        f'<td class="num">{escape(row.get("l_total") or "")}</td>'
        f'<td class="num">{escape(row.get("r_principal") or "")}</td>'
        f'<td class="num">{escape(row.get("r_penalty") or "")}</td>'
        f'<td class="num">{escape(row.get("r_total") or "")}</td>'
        "</tr>"
        for row in pair.get("rows") or []
    )
    return (
        '<table class="grid calc"><thead>'
        "<tr>"
        f'<th rowspan="2">{escape(copy["service"])}</th>'
        f'<th colspan="3">{escape(pair.get("left_label") or "")}</th>'
        f'<th colspan="3">{escape(pair.get("right_label") or "")}</th>'
        "</tr><tr>"
        f'<th>{escape(copy["col_debt"])}</th><th>{escape(copy["col_mulct"])}</th><th>{escape(copy["col_all"])}</th>'
        f'<th>{escape(copy["col_debt"])}</th><th>{escape(copy["col_mulct"])}</th><th>{escape(copy["col_all"])}</th>'
        "</tr></thead><tbody>"
        f"{rows}"
        "<tr class='sum'>"
        f'<td>{escape(copy["row_total"])}</td>'
        f'<td class="num">{escape(pair.get("l_principal") or "")}</td>'
        f'<td class="num">{escape(pair.get("l_penalty") or "")}</td>'
        f'<td class="num">{escape(pair.get("l_total") or "")}</td>'
        f'<td class="num">{escape(pair.get("r_principal") or "")}</td>'
        f'<td class="num">{escape(pair.get("r_penalty") or "")}</td>'
        f'<td class="num">{escape(pair.get("r_total") or "")}</td>'
        "</tr></tbody></table>"
    )


def _resident_html(row: dict) -> str:
    cells = ("arrived", "left", "registered", "ended", "fio", "birthday", "relation")
    return "<tr>" + "".join(f"<td>{escape(str(row.get(key) or ''))}</td>" for key in cells) + "</tr>"


def _letterhead(ctx: dict) -> str:
    return (
        '<header class="letterhead"><div>Республика Беларусь</div>'
        f'<div class="org">{_slot(ctx, "organization")}</div>'
        f'<div>{_slot(ctx, "locality")}</div></header>'
    )


def _slot(ctx: dict, key: str) -> str:
    value = str((ctx.get("values") or {}).get(key) or "").strip()
    if not value or value == "—":
        return '<span class="slot empty">&nbsp;</span>'
    return f'<span class="slot">{escape(value)}</span>'


def _wrap(body: str) -> str:
    return (
        '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
        f"<style>{_CSS}</style></head><body>{body}</body></html>"
    )


def _copy(blank: str) -> dict:
    shared = {"country": "Республика Беларусь"}
    if blank == "warning":
        return {
            **shared,
            "title": "ПРЕДУПРЕЖДЕНИЕ",
            "addressee_prefix": "гр.",
            "living": "проживающему по адресу",
            "before_amount": "В связи с наличием у Вас задолженности по жилищно-коммунальным услугам в размере",
            "after_amount": "руб. и в случае неоплаты данной суммы в течение",
            "after_days": _WARNING_AFTER,
            "law": _WARNING_LAW,
            "p2_before": _WARNING_P2_BEFORE,
            "p2_after": _WARNING_P2_AFTER,
            "phone_label": "По имеющимся вопросам обращайтесь по тел.",
            "handed": "Предупреждение вручил",
            "handed_sign": "Ф.И.О. (подпись)",
            "received": "Предупреждение получил",
            "received_sign": "(подпись)",
            "stamp": "Печать",
        }
    if blank == "reminder":
        return {
            **shared,
            "title": "НАПОМИНАНИЕ",
            "issued": "Дата, время выдачи:",
            "where": "Куда:",
            "whom": "Кому:",
            "account_label": "Лицевой счет",
            "area_label": "Общая площадь",
            "area_unit": "м.кв.",
            "live_label": "Проживает",
            "live_unit": "чел.",
            "sender": "Индекс предприятия связи и адрес отправителя:",
            "on_date": "На",
            "debt_text": "за Вами числится задолженность за коммунальные услуги, количество месяцев долга:",
            "debt": "Долг",
            "mulct": "Пени",
            "grand": "ИТОГО",
            "penalty_title": "Расчет пени",
            "month": "Месяц год",
            "pay_before": "Вам надлежит до",
            "pay_after": "погасить задолженность, иначе удержание оплаты будет передано в суд.",
            "phone_label": "тел.",
        }
    if blank == "calculation":
        return {
            **shared,
            "title_before": "Расчёт задолженности по лицевому счету №",
            "title_after": "по состоянию на",
            "agent_label": "Организация, осуществляющая перечисление платы Исполнителям услуг:",
            "agent": "ОАО «НКФО «ЕРИП»",
            "bank_label": "Банк:",
            "bik_label": "БИК банка:",
            "acc_label": "Счет:",
            "unp_label": "УНП бенефициара:",
            "reg_label": "РЕГ. №",
            "payer": "Плательщик жилищно-коммунальных услуг",
            "counts": "Количество (зарегистрированных / нанимателей / льготников)",
            "address": "Адрес",
            "rooms": "Количество комнат",
            "ownership": "Тип собственности",
            "space": "Площадь общая/жилая, кв.м",
            "duty": "Обязанность по внесению платы за жилищно-коммунальные услуги возникла с",
            "service": "Наименование услуги",
            "col_debt": "Долг по услуге",
            "col_mulct": "Долг по пени",
            "col_all": "Всего с пеней",
            "row_total": "Итого",
            "people": "Сведения о совершеннолетних гражданах, зарегистрированных по месту жительства",
            "arrived": "Дата прибытия",
            "left": "Дата и куда выбыл",
            "registered": "Дата регистрации",
            "ended": "Дата окончания регистрации",
            "person": "Фамилия, имя, отчество",
            "birthday": "Дата рождения",
            "relation": "Родственные либо брачные отношения",
            "after_hand": "После вручения",
            "close": _CALC_CLOSE,
        }
    second = {"notice-137": _NOTICE_137, "notice-80": _NOTICE_80, "notice-86": _NOTICE_86}.get(blank, "")
    before = (
        "В связи с наличием у Вас задолженности по услуге обращения с твердыми коммунальными отходами в сумме"
        if blank == "notice-tko"
        else "В связи с наличием у Вас задолженности по"
    )
    mid = "" if blank == "notice-tko" else "в сумме"
    return {
        **shared,
        "title": "УВЕДОМЛЕНИЕ",
        "before_amount": before,
        "mid_amount": mid,
        "after_amount": _NOTICE_TAIL,
        "p2": second,
        "contact_before": "По имеющимся вопросам обращаться в",
        "contact_mid": "по адресу:",
        "hours_label": "время работы",
        "phone_label": "телефон",
        "out_label": "исх. №",
        "stamp": "М.П.",
    }


def _organization_bits(account) -> tuple[str, str, str, str, str, str]:
    from apps.users.models import ServiceOrganization

    org = account.organization
    row = ServiceOrganization.objects.filter(organization_id=org.id, provider_id=account.provider_id).first()
    if row is not None and (row.full_name or row.short_name):
        letterhead = row.full_name or row.short_name
    else:
        letterhead = account.provider_short_name or org.name
    profile = org.pris_claimant or {}
    return (
        letterhead,
        str(profile.get("np") or ""),
        str(profile.get("full_adr") or ""),
        org.unp or "",
        str(profile.get("bank_code") or ""),
        str(profile.get("acc_num") or ""),
    )


def _period_groups(account) -> list[dict]:
    rows = list(
        account.debt_periods.select_related("service").order_by("period", "service__sort_code", "service__service_name")
    )
    if rows:
        grouped: dict = {}
        for row in rows:
            bucket = grouped.setdefault(row.period, {"period": row.period, "due": row.due_on, "lines": []})
            principal = row.principal or Decimal("0")
            penalty = row.penalty or Decimal("0")
            bucket["lines"].append({
                "name": row.service.service_name or str(row.service.service_id),
                "principal": money_text(principal),
                "penalty": money_text(penalty),
                "total": money_text(principal + penalty),
                "_principal": principal,
                "_penalty": penalty,
            })
        groups = []
        for period in sorted(grouped):
            bucket = grouped[period]
            principal = sum((line["_principal"] for line in bucket["lines"]), Decimal("0"))
            penalty = sum((line["_penalty"] for line in bucket["lines"]), Decimal("0"))
            groups.append({
                "label": _period_label(bucket["period"], bucket["due"]),
                "services": [
                    {"name": line["name"], "principal": line["principal"], "penalty": line["penalty"], "total": line["total"]}
                    for line in bucket["lines"]
                ],
                "principal": money_text(principal),
                "penalty": money_text(penalty),
                "total": money_text(principal + penalty),
            })
        return groups
    lines = []
    principal_sum = Decimal("0")
    penalty_sum = Decimal("0")
    for service in account.services.all():
        if service.balance_out is None and service.balance_mulct_out is None:
            continue
        penalty = service.balance_mulct_out or Decimal("0")
        outgoing = service.balance_out or Decimal("0")
        principal = outgoing - penalty
        if principal == 0 and penalty == 0:
            continue
        principal_sum += principal
        penalty_sum += penalty
        lines.append({
            "name": service.service_name or str(service.service_id),
            "principal": money_text(principal),
            "penalty": money_text(penalty),
            "total": money_text(principal + penalty),
        })
    if not lines:
        return []
    return [{
        "label": "текущая задолженность",
        "services": lines,
        "principal": money_text(principal_sum),
        "penalty": money_text(penalty_sum),
        "total": money_text(principal_sum + penalty_sum),
    }]


def _residents(account) -> list[dict]:
    today = date.today()
    rows = []
    for person in account.registrations.all():
        if person.subj_is_check_out:
            continue
        if person.birthday and _age(person.birthday, today) < 18:
            continue
        rows.append({
            "arrived": _date(person.check_in_date),
            "left": _date(person.check_out_date),
            "registered": _date(person.date_registration),
            "ended": "",
            "fio": " ".join(part for part in (person.fam, person.im, person.ot) if part),
            "birthday": _date(person.birthday),
            "relation": person.relation_degree_name or person.payer_type_name or "",
        })
    return rows


def _tko_amount(account) -> str:
    total = Decimal("0")
    found = False
    for service in account.services.all():
        name = (service.service_name or "").lower()
        if "отход" not in name and "тко" not in name:
            continue
        found = True
        if service.balance_out is not None:
            total += service.balance_out
    return money_text(total) if found else ""


def _sum_pairs(pairs: list[dict]) -> tuple[Decimal, Decimal]:
    principal = Decimal("0")
    penalty = Decimal("0")
    for pair in pairs:
        principal += _dec(pair.get("l_principal")) or Decimal("0")
        principal += _dec(pair.get("r_principal")) or Decimal("0")
        penalty += _dec(pair.get("l_penalty")) or Decimal("0")
        penalty += _dec(pair.get("r_penalty")) or Decimal("0")
    return principal, penalty


def _apply_overrides(ctx: dict, overrides: dict | None) -> None:
    if not isinstance(overrides, dict):
        return
    for key in EDITABLE:
        if key not in overrides:
            continue
        text = str(overrides.get(key) or "").strip()
        if text:
            ctx["values"][key] = text[:500]


def _pair(left: dict, right: dict | None) -> dict:
    right = right or {"label": "", "services": [], "principal": "", "penalty": "", "total": ""}
    names = []
    left_map = {}
    right_map = {}
    for row in left.get("services") or []:
        names.append(row["name"])
        left_map[row["name"]] = row
    for row in right.get("services") or []:
        if row["name"] not in left_map:
            names.append(row["name"])
        right_map[row["name"]] = row
    rows = []
    for name in names:
        one = left_map.get(name) or {}
        two = right_map.get(name) or {}
        rows.append({
            "name": name,
            "l_principal": one.get("principal") or "",
            "l_penalty": one.get("penalty") or "",
            "l_total": one.get("total") or "",
            "r_principal": two.get("principal") or "",
            "r_penalty": two.get("penalty") or "",
            "r_total": two.get("total") or "",
        })
    return {
        "left_label": left.get("label") or "",
        "right_label": right.get("label") or "",
        "rows": rows,
        "l_principal": left.get("principal") or "",
        "l_penalty": left.get("penalty") or "",
        "l_total": left.get("total") or "",
        "r_principal": right.get("principal") or "",
        "r_penalty": right.get("penalty") or "",
        "r_total": right.get("total") or "",
    }


def _period_label(period, due) -> str:
    title = f"{_MONTHS[period.month]} {period.year}"
    if due:
        return f"период долга (срок оплаты): {title} ({_date(due)})"
    return f"период долга (срок оплаты): {title}"


def _words_money(text: str) -> str:
    number = _dec(str(text).replace(" ", "").replace(",", "."))
    if number is None:
        return ""
    whole = abs(int(number))
    kopecks = abs(int((abs(number).quantize(Decimal("0.01")) * 100) % 100))
    return f"{words_int(whole)} бел.руб. {kopecks:02d} коп."


def _chunk(number: int, feminine: bool) -> str:
    hundreds, rest = divmod(number, 100)
    parts = []
    if hundreds:
        parts.append(_HUNDREDS[hundreds])
    if 10 <= rest <= 19:
        parts.append(_TEENS[rest - 10])
    else:
        tens, ones = divmod(rest, 10)
        if tens:
            parts.append(_TENS[tens])
        if ones:
            parts.append(_ONES[ones][1 if feminine else 0])
    return " ".join(parts)


def _plural(number: int, one: str, few: str, many: str) -> str:
    tail = abs(number) % 100
    if 11 <= tail <= 14:
        return many
    tail = tail % 10
    if tail == 1:
        return one
    if 2 <= tail <= 4:
        return few
    return many


def _dec(value):
    if value is None or value == "" or value == "—":
        return None
    try:
        return Decimal(str(value).replace(" ", "").replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def _date(value) -> str:
    if not value:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%d.%m.%Y")
    text = str(value).strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        year, month, day = text[:10].split("-")
        return f"{day}.{month}.{year}"
    return text


def _age(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _clean(value) -> str:
    text = "" if value is None else str(value).strip()
    return "" if text == "—" else text


_VALUE_KEYS = (
    "organization", "locality", "address_org", "phone", "hours", "date", "doc_number",
    "fio", "address", "account", "amount", "penalty", "principal", "total", "services",
    "due_days", "months_debt", "as_of", "due_date", "area", "living_area", "rooms",
    "residents_count", "registered_count", "tenants", "beneficiaries", "ownership",
    "duty_from", "unp", "bank", "bik", "bank_account", "warning_date", "debt_started",
    "total_sentence",
)
