"""Контракты АИС ПРИС по «Регламенту подключения к сервисам АИС ПРИС» (Информация по интеграции).

Имена полей совпадают с JSON регламента. Суммы в примерах регламента встречаются и строкой
("211.24", "85,5"), и числом — поэтому тип Money = str | float.
"""

from __future__ import annotations

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

Money = str | float | int


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
    p_cl_num: str = Field(description="Идентификатор задолженности в системе взыскателя")
    p_opi: str = Field(description="ОПИ (справочник 120)")
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
        is_person = bool(self.p_d_surname.strip())
        is_firm = bool(self.p_d_firm_name.strip())
        if not (is_person or is_firm):
            raise ValueError("Должник: укажите ФИО (физлицо) или наименование (юрлицо)")
        if is_person and not (self.p_d_first_name.strip() and self.p_d_country.strip() and self.p_d_idf_num.strip()):
            raise ValueError("Должник-физлицо: обязательны имя, страна гражданства и идентификационный номер")
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


class DocFile(PrisModel):
    file_body: str = Field(description="PDF в base64 (без расширения .sgn)")
    file_ecp: str = Field(description="ЭЦП в base64")


class Document(PrisModel):
    p_doc_code: str = Field(description="Вид исполнительного документа (справочник 201)")
    p_doc_date: str
    p_doc_num: str
    p_doc_org_code: str = Field(description="Орган, выдавший документ (справочник 217)")
    p_doc_org: str
    p_doc_date_in: str
    p_files: list[DocFile] = Field(min_length=1)


class SaveDataDebtItem(PrisModel):
    identif: Identif
    debtor: Debtor
    claimant: Claimant
    documents: list[Document] = Field(min_length=1)


class SaveDataDebtRequest(PrisModel):
    package: list[SaveDataDebtItem] = Field(min_length=1)


# ---------------------------------------------------------------- 3.4 PutClaimantSaveRepayDebt

class Repayment(PrisModel):
    p_pay_date: str
    p_pay_num: str
    p_pay_sum: Money
    p_pay_curr: str | int = "933"


class RepayItem(PrisModel):
    p_cl_num: str
    p_status: str
    p_req_init: str
    req_arr: list[ArrSum] = Field(default_factory=list)
    repayment: list[Repayment] = Field(default_factory=list, validation_alias=AliasChoices("repayment", "Repayment"))


class SaveRepayRequest(PrisModel):
    package: list[RepayItem] = Field(min_length=1, validation_alias=AliasChoices("package", "Package"))


# ---------------------------------------------------------------- 3.1 / 3.2 запросы сведений

class ByProcNumRequest(PrisModel):
    p_proc_num: str


class ByNumDebtRequest(PrisModel):
    p_cl_num: str = ""
    p_proc_num: str = ""
    p_date_from: str = ""
    p_date_to: str = ""
    p_response_id: str = ""


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
