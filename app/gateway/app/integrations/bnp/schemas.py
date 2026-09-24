"""Манифест заявления о совершении исполнительной надписи для ЛК БНП («json описание полей.docx»).

Правила: JSON в UTF-8; personType natural/legal/sole_trader с условной обязательностью полей;
personalId — структура личного номера РБ (14 символов, латинские прописные); unp — 9 цифр;
amount — строка с разделителем «.» и двумя знаками; даты YYYY-MM-DD; serviceId/typeId/docType —
из справочников БНП. Документы принимаются только в .pdf и не более 15 МБ (инструкция ЛК).
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .dictionaries import load_dictionaries

PERSONAL_ID_RE = re.compile(r"^\d{7}[A-Z]\d{3}[A-Z]{2}\d$")
UNP_RE = re.compile(r"^\d{9}$")
AMOUNT_RE = re.compile(r"^\d+\.\d{2}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
EMAIL_RE = re.compile(r"^[^@\s,]+@[^@\s,]+\.[^@\s,]+$")
MAX_FILE_BYTES = 15 * 1024 * 1024


def iso_date(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("дата в формате YYYY-MM-DD") from exc
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("дата в формате YYYY-MM-DD")
    return value


class BnpModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class Debtor(BnpModel):
    person_type: Literal["natural", "legal", "sole_trader"] = Field(alias="personType")
    personal_id: str | None = Field(default=None, alias="personalId", max_length=14)
    second_name: str | None = Field(default=None, alias="secondName")
    first_name: str | None = Field(default=None, alias="firstName")
    middle_name: str | None = Field(default=None, alias="middleName")
    unp: str | None = Field(default=None, max_length=9)
    reg_number: str | None = Field(default=None, alias="regNumber")
    reg_name: str | None = Field(default=None, alias="regName")

    @field_validator("personal_id")
    @classmethod
    def personal_id_structure(cls, value):
        if value is not None and not PERSONAL_ID_RE.fullmatch(value):
            raise ValueError("личный номер: 14 символов, структура 7 цифр + буква + 3 цифры + 2 буквы + цифра")
        return value

    @field_validator("unp")
    @classmethod
    def unp_structure(cls, value):
        if value is not None and not UNP_RE.fullmatch(value):
            raise ValueError("УНП: 9 цифр")
        return value

    @model_validator(mode="after")
    def required_by_person_type(self):
        required = {
            "natural": ("personal_id", "second_name", "first_name", "middle_name"),
            "sole_trader": ("personal_id", "second_name", "first_name", "middle_name", "unp"),
            "legal": ("unp", "reg_number", "reg_name"),
        }[self.person_type]
        fields = type(self).model_fields
        missing = [fields[f].alias or f for f in required if not getattr(self, f)]
        if missing:
            raise ValueError(f"для personType={self.person_type} обязательны: {', '.join(missing)}")
        return self


class Debt(BnpModel):
    description: str | None = None
    start_date: str | None = Field(default=None, alias="startDate")
    end_date: str | None = Field(default=None, alias="endDate")
    date_at: str | None = Field(default=None, alias="dateAt")
    amount: str
    currency: str
    type_id: str | None = Field(default=None, alias="typeId")

    @field_validator("start_date", "end_date", "date_at")
    @classmethod
    def dates_iso(cls, value):
        return iso_date(value)

    @field_validator("amount")
    @classmethod
    def amount_format(cls, value):
        if not AMOUNT_RE.fullmatch(value):
            raise ValueError("сумма строкой с разделителем «.» и двумя знаками, например 10.00")
        return value

    @field_validator("currency")
    @classmethod
    def currency_code(cls, value):
        if not CURRENCY_RE.fullmatch(value):
            raise ValueError("буквенный код валюты, например BYN")
        return value

    @field_validator("type_id")
    @classmethod
    def known_type(cls, value):
        if value is not None and value not in load_dictionaries().debt_types:
            raise ValueError(f"тип задолженности {value} отсутствует в справочнике БНП")
        return value

    @model_validator(mode="after")
    def conditional_fields(self):
        if not self.type_id and not self.description:
            raise ValueError("укажите typeId или description")
        has_period = bool(self.start_date and self.end_date)
        if not has_period and not self.date_at:
            raise ValueError("укажите startDate и endDate либо dateAt")
        if has_period and self.start_date > self.end_date:
            raise ValueError("startDate позже endDate")
        return self


class Doc(BnpModel):
    file_name: str = Field(alias="fileName", min_length=1)
    signature_name: str = Field(alias="signatureName", min_length=1)
    doc_type: str = Field(alias="docType")
    detached_sign: bool = Field(alias="detachedSign")

    @field_validator("file_name")
    @classmethod
    def pdf_only(cls, value):
        if not value.lower().endswith(".pdf"):
            raise ValueError("принимаются только документы .pdf")
        return value

    @field_validator("doc_type")
    @classmethod
    def known_doc_type(cls, value):
        if value not in load_dictionaries().doc_types:
            raise ValueError(f"тип документа {value} отсутствует в справочнике БНП")
        return value


class Application(BnpModel):
    external_id: str = Field(alias="externalId", min_length=1)
    contact_data: str = Field(alias="contactData", min_length=1)
    notification_email: str = Field(alias="notificationE-mail")
    user_message: str = Field(alias="userMessage")
    service_id: int = Field(alias="serviceId")
    debtors: list[Debtor] = Field(min_length=1)
    debts: list[Debt] = Field(min_length=1)
    docs: list[Doc] = Field(min_length=1)

    @field_validator("notification_email")
    @classmethod
    def emails(cls, value):
        items = [e.strip() for e in value.split(",")]
        if not items or not all(EMAIL_RE.fullmatch(e) for e in items):
            raise ValueError("e-mail для уведомлений; несколько — через запятую")
        return value

    @model_validator(mode="after")
    def service_and_debt_types(self):
        dictionaries = load_dictionaries()
        if self.service_id not in dictionaries.services:
            raise ValueError(f"serviceId {self.service_id} отсутствует в справочнике услуг БНП")
        allowed = dictionaries.allowed_debt_types(self.service_id)
        wrong = [d.type_id for d in self.debts if d.type_id and allowed and d.type_id not in allowed]
        if wrong:
            raise ValueError(f"типы задолженности {', '.join(wrong)} недопустимы для serviceId {self.service_id}")
        return self


class BnpManifest(BnpModel):
    version: int = Field(ge=1)
    applications: list[Application] = Field(min_length=1)

    def referenced_files(self) -> set[str]:
        return {name for a in self.applications for d in a.docs for name in (d.file_name, d.signature_name)}
