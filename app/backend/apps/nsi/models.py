from datetime import time

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


def weekend_days() -> list[int]:
    return [5, 6]


class DebtGroupScale(TimeStampedModel, SoftDeleteModel):
    """Шкала групп задолженности (ТЗ 4.2.1.5, параметр НСИ). months_to не включается."""

    group = models.PositiveSmallIntegerField("Группа", unique=True)
    name = models.CharField("Наименование", max_length=100)
    months_from = models.PositiveIntegerField("Месяцев от (включительно)")
    months_to = models.PositiveIntegerField("Месяцев до (не включительно)", null=True, blank=True)

    class Meta:
        ordering = ["group"]
        verbose_name = "Группа задолженности"
        verbose_name_plural = "Шкала групп задолженности"

    def __str__(self) -> str:
        return f"Группа {self.group}: {self.name}"

    def clean(self):
        if self.months_to is not None and self.months_to <= self.months_from:
            raise ValidationError("Верхняя граница должна быть больше нижней")


class DebtorCategory(TimeStampedModel, SoftDeleteModel):
    """Категория должника (ТЗ 4.2.1.4, 4.2.2.6). Пустая организация — центральная запись НСИ.

    Центральный перечень — строки «Основные документы/Категории должников.docx», миграция nsi.0016.
    """

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="debtor_categories",
        verbose_name="Схема",
    )
    code = models.CharField("Код", max_length=50)
    name = models.CharField("Наименование", max_length=250)
    note = models.CharField("Влияние на сценарии", max_length=500, blank=True)
    section = models.CharField("Раздел списка", max_length=250, blank=True)
    sort_order = models.PositiveIntegerField("Порядок в списке", default=1000)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["code"], condition=models.Q(organization__isnull=True), name="uniq_central_debtor_category",
            ),
            models.UniqueConstraint(fields=["organization", "code"], name="uniq_debtor_category_code"),
        ]
        verbose_name = "Категория должника"
        verbose_name_plural = "Категории должников"

    def __str__(self) -> str:
        return self.name


class ScenarioRule(TimeStampedModel, SoftDeleteModel):
    """Сценарий по группе услуги. Категория должника, если задана, перекрывает общее правило группы."""

    group = models.PositiveSmallIntegerField("Группа")
    name = models.CharField("Сценарий", max_length=250)
    category = models.ForeignKey(
        DebtorCategory, null=True, blank=True, on_delete=models.CASCADE, related_name="scenario_rules",
        verbose_name="Категория должника",
    )

    class Meta:
        ordering = ["group", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["group", "category"], name="uniq_scenario_group_category", nulls_distinct=False,
            ),
        ]
        verbose_name = "Сценарий по группе"
        verbose_name_plural = "Сценарии по группам"

    def __str__(self) -> str:
        return f"{self.group}: {self.name}"


class ScenarioDefinition(TimeStampedModel, SoftDeleteModel):
    """Конструктор сценария. Пустая организация — центральный шаблон Заказчика."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        ACTIVE = "active", "Активный"

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="scenarios",
        verbose_name="Схема",
    )
    name = models.CharField("Название", max_length=250)
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.DRAFT)
    version = models.PositiveIntegerField("Версия", default=1)
    steps = models.JSONField("Шаги", default=list, blank=True)
    based_on = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="copies", verbose_name="Источник",
    )
    call_legal = models.BooleanField(
        "Звонить юридическим лицам", null=True, blank=True,
        help_text="Пусто — брать признак организации.",
    )
    dial_mobile_from_day = models.PositiveSmallIntegerField(
        "С этого числа только мобильный", null=True, blank=True,
    )
    dial_mobile_weekdays = models.JSONField(
        "Дни недели только мобильного", null=True, blank=True,
        help_text="Пусто — общее правило. Числа 0–6, понедельник = 0.",
    )
    call_from_day = models.PositiveSmallIntegerField(
        "Обзвон с этого числа месяца",
        default=27,
        help_text="Не раньше 27-го: 26-е — день начисления пени.",
    )
    weekday_from = models.TimeField("Будни, обзвон с", default=time(18, 0))
    weekday_to = models.TimeField("Будни, обзвон по", default=time(21, 0))
    weekend_from = models.TimeField("Выходные, обзвон с", default=time(10, 0))
    weekend_to = models.TimeField("Выходные, обзвон по", default=time(22, 0))

    class Meta:
        ordering = ["name"]
        verbose_name = "Сценарий мероприятий"
        verbose_name_plural = "Сценарии мероприятий"

    def __str__(self) -> str:
        return self.name


class ServiceScenarioMode(TimeStampedModel):
    """Режим запуска сценария обслуживающей организации. По умолчанию — вручную, сценарий базовый."""

    class Launch(models.TextChoices):
        MANUAL = "manual", "Вручную"
        AUTO = "auto", "Автоматически"

    service_organization = models.OneToOneField(
        "users.ServiceOrganization", on_delete=models.CASCADE, related_name="scenario_mode",
        verbose_name="Обслуживающая организация",
    )
    launch = models.CharField("Режим запуска", max_length=10, choices=Launch.choices, default=Launch.MANUAL)
    scenario = models.ForeignKey(
        ScenarioDefinition, null=True, blank=True, on_delete=models.SET_NULL, related_name="service_modes",
        verbose_name="Сценарий по умолчанию",
    )

    class Meta:
        verbose_name = "Режим сценария организации"
        verbose_name_plural = "Режимы сценариев организаций"


class ScenarioRevision(TimeStampedModel):
    """Снимок шагов на момент публикации. Уже запущенные дела ссылаются на номер версии."""

    scenario = models.ForeignKey(ScenarioDefinition, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveIntegerField("Версия")
    steps = models.JSONField("Шаги", default=list)
    author = models.ForeignKey(
        "users.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name="Автор",
    )

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["scenario", "version"], name="uniq_scenario_revision"),
        ]
        verbose_name = "Версия сценария"
        verbose_name_plural = "Версии сценария"


class PrintForm(TimeStampedModel, SoftDeleteModel):
    """Макет печатной формы. Сформированный документ хранит номер версии."""

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="print_forms",
        verbose_name="Схема",
    )
    code = models.SlugField("Код", max_length=100)
    name = models.CharField("Название", max_length=250)
    doc_kind = models.CharField("Вид документа", max_length=30)
    addressee = models.CharField("Адресат", max_length=20, default="debtor")
    body = models.TextField("Текст")
    font_size = models.PositiveSmallIntegerField("Размер шрифта", default=12)
    indent_mm = models.PositiveSmallIntegerField("Отступ, мм", default=0)
    outdent_mm = models.PositiveSmallIntegerField("Выступ, мм", default=0)
    block_order = models.JSONField(
        "Порядок блоков",
        default=list,
        blank=True,
        help_text="logo, requisites, body, signatory",
    )
    logo_text = models.CharField("Логотип", max_length=250, blank=True)
    requisites = models.TextField("Реквизиты", blank=True)
    signatory = models.CharField("Подпись уполномоченного", max_length=250, blank=True)
    blocks = models.JSONField("Блоки макета", default=list, blank=True)
    blank = models.CharField(
        "Бланк образца",
        max_length=40,
        blank=True,
        default="",
        help_text="warning, reminder, notice-137, notice-80, notice-86, notice-tko, calculation, writ, proxy, lawsuit, eviction, alienation",
    )
    version = models.PositiveIntegerField("Версия", default=1)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "code", "addressee"], name="uniq_print_form_code"),
            models.UniqueConstraint(
                fields=["code", "addressee"],
                condition=models.Q(organization__isnull=True),
                name="uniq_central_print_form",
            ),
        ]
        verbose_name = "Печатная форма"
        verbose_name_plural = "Печатные формы"

    def __str__(self) -> str:
        return self.name


class PrintFormRevision(TimeStampedModel):
    form = models.ForeignKey(PrintForm, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveIntegerField("Версия")
    body = models.TextField("Текст")
    layout = models.JSONField("Макет", default=dict, blank=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["form", "version"], name="uniq_print_form_revision"),
        ]
        verbose_name = "Версия печатной формы"
        verbose_name_plural = "Версии печатных форм"


class PrintedDocument(TimeStampedModel):
    """Готовый PDF. Файл остаётся на версии макета, которой его собрали."""

    form = models.ForeignKey(PrintForm, on_delete=models.PROTECT, related_name="documents", verbose_name="Макет")
    version = models.PositiveIntegerField("Версия макета")
    account = models.ForeignKey(
        "debts.Account", on_delete=models.CASCADE, related_name="printed_documents", verbose_name="ЛС",
    )
    addressee = models.CharField("Адресат", max_length=20, default="debtor")
    body = models.TextField("Текст")
    batch = models.CharField("Пакет", max_length=36, blank=True)
    file = models.FileField("PDF", upload_to="printed/%Y/%m/")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Сформированный документ"
        verbose_name_plural = "Сформированные документы"


class CalculationSettings(TimeStampedModel):
    """Параметры расчёта: период рейтинга N, порог закрытия, день срока оплаты."""

    rating_period_months = models.PositiveIntegerField("Период рейтинга, мес.", default=12)
    close_threshold = models.DecimalField("Порог остатка для закрытия", max_digits=12, decimal_places=2, default=0)
    payment_due_day = models.PositiveSmallIntegerField("День срока оплаты", default=25)
    dial_mobile_from_day = models.PositiveSmallIntegerField(
        "С этого числа месяца для обзвона только мобильный", default=25,
    )
    dial_mobile_from_hour = models.PositiveSmallIntegerField(
        "С этого часа только мобильный", null=True, blank=True,
    )
    dial_mobile_to_hour = models.PositiveSmallIntegerField(
        "До этого часа только мобильный", null=True, blank=True,
    )
    dial_mobile_weekdays = models.JSONField(
        "Дни недели только мобильного", default=weekend_days, blank=True,
        help_text="0 — понедельник, 6 — воскресенье.",
    )
    rating_b_group = models.PositiveSmallIntegerField("Группа рейтинга B", default=3)
    rating_c_from = models.PositiveSmallIntegerField("Группа рейтинга C от", default=4)
    rating_c_to = models.PositiveSmallIntegerField("Группа рейтинга C по", default=5)
    rating_e_from = models.PositiveSmallIntegerField("Группа рейтинга E от", default=6)
    warning_wait_days = models.PositiveSmallIntegerField(
        "Дней на оплату после вручения предупреждения", default=5,
    )
    disconnect_requires_approval = models.BooleanField(
        "Отключение только после согласования", default=False,
    )

    class Meta:
        verbose_name = "Параметры расчёта"
        verbose_name_plural = "Параметры расчёта"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "CalculationSettings":
        obj, _created = cls.objects.get_or_create(pk=1)
        return obj


class BnpDebtType(TimeStampedModel, SoftDeleteModel):
    """Тип задолженности БНП (debtTypeId)."""

    code = models.CharField("Код", max_length=50, primary_key=True)
    name = models.TextField("Наименование")

    class Meta:
        ordering = ["code"]
        verbose_name = "Тип задолженности БНП"
        verbose_name_plural = "Типы задолженности БНП"

    def __str__(self) -> str:
        return self.code


class BnpService(TimeStampedModel, SoftDeleteModel):
    """Услуга БНП (serviceId), например 572 — исполнительная надпись по п. 9 Перечня."""

    service_id = models.PositiveIntegerField("Идентификатор услуги", primary_key=True)
    type_id = models.CharField("Тип (typeId)", max_length=50)
    name = models.CharField("Наименование", max_length=500)
    debt_types = models.ManyToManyField(BnpDebtType, blank=True, related_name="services", verbose_name="Типы долга")

    class Meta:
        ordering = ["service_id"]
        verbose_name = "Услуга БНП"
        verbose_name_plural = "Услуги БНП"

    def __str__(self) -> str:
        return f"{self.service_id} {self.name}"


class NotaryOffice(TimeStampedModel, SoftDeleteModel):
    """Контора с сайта Белорусской нотариальной палаты. Удаление — деактивация."""

    code = models.CharField("Код", max_length=80, primary_key=True)
    source_id = models.PositiveIntegerField("Идентификатор на belnotary.by", unique=True)
    name = models.CharField("Наименование", max_length=250)
    district = models.CharField("Нотариальный округ", max_length=80)
    address = models.CharField("Адрес", max_length=250, blank=True)
    phones = models.CharField("Телефоны", max_length=300, blank=True)

    class Meta:
        ordering = ["district", "name"]
        verbose_name = "Нотариальная контора"
        verbose_name_plural = "Нотариальные конторы"

    def __str__(self) -> str:
        return self.name


class OpiOffice(TimeStampedModel, SoftDeleteModel):
    """Территориальное подразделение ОПИ (ТЗ 4.2.8.4). Пустая организация — центральная запись (справочник 120)."""

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE,
        related_name="opi_offices", verbose_name="Схема",
    )
    code = models.CharField("Код ОПИ (справочник 120)", max_length=20)
    name = models.CharField("Наименование подразделения ОПИ", max_length=250)
    region = models.CharField("Область / регион", max_length=100, blank=True)
    address = models.CharField("Адрес", max_length=250, blank=True)
    phones = models.CharField("Телефоны", max_length=200, blank=True)
    email = models.CharField("E-mail", max_length=120, blank=True)

    class Meta:
        ordering = ["code", "name"]
        verbose_name = "Подразделение ОПИ"
        verbose_name_plural = "Справочник ОПИ"

    def __str__(self) -> str:
        return f"{self.code} — {self.name}" if self.code else self.name


class BnpDocType(TimeStampedModel, SoftDeleteModel):
    """Тип документа БНП (docTypeId)."""

    code = models.CharField("Код", max_length=50, primary_key=True)
    name = models.CharField("Наименование", max_length=250)

    class Meta:
        ordering = ["code"]
        verbose_name = "Тип документа БНП"
        verbose_name_plural = "Типы документов БНП"

    def __str__(self) -> str:
        return self.name


class ExtraMeasureCatalog(TimeStampedModel, SoftDeleteModel):
    """Справочник дополнительных мероприятий. Ведёт локальный администратор."""

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE,
        related_name="extra_measures", verbose_name="Схема",
    )
    name = models.CharField("Наименование", max_length=250)
    note = models.CharField("Пояснение", max_length=500, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Дополнительное мероприятие"
        verbose_name_plural = "Дополнительные мероприятия"

    def __str__(self) -> str:
        return self.name
