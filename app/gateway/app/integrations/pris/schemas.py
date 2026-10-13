"""Контракты АИС ПРИС по «Регламенту подключения к сервисам АИС ПРИС» (Информация по интеграции).

Имена полей совпадают с JSON регламента. Суммы в примерах регламента встречаются и строкой
("211.24", "85,5"), и числом — поэтому тип Money = str | float.
"""

from __future__ import annotations

import re

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

Money = str | float | int
_DATE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
# 1000 — данные получены, 1001 — данные в обработке. Остальные коды регламента — отказ,
# даже если конверт пришёл с code "1" (так в примерах 1004 и 1013).
ACCEPTED_PROCESS = {1000, 1001}
_PERSON_ADDRESS = ("country", "np_type", "np", "house")
_FIRM_ADDRESS = ("full_adr", "country", "np_type", "np", "house")


def _filled(value) -> bool:
    return bool(str(value or "").strip())


def _missing(obj, names: tuple[str, ...]) -> list[str]:
    return [name for name in names if not _filled(getattr(obj, name))]


class PrisModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


# ---------------------------------------------------------------- общие

class Envelope(PrisModel):
    """Конверт ответа бизнес-сервисов: code "1" — успех, "0" — ошибка бизнес-логики."""

    code: str
    data: list = Field(default_factory=list)
    message: str = ""
    tag: str = ""

    @property
    def ok(self) -> bool:
        return self.code == "1"

    def put_rejection(self) -> str:
        """Пустая строка — пакет принят. Иначе текст отказа, включая code "1" с processStatus ≠ 1000/1001."""
        if not self.ok:
            return self.message or self.tag or "ошибка бизнес-логики"
        found = False
        notes: list[str] = []
        for raw in self.data:
            if not isinstance(raw, dict) or not ({"processStatus", "process_status"} & set(raw)):
                continue
            found = True
            item = ProcessItem.model_validate(raw)
            if item.status_code not in ACCEPTED_PROCESS:
                notes.append(f"{item.status_code}: {item.process_message or 'отклонено'}")
        if not found:
            return "в ответе нет processStatus"
        return "; ".join(notes)


class ProcessItem(PrisModel):
    """Элемент data[] у PutClaimantSaveDataDebt и PutClaimantSaveRepayDebt."""

    response_id: str = Field(default="", validation_alias=AliasChoices("responseId", "responseId "))
    process_status: int | str = Field(default=0, validation_alias=AliasChoices("processStatus", "process_status"))
    process_message: str = Field(default="", validation_alias=AliasChoices("processMessage", "process_message"))

    @property
    def status_code(self) -> int | None:
        try:
            return int(str(self.process_status).strip())
        except (TypeError, ValueError):
            return None


class AuthorizeResponse(PrisModel):
    x_token: str = Field(alias="x-token")
    x_timestamp: str = Field(alias="x-timestamp")
    message: str = ""


class Address(PrisModel):
    full_adr: str = ""
    country: str = ""
    region: str = ""
    area: str = ""
    np_type: str = ""
    np: str = ""
    street_type: str = ""
    street: str = ""
    house: str = ""
    corp: str = ""
    flat: str = ""
    post_index: str = ""


class Phone(PrisModel):
    phone: str = Field(default="", validation_alias=AliasChoices("phone", "Phone"))


class Email(PrisModel):
    email: str = ""


class ArrSum(PrisModel):
    p_price: Money
    p_curr_code: str | int = "933"  # 933 — белорусский рубль (ОКРБ «Валюты»)
    p_rest_sum: Money


# ---------------------------------------------------------------- 3.3 PutClaimantSaveDataDebt

class Identif(PrisModel):
    p_cl_num: str = Field(min_length=1, description="Идентификатор задолженности в системе взыскателя")
    p_opi: str = Field(min_length=1, description="ОПИ (справочник 120)")
    p_solidar_num: str | None = ""


class Debtor(PrisModel):
    p_d_country: str = ""
    p_d_surname: str = ""
    p_d_first_name: str = ""
    p_d_father_name: str = ""
    p_d_date_reg: str = ""
    p_d_idf_num: str = ""
    p_d_adr_reg: Address = Field(default_factory=Address)
    p_d_adr_fact: Address = Field(default_factory=Address)
    p_d_unp_work: str = ""
    p_d_phones: list[Phone] = Field(default_factory=list)
    p_d_emails: list[Email] = Field(default_factory=list)
    p_d_firm_name: str = ""
    p_d_opf: str = ""
    p_d_reg_num: str = ""
    p_d_firm_adr: Address = Field(default_factory=Address)
    p_r_req_init: str = Field(description="Требование (справочник)")
    p_arr_sum: list[ArrSum] = Field(min_length=1)

    @model_validator(mode="after")
    def person_or_firm(self):
        is_person = _filled(self.p_d_surname)
        is_firm = _filled(self.p_d_firm_name)
        if is_person == is_firm:
            raise ValueError("Должник: укажите либо ФИО физического лица, либо наименование юридического лица")
        errors: list[str] = []
        if is_person:
            errors += [f"должник: {name}" for name in _missing(self, ("p_d_first_name", "p_d_country", "p_d_date_reg"))]
            if _filled(self.p_d_date_reg) and not _DATE.match(self.p_d_date_reg.strip()):
                errors.append("должник: p_d_date_reg в формате ДД.ММ.ГГГГ")
            if self.p_d_country.strip() == "112" and not _filled(self.p_d_idf_num):
                errors.append("должник-гражданин Беларуси: p_d_idf_num")
            errors += [f"адрес регистрации должника: {name}" for name in _missing(self.p_d_adr_reg, _PERSON_ADDRESS)]
            if not (_filled(self.p_d_adr_reg.full_adr) or _filled(self.p_d_adr_reg.region)):
                errors.append("адрес регистрации должника: full_adr или region")
        else:
            errors += [f"должник-юрлицо: {name}" for name in _missing(self, ("p_d_opf", "p_d_reg_num"))]
            errors += [f"адрес должника-юрлица: {name}" for name in _missing(self.p_d_firm_adr, _FIRM_ADDRESS)]
        if errors:
            raise ValueError("; ".join(errors))
        return self


class Claimant(PrisModel):
    p_c_country: str = ""
    p_c_surname: str = ""
    p_c_first_name: str = ""
    p_c_father_name: str = ""
    p_c_date_reg: str = ""
    p_c_idf_num: str = ""
    p_c_adr_reg: Address = Field(default_factory=Address)
    p_c_adr_fact: Address = Field(default_factory=Address)
    p_c_unp_work: str = ""
    p_c_phones: list[Phone] = Field(default_factory=list)
    p_c_emails: list[Email] = Field(default_factory=list)
    p_c_firm_name: str = ""
    p_c_opf: str = ""
    p_c_reg_num: str = ""
    p_c_firm_adr: Address = Field(default_factory=Address)
    p_b_unp: str = ""
    p_b_bank_code: str = ""
    p_b_acc_num: str = ""
    p_b_curr_code: str = "933"
    p_b_acc_type: str = ""
    p_b_budjet_code: str = ""
    p_b_lic_acc: str = ""

    @model_validator(mode="after")
    def claimant_ready(self):
        is_person = _filled(self.p_c_surname)
        is_firm = _filled(self.p_c_firm_name)
        if is_person == is_firm:
            raise ValueError("Взыскатель: укажите либо ФИО, либо наименование организации")
        errors = [f"счёт взыскателя: {name}" for name in _missing(
            self, ("p_b_unp", "p_b_bank_code", "p_b_acc_num", "p_b_curr_code", "p_b_acc_type"),
        )]
        if is_person:
            errors += [f"взыскатель: {name}" for name in _missing(
                self, ("p_c_first_name", "p_c_father_name", "p_c_country", "p_c_date_reg"),
            )]
            if self.p_c_country.strip() == "112" and not _filled(self.p_c_idf_num):
                errors.append("взыскатель-гражданин Беларуси: p_c_idf_num")
            errors += [f"адрес взыскателя: {name}" for name in _missing(self.p_c_adr_reg, _PERSON_ADDRESS)]
        else:
            errors += [f"взыскатель: {name}" for name in _missing(self, ("p_c_opf", "p_c_reg_num"))]
            errors += [f"адрес взыскателя: {name}" for name in _missing(self.p_c_firm_adr, _FIRM_ADDRESS)]
        if errors:
            raise ValueError("; ".join(errors))
        return self


class DocFile(PrisModel):
    file_body: str = Field(min_length=8, description="PDF в base64 (без расширения .sgn)")
    file_ecp: str = Field(min_length=8, description="ЭЦП в base64")


class Document(PrisModel):
    p_doc_code: str = Field(min_length=1, description="Вид исполнительного документа (справочник 201)")
    p_doc_date: str
    p_doc_num: str = Field(min_length=1)
    p_doc_org_code: str = Field(min_length=1, description="Орган, выдавший документ (справочник 217)")
    p_doc_org: str = Field(min_length=1)
    p_doc_date_in: str
    p_files: list[DocFile] = Field(min_length=1)

    @model_validator(mode="after")
    def dates(self):
        for name in ("p_doc_date", "p_doc_date_in"):
            if not _DATE.match(str(getattr(self, name) or "").strip()):
                raise ValueError(f"{name} в формате ДД.ММ.ГГГГ")
        return self


class DocFileWofe(PrisModel):
    """PutClaimantSaveDataDebtWOFE: file_body — .sgn в base64, file_ecp — имя исходного файла."""

    file_body: str = Field(min_length=8)
    file_ecp: str

    @model_validator(mode="after")
    def filename(self):
        name = self.file_ecp.strip()
        if len(name) > 180 or any(char in name for char in '\\/:*?"<>|') or "." not in name:
            raise ValueError("file_ecp — имя файла, например test.pdf")
        return self


class DocumentWofe(Document):
    p_files: list[DocFileWofe] = Field(min_length=1)


class SaveDataDebtItem(PrisModel):
    identif: Identif
    debtor: Debtor
    claimant: Claimant
    documents: list[Document] = Field(min_length=1)


class SaveDataDebtRequest(PrisModel):
    package: list[SaveDataDebtItem] = Field(min_length=1)


class SaveDataDebtWofeItem(SaveDataDebtItem):
    documents: list[DocumentWofe] = Field(min_length=1)


class SaveDataDebtWofeRequest(PrisModel):
    package: list[SaveDataDebtWofeItem] = Field(min_length=1)


# ---------------------------------------------------------------- 3.4 PutClaimantSaveRepayDebt

class Repayment(PrisModel):
    p_pay_date: str
    p_pay_num: str = Field(min_length=1)
    p_pay_sum: Money
    p_pay_curr: str | int = "933"

    @model_validator(mode="after")
    def pay_date(self):
        if not _DATE.match(self.p_pay_date.strip()):
            raise ValueError("p_pay_date в формате ДД.ММ.ГГГГ")
        return self


class RepayItem(PrisModel):
    p_cl_num: str = Field(min_length=1)
    p_status: str
    p_req_init: str = Field(min_length=1)
    req_arr: list[ArrSum] = Field(default_factory=list)
    repayment: list[Repayment] = Field(default_factory=list, validation_alias=AliasChoices("repayment", "Repayment"))

    @model_validator(mode="after")
    def status_code(self):
        if self.p_status.strip() not in {"1", "2", "3", "4"}:
            raise ValueError("p_status: 1 активно, 2 частично исполнено, 3 исполнено, 4 прекращено без исполнения")
        return self


class SaveRepayRequest(PrisModel):
    package: list[RepayItem] = Field(min_length=1, validation_alias=AliasChoices("package", "Package"))


# ---------------------------------------------------------------- 3.1 / 3.2 запросы сведений

class ByProcNumRequest(PrisModel):
    p_proc_num: str = Field(min_length=1)

    def pris_body(self) -> dict:
        return {"p_proc_num": self.p_proc_num.strip()}


class ByNumDebtRequest(PrisModel):
    p_cl_num: str = ""
    p_proc_num: str = ""
    p_date_from: str = ""
    p_date_to: str = ""
    p_response_id: str = ""

    @model_validator(mode="after")
    def has_identifier(self):
        if not _filled(self.p_cl_num) and not _filled(self.p_proc_num):
            raise ValueError("Нужен p_cl_num или p_proc_num")
        return self

    def pris_body(self) -> dict:
        """Пустой p_proc_num в регламенте падает: сервер ждёт Int64 и не принимает \"\"."""
        body = {}
        for name in ("p_cl_num", "p_proc_num", "p_date_from", "p_date_to", "p_response_id"):
            value = str(getattr(self, name) or "").strip()
            if value:
                body[name] = value
        return body


class ClaimantInfo(PrisModel):
    """Сведения об исполнительном производстве (элемент data[] ответов 3.1 / 3.2)."""

    p_ispdoc: list[dict] = Field(default_factory=list)
    p_ost: list[dict] = Field(default_factory=list)
    p_cred: list[dict] = Field(default_factory=list)
    p_debt: list[dict] = Field(default_factory=list)
    p_status: list[dict] = Field(default_factory=list)
    p_action: list[dict] = Field(default_factory=list)
    p_nachisl: list[dict] = Field(default_factory=list)
    p_repay: list[dict] = Field(default_factory=list)

    @property
    def actual_status(self) -> dict | None:
        return next((s for s in self.p_status if str(s.get("actual")) == "1"), None)
