"""Модели выгрузки АИС «Расчет-ЖКУ». Поля — по спецификациям «Примеры данных/*.csv».

Данные из АИС только для чтения: пишутся импортом, в API редактируются лишь поля ПМ.
Полная исходная строка хранится в raw (в т.ч. колонки, не вынесенные в поля).
"""

from django.db import models

from apps.core.models import OrganizationScopedModel, TimeStampedModel

MONEY = {"max_digits": 20, "decimal_places": 2, "null": True, "blank": True}


def money(verbose_name: str) -> models.DecimalField:
    return models.DecimalField(verbose_name, **MONEY)


class AisRecord(OrganizationScopedModel):
    """Общие поля записи из выгрузки АИС."""

    raw = models.JSONField("Исходная строка выгрузки", default=dict, blank=True)
    import_job = models.ForeignKey(
        "imports.ImportJob", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name="Импорт"
    )

    class Meta:
        abstract = True


class Account(AisRecord):
    """Карточка ЛС (модуль «Карточка ЛС»)."""

    account_id = models.BigIntegerField("Код ЛС (ACCOUNT_ID)")
    client_account = models.CharField("Номер ЛС (CLIENT_ACCOUNT)", max_length=20, db_index=True)
    unified_account = models.BigIntegerField("УЕН ЛС", null=True, blank=True, db_index=True)
    schema_name = models.CharField("Имя схемы", max_length=30, blank=True)
    provider_id = models.BigIntegerField("Код обслуживающей организации", db_index=True)
    provider_short_name = models.CharField("Обслуживающая организация", max_length=100, blank=True)
    is_private_enterprise = models.BooleanField("Признак ЧУП", default=False)

    house_id = models.BigIntegerField("Код дома", null=True, blank=True)
    house_address = models.CharField("Адрес дома", max_length=617, blank=True)
    account_address = models.CharField("Адрес ЛС", max_length=4000, blank=True)
    flat_number = models.CharField("Номер квартиры", max_length=50, blank=True)
    acc_total_space = models.DecimalField("Площадь", max_digits=12, decimal_places=2, null=True, blank=True)
    room_count = models.IntegerField("Кол-во комнат", null=True, blank=True)
    subj_count = models.IntegerField("Проживающие", null=True, blank=True)
    priv_acc_count = models.IntegerField("Льготники", null=True, blank=True)

    acc_category_id = models.BigIntegerField("Тип объекта ЛС (id)", null=True, blank=True)
    acc_category_short = models.CharField("Тип объекта ЛС (кратко)", max_length=50, blank=True)
    acc_category_full = models.CharField("Тип объекта ЛС", max_length=250, blank=True)
    housing_category_code = models.BigIntegerField("Код категории жилого фонда", null=True, blank=True)
    category_short_name = models.CharField("Категория жилого фонда (кратко)", max_length=50, blank=True)
    category_name = models.CharField("Категория жилого фонда", max_length=100, blank=True)
    ownership_type_code = models.BigIntegerField("Код типа собственности", null=True, blank=True)
    ownership_type_name = models.CharField("Тип собственности", max_length=250, blank=True)
    uniq_attr = models.BigIntegerField("Признак уникальности ЛС (id)", null=True, blank=True)
    uniq_attr_name = models.CharField("Тип уникальности", max_length=50, blank=True)
    info_param_id1 = models.BigIntegerField("ID доп. информации 1", null=True, blank=True)
    info_param_value1 = models.CharField("Доп. информация 1", max_length=250, blank=True)
    info_param_id2 = models.BigIntegerField("ID доп. информации 2", null=True, blank=True)
    info_param_value2 = models.CharField("Доп. информация 2", max_length=250, blank=True)

    short_fio = models.CharField("Плательщик", max_length=250, blank=True)
    phone = models.CharField("Телефон", max_length=50, blank=True)
    contact_phone = models.CharField("Контактный телефон", max_length=50, blank=True)

    start_date = models.DateField("Дата открытия ЛС", null=True, blank=True)
    stop_date = models.DateField("Дата закрытия ЛС", null=True, blank=True)

    balance_in = money("Входящее сальдо")
    balance_out = money("Исходящее сальдо")
    total_calc_sum = money("Итого начислено")
    pay_sum = money("Распределённая оплата")
    pay_sum_writeoff = money("В т.ч. списано")
    unshared_sum = money("Нераспределённый остаток оплаты")
    calc_result_sum = money("Субсидия")

    # Поля ПМ (рассчитываются в модуле, не приходят из АИС)
    ais_updated_at = models.DateTimeField("Обновлено из АИС", null=True, blank=True)
    operational_date = models.DateField("Операционная дата схемы", null=True, blank=True)
    debt_started_on = models.DateField("Дата возникновения задолженности", null=True, blank=True)
    months_debt = models.PositiveIntegerField("Месяцев долга", null=True, blank=True)
    debt_group = models.PositiveSmallIntegerField("Группа задолженности", null=True, blank=True, db_index=True)
    debt_group_manual = models.PositiveSmallIntegerField("Группа (ручная корректировка)", null=True, blank=True)
    debt_group_manual_reason = models.CharField("Причина корректировки", max_length=500, blank=True)
    debt_group_basis = models.PositiveSmallIntegerField(
        "Расчётная группа на момент корректировки", null=True, blank=True,
    )
    rating = models.CharField("Рейтинг", max_length=1, blank=True)
    rating_repeat = models.PositiveSmallIntegerField("Подрейтинг (раз)", null=True, blank=True)
    funnel_stage = models.CharField("Этап воронки", max_length=20, blank=True, default="new")
    funnel_locked = models.BooleanField("Этап задан вручную", default=False)
    scenario_name = models.CharField("Сценарий мероприятий", max_length=250, blank=True)
    scenario_locked = models.BooleanField("Сценарий задан вручную", default=False)
    assigned_to = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_accounts",
        verbose_name="Закреплённый специалист",
    )
    payer_identifier = models.CharField("Идентификационный номер", max_length=100, blank=True)
    payer_unp = models.CharField("УНП", max_length=20, blank=True)
    contact_source_mode = models.CharField("Источник контактов для обзвона", max_length=20, blank=True, default="combined")
    debtor_category = models.ForeignKey(
        "nsi.DebtorCategory", null=True, blank=True, on_delete=models.SET_NULL, related_name="accounts",
        verbose_name="Категория должника",
    )
    inheritance_case = models.BooleanField("Наследственное дело", default=False)
    inheritance_until = models.DateField("Приостановка до", null=True, blank=True)
    inheritance_payer_id = models.BigIntegerField("Плательщик на момент флага", null=True, blank=True)
    residence_note = models.CharField("Фактическое проживание", max_length=500, blank=True)
    bankruptcy = models.BooleanField("Банкротство / ликвидация", default=False)
    warning_due = models.DateField("Истечение срока предупреждения", null=True, blank=True)
    claim_due = models.DateField("Дедлайн подачи иска", null=True, blank=True)

    class Meta:
        ordering = ["client_account"]
        indexes = [
            models.Index(fields=["organization", "provider_id", "debt_group"], name="account_scope_group"),
            models.Index(fields=["organization", "balance_out"], name="account_org_balance"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["organization", "provider_id", "account_id"], name="uniq_account_in_scope")
        ]
        verbose_name = "Лицевой счёт"
        verbose_name_plural = "Лицевые счета"

    def __str__(self) -> str:
        return f"ЛС {self.client_account}"

    @property
    def effective_group(self) -> int | None:
        return self.debt_group_manual if self.debt_group_manual is not None else self.debt_group


class AccountService(AisRecord):
    """Услуга / договор на услугу по ЛС (модуль «Услуги»)."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="services", verbose_name="ЛС")
    service_list_id = models.BigIntegerField("ID договора на услугу")
    service_id = models.BigIntegerField("ID услуги")
    service_name = models.CharField("Услуга", max_length=250, blank=True)
    service_name_report = models.CharField("Услуга в извещении", max_length=250, blank=True)
    provider_id = models.BigIntegerField("Код поставщика", null=True, blank=True)
    shot_name = models.CharField("Поставщик (кратко)", max_length=100, blank=True)
    full_name = models.CharField("Поставщик", max_length=250, blank=True)
    calculation_id = models.BigIntegerField("ID расчёта", null=True, blank=True)
    report_group_id = models.BigIntegerField("ID группы отчёта", null=True, blank=True)
    sort_code = models.BigIntegerField("Код сортировки", null=True, blank=True)

    start_date = models.DateField("Дата с", null=True, blank=True)
    stop_date = models.DateField("Дата по", null=True, blank=True)
    calc_date = models.DateField("Дата расчёта", null=True, blank=True)
    # В спецификации тип DATE, но по описанию это число месяцев долга (DISTINCT месяцы периода долга)
    debt_period = models.PositiveIntegerField("Кол-во периодов долга (мес.)", null=True, blank=True)

    balance_in = money("Входящее сальдо без пени")
    balance_mulct_in = money("Входящее сальдо пени")
    balance_out = money("Исходящее сальдо с пенями")
    balance_mulct_out = money("Исходящее сальдо пени")
    calc_sum = money("Всего начислено")
    calc_result_sum = money("Начислено")
    calc_priv_sum = money("Льгота")
    spent_fact = models.DecimalField("Начислено (количество)", max_digits=20, decimal_places=4, null=True, blank=True)
    tarrif = models.DecimalField("Тариф", max_digits=20, decimal_places=4, null=True, blank=True)
    mulct_sum = money("Начислено пени")
    recalc_sum = money("Перерасчёт")
    mulct_recalc_sum = money("Перерасчёт по пене")
    netting_sum = money("Взаимозачёт по услуге")
    netting_mulct_sum = money("Взаимозачёт пени")
    overdue_debt = money("Просроченная задолженность")
    share_service_summ = money("Распределённая оплата услуг")
    share_mulct_summ = money("Распределённая оплата пени")
    subs_pay = money("Субсидия")

    debt_group = models.PositiveSmallIntegerField("Группа задолженности", null=True, blank=True)
    debt_group_manual = models.PositiveSmallIntegerField("Группа (ручная)", null=True, blank=True)
    debt_group_manual_reason = models.CharField("Причина корректировки", max_length=500, blank=True)
    debt_group_basis = models.PositiveSmallIntegerField("Расчётная группа на момент корректировки", null=True, blank=True)
    debt_started_on = models.DateField("Дата возникновения", null=True, blank=True)
    scenario_name = models.CharField("Сценарий", max_length=250, blank=True)
    scenario_locked = models.BooleanField("Сценарий задан вручную", default=False)
    initial_principal = money("Первоначальный долг")
    initial_penalty = money("Первоначальная пеня")
    last_payment_date = models.DateField("Дата последней оплаты", null=True, blank=True)

    class Meta:
        ordering = ["sort_code", "service_name"]
        constraints = [
            models.UniqueConstraint(fields=["account", "service_list_id"], name="uniq_service_contract")
        ]
        verbose_name = "Услуга ЛС"
        verbose_name_plural = "Услуги ЛС"

    def __str__(self) -> str:
        return self.service_name or str(self.service_id)

    @property
    def effective_group(self) -> int | None:
        return self.debt_group_manual if self.debt_group_manual is not None else self.debt_group


class ServiceDebtPeriod(AisRecord):
    """Непогашенный период услуги: остаток и срок оплаты, по которым считается группа."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="debt_periods", verbose_name="ЛС")
    service = models.ForeignKey(
        AccountService, on_delete=models.CASCADE, related_name="debt_periods", verbose_name="Услуга",
    )
    period = models.DateField("Расчётный период")
    principal = money("Остаток основного долга")
    penalty = money("Остаток пени")
    due_on = models.DateField("Срок оплаты")
    started_on = models.DateField("Дата возникновения")

    class Meta:
        ordering = ["period"]
        constraints = [
            models.UniqueConstraint(fields=["service", "period"], name="uniq_service_debt_period"),
        ]
        verbose_name = "Период долга"
        verbose_name_plural = "Периоды долга"


class Payment(AisRecord):
    """Оплата (модуль «Оплаты»)."""

    class PaymentType(models.TextChoices):
        FILE = "file", "Файл"
        MANUAL = "manual", "Ввод вручную"
        SALARY = "salary", "Зачисление из зарплаты"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="payments", verbose_name="ЛС")
    receipt_id = models.BigIntegerField("ID квитанции")
    source_receipt_id = models.BigIntegerField("ID исх. квитанции", null=True, blank=True)
    receipt_id_ges = models.BigIntegerField("Связь с квитанцией", null=True, blank=True)
    execution_id = models.BigIntegerField("ID документа на взыскание", null=True, blank=True)
    package_id = models.BigIntegerField("ID пачки", null=True, blank=True)
    package_status = models.BigIntegerField("Статус пачки", null=True, blank=True)
    otdel = models.CharField("№ операции в ЦУ", max_length=11, blank=True)
    pp_num = models.CharField("№ ПП", max_length=16, blank=True)

    client_account = models.CharField("Лицевой счёт", max_length=20, blank=True)
    client_account_file = models.CharField("Лицевой счёт из файла", max_length=25, blank=True)
    house_address = models.CharField("Адрес дома", max_length=250, blank=True)
    account_address = models.CharField("Адрес ЛС", max_length=4000, blank=True)
    payer_address_file = models.CharField("Адрес плательщика из файла", max_length=255, blank=True)
    payer_reg_name = models.CharField("ФИО плательщика", max_length=250, blank=True)
    client_name = models.CharField("ФИО плательщика из файла", max_length=99, blank=True)

    bank_id = models.BigIntegerField("Банк (ID)", null=True, blank=True)
    bank_name = models.CharField("Банк", max_length=255, blank=True)
    pay_date = models.DateField("Дата оплаты", null=True, blank=True)
    bank_date = models.DateField("Дата оплаты по банку", null=True, blank=True)
    acc_oper_date = models.DateField("Операционный период распределения", null=True, blank=True)

    account_provider_id = models.BigIntegerField("Обсл. организация ЛС (ID)", null=True, blank=True)
    provider_id = models.BigIntegerField("Поставщик услуг (ID)", null=True, blank=True)
    provider_short_name = models.CharField("Поставщик", max_length=100, blank=True)
    service_id = models.BigIntegerField("Услуга (ID)", null=True, blank=True)
    service_name = models.CharField("Услуга", max_length=250, blank=True)

    pay_service_summ = money("Оплата услуг")
    pay_mulct_summ = money("Оплата пени")
    share_service_sum = money("Распределённая оплата услуг")
    share_mulct_sum = money("Распределённая оплата пени")
    share_status = models.IntegerField("Способ распределения (код)", null=True, blank=True)
    refund_sum = money("Сумма возврата")
    commission_summ = money("Комиссия расчётного агента")
    notes = models.CharField("Примечание", max_length=255, blank=True)
    payment_type = models.CharField("Тип оплаты", max_length=10, choices=PaymentType.choices, blank=True)

    class Meta:
        ordering = ["-pay_date"]
        constraints = [models.UniqueConstraint(fields=["account", "receipt_id"], name="uniq_payment_receipt")]
        verbose_name = "Оплата"
        verbose_name_plural = "Оплаты"


class Registration(AisRecord):
    """Регистрация лица по ЛС (модуль «Регистрация»)."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="registrations", verbose_name="ЛС")
    registration_id = models.BigIntegerField("Код регистрации лица")
    subj_id = models.BigIntegerField("Код лица", db_index=True)
    payer_reg_id = models.BigIntegerField("Код регистрации плательщика", null=True, blank=True)

    fam = models.CharField("Фамилия", max_length=100, blank=True)
    im = models.CharField("Имя", max_length=100, blank=True)
    ot = models.CharField("Отчество", max_length=100, blank=True)
    birthday = models.DateField("Дата рождения", null=True, blank=True)
    sex = models.IntegerField("Пол (код)", null=True, blank=True)
    sex_name = models.CharField("Пол", max_length=50, blank=True)
    personal_num = models.CharField("Идентификационный номер", max_length=100, blank=True)
    citizenship_name = models.CharField("Гражданство", max_length=250, blank=True)
    email = models.CharField("E-mail", max_length=50, blank=True)
    contact_phone = models.CharField("Контактный телефон", max_length=50, blank=True)
    registration_address = models.CharField("Адрес местожительства", max_length=100, blank=True)

    maindoc_type_name = models.CharField("Основной документ", max_length=100, blank=True)
    maindoc_snum = models.CharField("Серия и номер", max_length=100, blank=True)
    maindoc_date = models.DateField("Дата выдачи", null=True, blank=True)
    maindoc_organ = models.CharField("Кем выдан", max_length=200, blank=True)

    reg_type = models.IntegerField("Тип регистрации (код)", null=True, blank=True)
    reg_type_name = models.CharField("Тип регистрации", max_length=250, blank=True)
    date_registration = models.DateField("Дата регистрации", null=True, blank=True)
    check_in_date = models.DateField("Дата прибытия", null=True, blank=True)
    check_out_date = models.DateField("Дата убытия", null=True, blank=True)
    relation_degree_name = models.CharField("Степень родства", max_length=250, blank=True)
    payer_type_name = models.CharField("Тип плательщика", max_length=50, blank=True)

    subj_is_main = models.BooleanField("Является плательщиком", default=False)
    subj_legal_entity = models.BooleanField("Юридическое лицо", default=False)
    is_close_relative = models.BooleanField("Член семьи плательщика", default=False)
    subj_is_check_out = models.BooleanField("Снят с регистрационного учёта", default=False)
    idler_val = models.BooleanField("Не занят в экономике", default=False)

    subj_death_date = models.DateField("Дата смерти", null=True, blank=True)
    legacy_start_date = models.DateField("Начало открытия наследства", null=True, blank=True)
    legacy_stop_date = models.DateField("Окончание открытия наследства", null=True, blank=True)
    subj_heritage_date = models.DateField("Дата принятия наследства", null=True, blank=True)

    work_place_name = models.CharField("Место работы", max_length=250, blank=True)
    work_place_capacity = models.CharField("Должность", max_length=250, blank=True)
    oper_date = models.DateField("Операционный период", null=True, blank=True)

    class Meta:
        ordering = ["-subj_is_main", "fam", "im"]
        indexes = [
            models.Index(fields=["personal_num"], name="registration_personal_num"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["account", "registration_id"], name="uniq_registration")
        ]
        verbose_name = "Регистрация лица"
        verbose_name_plural = "Регистрации лиц"

    def __str__(self) -> str:
        return " ".join(p for p in (self.fam, self.im, self.ot) if p)


class Contact(AisRecord):
    """Контакт плательщика. Записи источника ПМ загрузка АИС не перезаписывает."""

    class Kind(models.TextChoices):
        MOBILE = "mobile", "Мобильный"
        CITY = "city", "Городской"
        EMAIL = "email", "E-mail"
        MESSENGER = "messenger", "Мессенджер"

    class Source(models.TextChoices):
        AIS = "ais", "АИС «Расчет-ЖКУ»"
        PM = "pm", "Внесено в ПМ"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="contacts", verbose_name="ЛС")
    registration = models.ForeignKey(
        Registration, null=True, blank=True, on_delete=models.CASCADE, related_name="contacts", verbose_name="Лицо",
    )
    kind = models.CharField("Тип", max_length=20, choices=Kind.choices)
    value = models.CharField("Значение", max_length=250)
    priority = models.PositiveSmallIntegerField("Приоритет", default=0)
    source = models.CharField("Источник", max_length=10, choices=Source.choices, default=Source.PM)
    ais_updated_at = models.DateTimeField("Обновлено из АИС", null=True, blank=True)

    class Meta:
        ordering = ["-priority", "kind"]
        verbose_name = "Контакт"
        verbose_name_plural = "Контакты"

    def __str__(self) -> str:
        return self.value


class BalanceHistory(AisRecord):
    """Срез долга и пени по услуге и периоду."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="balance_history", verbose_name="ЛС")
    service = models.ForeignKey(
        AccountService, on_delete=models.CASCADE, related_name="balance_history", verbose_name="Услуга",
    )
    period = models.DateField("Период")
    principal = money("Основной долг")
    penalty = money("Пеня")

    class Meta:
        ordering = ["-period", "service_id"]
        constraints = [
            models.UniqueConstraint(fields=["service", "period"], name="uniq_service_period_balance"),
        ]
        verbose_name = "История суммы"
        verbose_name_plural = "История сумм"


class StatusHistory(AisRecord):
    """История группы, рейтинга, этапа и сценария."""

    class Kind(models.TextChoices):
        GROUP = "group", "Группа"
        RATING = "rating", "Рейтинг"
        FUNNEL = "funnel", "Этап воронки"
        SCENARIO = "scenario", "Сценарий"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="status_history", verbose_name="ЛС")
    service = models.ForeignKey(
        AccountService, null=True, blank=True, on_delete=models.CASCADE, related_name="status_history",
        verbose_name="Услуга",
    )
    kind = models.CharField("Вид", max_length=20, choices=Kind.choices)
    old_value = models.CharField("Было", max_length=250, blank=True)
    new_value = models.CharField("Стало", max_length=250, blank=True)
    reason = models.CharField("Основание", max_length=500, blank=True)
    author = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name="Автор",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "История статуса"
        verbose_name_plural = "История статусов"


class DebtWorkItem(AisRecord):
    """Документ вкладки «Работа с задолженностью»."""

    class Kind(models.TextChoices):
        WARNING = "warning", "Предупреждение"
        DISCONNECT = "disconnect", "Отключение услуг"
        WRIT = "writ", "Исполнительная надпись"
        CLAIM = "claim", "Исковое заявление"
        CLOSURE = "closure", "Закрытие"
        IMPOSSIBILITY = "impossibility", "Невозможность взыскания"
        CALCULATION = "calculation", "Расчёт задолженности"
        ENFORCEMENT_PAYMENT = "enforcement_payment", "Оплата по документу на взыскание"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="work_items", verbose_name="ЛС")
    service = models.ForeignKey(
        AccountService, null=True, blank=True, on_delete=models.SET_NULL, related_name="work_items",
        verbose_name="Услуга",
    )
    kind = models.CharField("Вид", max_length=30, choices=Kind.choices)
    title = models.CharField("Наименование", max_length=250, blank=True)
    started_on = models.DateField("Начало", null=True, blank=True)
    ended_on = models.DateField("Окончание", null=True, blank=True)
    principal = money("Долг")
    penalty = money("Пеня")
    paid_principal = money("Оплата долга")
    paid_penalty = money("Оплата пени")
    note = models.CharField("Примечание", max_length=500, blank=True)

    class Meta:
        ordering = ["-started_on", "-id"]
        verbose_name = "Документ по задолженности"
        verbose_name_plural = "Документы по задолженности"


class Attachment(AisRecord):
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="attachments", verbose_name="ЛС")
    work_item = models.ForeignKey(
        DebtWorkItem, null=True, blank=True, on_delete=models.CASCADE, related_name="attachments",
        verbose_name="Документ",
    )
    doc_type = models.CharField("Тип документа", max_length=100)
    file = models.FileField("Файл", upload_to="attachments/%Y/%m/")
    original_name = models.CharField("Имя файла", max_length=250)
    uploaded_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name="Кто загрузил",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Вложение"
        verbose_name_plural = "Вложения"


class Measure(AisRecord):
    """Мероприятие, запущенное из реестра или карточки (учёт до модуля 4.2.3)."""

    class Kind(models.TextChoices):
        CALL = "call", "Автообзвон"
        NOTICE = "notice", "Уведомление"
        WARNING = "warning", "Предупреждение"
        DISCONNECT = "disconnect", "Отключение"
        COLLECTION = "collection", "Взыскание"
        SCENARIO = "scenario", "Смена сценария"

    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Назначено"
        RUNNING = "running", "Выполняется"
        DONE = "done", "Завершено"
        CANCELLED = "cancelled", "Прервано"
        FAILED = "failed", "Завершено с ошибкой"

    SERVICE_REQUIRED = {Kind.DISCONNECT, Kind.COLLECTION}

    kind = models.CharField("Вид", max_length=20, choices=Kind.choices)
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.ASSIGNED)
    channel = models.CharField("Канал", max_length=20, blank=True)
    template_name = models.CharField("Шаблон", max_length=250, blank=True)
    scenario_name = models.CharField("Сценарий", max_length=250, blank=True)
    note = models.CharField("Комментарий", max_length=500, blank=True)
    assignee = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_measures",
        verbose_name="Исполнитель",
    )
    artifact = models.FileField("Файл для внешней системы", upload_to="measures/%Y/%m/", blank=True)
    started_on = models.DateField("Дата начала", null=True, blank=True)
    due_on = models.DateField("Контрольная дата", null=True, blank=True)
    days = models.PositiveSmallIntegerField("Дней", null=True, blank=True)
    time_from = models.TimeField("Время с", null=True, blank=True)
    time_to = models.TimeField("Время по", null=True, blank=True)
    created_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="measures", verbose_name="Автор",
    )
    accounts = models.ManyToManyField(Account, related_name="measures", verbose_name="Лицевые счета")
    services = models.ManyToManyField(AccountService, blank=True, related_name="measures", verbose_name="Услуги")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Мероприятие"
        verbose_name_plural = "Мероприятия"


class MeasureTask(AisRecord):
    """Задание исполнителю внутри мероприятия взыскания."""

    class Status(models.TextChoices):
        OPEN = "open", "Открыто"
        DONE = "done", "Выполнено"

    measure = models.ForeignKey(Measure, on_delete=models.CASCADE, related_name="tasks", verbose_name="Мероприятие")
    assignee = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="measure_tasks",
        verbose_name="Исполнитель",
    )
    title = models.CharField("Задание", max_length=250)
    due_on = models.DateField("Срок", null=True, blank=True)
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.OPEN)

    class Meta:
        ordering = ["due_on", "id"]
        verbose_name = "Задание"
        verbose_name_plural = "Задания"


class WritCheck(AisRecord):
    """Пункт чек-листа подготовки исполнительной надписи."""

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="writ_checks", verbose_name="ЛС")
    code = models.CharField("Код", max_length=40)
    title = models.CharField("Пункт", max_length=250)
    done = models.BooleanField("Выполнен", default=False)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["account", "code"], name="uniq_writ_check"),
        ]
        verbose_name = "Пункт чек-листа"
        verbose_name_plural = "Чек-лист исполнительной надписи"


class RefreshRequest(AisRecord):
    """Очередь «Обновить сейчас». Файл по ЛС готовит АИС, ПМ фиксирует запрос и закрывает его при загрузке."""

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает выгрузку"
        DONE = "done", "Данные обновлены"

    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="refresh_requests", verbose_name="ЛС")
    requested_by = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name="Кто запросил",
    )
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.PENDING)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Запрос обновления"
        verbose_name_plural = "Запросы обновления"


class RegistryPreference(TimeStampedModel):
    """Какие колонки реестра пользователь оставил включёнными."""

    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="registry_preferences")
    target = models.CharField("Реестр", max_length=20)
    columns = models.JSONField("Колонки", default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "target"], name="uniq_registry_preference"),
        ]


class SavedFilter(TimeStampedModel):
    class Target(models.TextChoices):
        ACCOUNTS = "accounts", "Реестр ЛС"
        CONTRACTS = "contracts", "Реестр договоров"

    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="saved_filters", verbose_name="Пользователь")
    name = models.CharField("Название", max_length=150)
    target = models.CharField("Реестр", max_length=20, choices=Target.choices)
    query = models.JSONField("Фильтр", default=dict)
    columns = models.JSONField("Колонки", default=list, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["user", "target", "name"], name="uniq_saved_filter"),
        ]
        verbose_name = "Сохранённый фильтр"
        verbose_name_plural = "Сохранённые фильтры"
