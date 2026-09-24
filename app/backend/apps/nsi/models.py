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
