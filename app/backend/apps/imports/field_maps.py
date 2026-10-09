"""Сопоставление колонок выгрузок АИС с полями моделей.

Источник — спецификации «Примеры данных/*.csv» (COLUMN_NAME;DATA_TYPE;COMMENTS;MODULE_NAME).
В спецификациях одно имя колонки может встречаться несколько раз (ACCOUNT_ID, ATTR_VALUE,
FULL_NAME, CLIENT_ACCOUNT): такие колонки различаются по COMMENTS и порядку следования —
k-е вхождение имени в файле данных соответствует k-й записи с этим именем ниже.
Отчёт с русскими заголовками сопоставляется по header_aliases.py, а не по порядку колонок.
Колонки, не вынесенные в поля (field=None или отсутствующие в карте), сохраняются в raw.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from apps.debts.models import Account, AccountService, Payment, Registration

from .header_aliases import HEADER_ALIASES

ACCOUNT_LOOKUP = "_account_id"  # служебное поле: ACCOUNT_ID родительского ЛС


@dataclass(frozen=True)
class FieldSpec:
    column: str
    field: str | None
    kind: str = "str"  # str | int | dec | date | bool | months | payment_type
    comment: str = ""  # фрагмент COMMENTS — для колонок-дублей
    header: str | None = None  # имя колонки в файле данных, если COLUMN_NAME пуст
    aliases: tuple[str, ...] = ()  # русские заголовки отчёта АИС, помимо COLUMN_NAME

    @property
    def file_header(self) -> str:
        return self.header or self.column

    def lookup_names(self) -> tuple[str, ...]:
        return tuple(name for name in (self.file_header, *self.aliases) if name and name.strip())


@dataclass(frozen=True)
class EntityMap:
    entity: str
    model: type
    spec_file: str
    key: tuple[str, ...]
    specs: tuple[FieldSpec, ...]
    parent: bool = field(default=True)

    def by_header(self) -> dict[str, list[FieldSpec]]:
        """Имя колонки (COLUMN_NAME или русский заголовок) → спецификации в порядке карты."""
        result: dict[str, list[FieldSpec]] = {}
        for spec in self.specs:
            for name in spec.lookup_names():
                bucket = result.setdefault(norm_header(name), [])
                if spec not in bucket:
                    bucket.append(spec)
        return result


def F(column, field=None, kind="str", comment="", header=None) -> FieldSpec:  # noqa: N802 — краткая запись карты
    return FieldSpec(column, field, kind, comment, header)


ACCOUNT_MAP = EntityMap(
    entity="account",
    model=Account,
    spec_file="Карточка ЛС_min.csv",
    key=("provider_id", "account_id"),
    parent=False,
    specs=(
        F("INFO_PARAM_ID1", "info_param_id1", "int"),
        F("INFO_PARAM_ID2", "info_param_id2", "int"),
        F("UNIQ_ATTR", "uniq_attr", "int"),
        F("ACC_CATEGORY_ID", "acc_category_id", "int"),
        F("HOUSE_ADDRESS_SHORT", "house_address"),
        F("ACC_ADDRESS_SHORT", "account_address"),
        F("PAY_SUM_WRITEOFF", "pay_sum_writeoff", "dec"),
        F("BALANCE_IN", "balance_in", "dec"),
        F("STOP_DATE", "stop_date", "date"),
        F("START_DATE", "start_date", "date"),
        F("INFO_PARAM_VALUE1", "info_param_value1"),
        F("INFO_PARAM_VALUE2", "info_param_value2"),
        F("SCHEMA_NAME", "schema_name"),
        F("BALANCE_OUT", "balance_out", "dec"),
        F("TOTAL_CALC_SUM", "total_calc_sum", "dec"),
        F("HOUSE_ID", "house_id", "int"),
        F("ATTR_VALUE", "housing_category_code", "int", comment="Код категории жилого фонда"),
        F("ACCOUNT_ID", "account_id", "int", comment="Код ЛС"),
        F("ACCOUNT_ID", "is_private_enterprise", "bool", comment="признак ЧУП"),
        F("PROVIDER_ID", "provider_id", "int"),
        F("ATTR_VALUE", "ownership_type_code", "int", comment="Код типа собственности"),
        F("ROOM_COUNT", "room_count", "int"),
        F("PRIV_ACC_COUNT", "priv_acc_count", "int"),
        F("SUBJ_COUNT", "subj_count", "int"),
        F("ATTR_VALUE_STR", "contact_phone"),
        F("ACC_CATEGORY_SHORT", "acc_category_short"),
        F("CATEGORY_SHORT_NAME", "category_short_name"),
        F("SHOT_NAME", "provider_short_name"),
        F("CLIENT_ACCOUNT", "client_account"),
        F("CATEGORY_NAME", "category_name"),
        F("OWNERSHIP_TYPE_NAME", "ownership_type_name"),
        F("UNIQ_ATTR_NAME", "uniq_attr_name"),
        F("UNSHARED_SUM", "unshared_sum", "dec"),
        F("FLAT_NUMBER", "flat_number"),
        F("ACC_TOTAL_SPACE", "acc_total_space", "dec"),
        F("ACC_CATEGORY_FULL", "acc_category_full"),
        F("PAY_SUM", "pay_sum", "dec"),
        F("CALC_RESULT_SUM", "calc_result_sum", "dec"),
        F("ATTR_VALUE", "phone", "str", comment="Телефон"),
        F("UNIFIED_ACCOUNT", "unified_account", "int"),
        F("SHORT_FIO", "short_fio"),
    ),
)

SERVICE_MAP = EntityMap(
    entity="service",
    model=AccountService,
    spec_file="Услуги_min.csv",
    key=("service_list_id",),
    specs=(
        F("REPORT_GROUP_ID", "report_group_id", "int"),
        F("NETTING_MULCT_SUM", "netting_mulct_sum", "dec"),
        F("NETTING_SUM", "netting_sum", "dec"),
        F("CALC_SUM", "calc_sum", "dec"),
        F("BALANCE_IN", "balance_in", "dec"),
        F("BALANCE_MULCT_IN", "balance_mulct_in", "dec"),
        F("START_DATE", "start_date", "date"),
        F("STOP_DATE", "stop_date", "date"),
        F("BALANCE_MULCT_OUT", "balance_mulct_out", "dec"),
        F("BALANCE_OUT", "balance_out", "dec"),
        F("SERVICE_LIST_ID", "service_list_id", "int"),
        F("ACCOUNT_ID", ACCOUNT_LOOKUP, "int"),
        F("CALCULATION_ID", "calculation_id", "int"),
        F("PROVIDER_ID", "provider_id", "int"),
        F("SORT_CODE", "sort_code", "int"),
        F("SERVICE_ID", "service_id", "int"),
        F("DEBT_PERIOD", "debt_period", "months"),
        F("SHOT_NAME", "shot_name"),
        F("CALC_PRIV_SUM", "calc_priv_sum", "dec"),
        F("SERVICE_NAME", "service_name"),
        F("SERVICE_NAME_REPORT", "service_name_report"),
        F("CALC_RESULT_SUM", "calc_result_sum", "dec"),
        F("SPENT_FACT", "spent_fact", "dec"),
        F("MULCT_SUM", "mulct_sum", "dec"),
        F("RECALC_SUM", "recalc_sum", "dec"),
        F("MULCTRECALCSUMM", "mulct_recalc_sum", "dec"),
        F("FULL_NAME", "full_name"),
        F("OVERDUE_DEBT", "overdue_debt", "dec"),
        F("SHARE_MULCT_SUMM", "share_mulct_summ", "dec"),
        F("SHARE_SERVICE_SUMM", "share_service_summ", "dec"),
        F("SUBS_PAY", "subs_pay", "dec"),
        F("TARRIF", "tarrif", "dec"),
        F("CALC_DATE", "calc_date", "date"),
    ),
)

PAYMENT_MAP = EntityMap(
    entity="payment",
    model=Payment,
    spec_file="Оплаты_min.csv",
    key=("receipt_id",),
    specs=(
        F("EXECUTION_ID", "execution_id", "int"),
        F("SOURCE_RECEIPT_ID", "source_receipt_id", "int"),
        F("RECEIPT_ID", "receipt_id", "int"),
        F("ACCOUNT_ID", ACCOUNT_LOOKUP, "int"),
        F("PACKAGE_ID", "package_id", "int"),
        F("OTDEL", "otdel"),
        F("PP_NUM", "pp_num"),
        F("HOUSE_ADDRESS", "house_address"),
        F("ACCOUNT_ADDRESS", "account_address"),
        F("ADDRESS", "payer_address_file"),
        F("BANK_ID", "bank_id", "int"),
        F("BANKNAME", "bank_name"),
        F("PAY_DATE", "pay_date", "date"),
        F("BANK_DATE", "bank_date", "date"),
        F("CLIENT_ACCOUNT", "client_account", comment="Лицевой счет"),
        F("CLIENT_ACCOUNT", "client_account_file", comment="Лицевой счет из файла"),
        F("SHOT_NAME", "provider_short_name"),
        F("PROVIDER_ID_JES", "account_provider_id", "int"),
        F("ACC_OPER_DATE", "acc_oper_date", "date"),
        F("PAY_MULCT_SUMM", "pay_mulct_summ", "dec"),
        F("PAY_SERVICE_SUMM", "pay_service_summ", "dec"),
        F("PROVIDER_ID", "provider_id", "int"),
        F("NOTES", "notes"),
        F("SHARE_MULCT_SUM", "share_mulct_sum", "dec"),
        F("SHARE_SERVICE_SUM", "share_service_sum", "dec"),
        F("RECEIPT_ID_GES", "receipt_id_ges", "int"),
        F("SHARE_STATUS", "share_status", "int"),
        F("PACKAGE_STATUS", "package_status", "int"),
        F("REFUND_SUM", "refund_sum", "dec"),
        F("COMMISSION_SUMM", "commission_summ", "dec"),
        F("SERVICE_ID", "service_id", "int"),
        F("SERVICE_NAME", "service_name"),
        F("PAYER_REG_NAME", "payer_reg_name"),
        F("CLIENT_NAME", "client_name"),
        # В спецификации у колонки нет имени (ENUM «Тип оплаты»); в файле данных — PAYMENT_TYPE
        F("", "payment_type", "payment_type", comment="Тип оплаты", header="PAYMENT_TYPE"),
    ),
)

REGISTRATION_MAP = EntityMap(
    entity="registration",
    model=Registration,
    spec_file="Регистрация_min.csv",
    key=("registration_id",),
    specs=(
        F("EMAIL", "email"),
        F("REGISTRATION_ADDRESS", "registration_address"),
        F("CITIZENSHIP_NAME", "citizenship_name"),
        F("MAINDOCDATE", "maindoc_date", "date"),
        F("LEGACY_START_DATE", "legacy_start_date", "date"),
        F("LEGACY_STOP_DATE", "legacy_stop_date", "date"),
        F("CHECK_IN_DATE", "check_in_date", "date"),
        F("SUBJ_HERITAGE_DATE", "subj_heritage_date", "date"),
        F("DATE_REGISTRATION", "date_registration", "date"),
        F("BIRTHDAY", "birthday", "date"),
        F("SUBJ_DEATH_DATE", "subj_death_date", "date"),
        F("CHECK_OUT_DATE", "check_out_date", "date"),
        F("WORK_PLACE_CAPACITY", "work_place_capacity"),
        F("PERSONAL_NUM", "personal_num"),
        # В спецификации Oracle колонки нет: её добавляет отчёт «Регистрация».
        F("PAYER_UNP", "payer_unp"),
        F("IM", "im"),
        F("MAINDOCORGAN", "maindoc_organ"),
        F("SUBJ_ID", "subj_id", "int"),
        F("ACCOUNT_ID", ACCOUNT_LOOKUP, "int"),
        F("REGISTRATION_ID", "registration_id", "int"),
        F("PAYER_REG_ID", "payer_reg_id", "int"),
        F("CONTACT_PHONE", "contact_phone"),
        F("WORK_PLACE_NAME", "work_place_name"),
        F("RELATION_DEGREE_NAME", "relation_degree_name"),
        F("PAYER_TYPE_NAME", "payer_type_name"),
        F("IDLER_VAL", "idler_val", "bool"),
        F("OPER_DATE", "oper_date", "date"),
        F("DOC_TYPE_NAME", "maindoc_type_name"),
        F("OT", "ot"),
        F("SEX_NAME", "sex_name"),
        F("SEX", "sex", "int"),
        F("FULL_NAME", None, comment="Полное наименование поставщика"),
        F("FULL_NAME", None, comment="Полное наименование типа документа"),
        F("MAINDOCSNUM", "maindoc_snum"),
        F("SUBJ_IS_CHECK_OUT", "subj_is_check_out", "bool"),
        F("REG_TYPE_NAME", "reg_type_name"),
        F("REG_TYPE", "reg_type", "int"),
        F("FAM", "fam"),
        F("SUBJ_IS_MAIN", "subj_is_main", "bool"),
        F("IS_CLOSE_RELATIVE", "is_close_relative", "bool"),
        F("SUBJ_LEGAL_ENTITY", "subj_legal_entity", "bool"),
    ),
)

def norm_header(value: str) -> str:
    """Сравнение заголовков: регистр, ё/е, тире и лишние пробелы не различаются."""
    text = value.strip().replace("\u00a0", " ").replace("ё", "е").replace("Ё", "Е")
    for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        text = text.replace(dash, "-")
    return " ".join(text.split()).casefold()


def _with_aliases(entity_map: EntityMap) -> EntityMap:
    aliases = HEADER_ALIASES.get(entity_map.entity, {})
    specs = []
    for spec in entity_map.specs:
        extra = aliases.get(spec.field or "", ())
        specs.append(replace(spec, aliases=extra) if extra else spec)
    return replace(entity_map, specs=tuple(specs))


ENTITY_MAPS: dict[str, EntityMap] = {
    m.entity: _with_aliases(m) for m in (ACCOUNT_MAP, SERVICE_MAP, PAYMENT_MAP, REGISTRATION_MAP)
}
