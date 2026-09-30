from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


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
    """Категория должника (ТЗ 4.2.1.4, 4.2.2.6). Пустая организация — центральная запись НСИ."""

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="debtor_categories",
        verbose_name="Схема",
    )
    code = models.CharField("Код", max_length=50)
    name = models.CharField("Наименование", max_length=250)
    note = models.CharField("Влияние на сценарии", max_length=500, blank=True)

    class Meta:
        ordering = ["name"]
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

    class Meta:
        ordering = ["name"]
        verbose_name = "Сценарий мероприятий"
        verbose_name_plural = "Сценарии мероприятий"

    def __str__(self) -> str:
        return self.name


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
    body = models.TextField("Текст")
    version = models.PositiveIntegerField("Версия", default=1)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "code"], name="uniq_print_form_code"),
            models.UniqueConstraint(
                fields=["code"], condition=models.Q(organization__isnull=True), name="uniq_central_print_form",
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

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["form", "version"], name="uniq_print_form_revision"),
        ]
        verbose_name = "Версия печатной формы"
        verbose_name_plural = "Версии печатных форм"


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
