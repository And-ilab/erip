from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


class Organization(TimeStampedModel, SoftDeleteModel):
    """Схема начисляющей организации (SCHEMA_NAME в выгрузке АИС «Расчет-ЖКУ»)."""

    schema_name = models.CharField("Имя схемы АИС", max_length=30, unique=True)
    name = models.CharField("Наименование", max_length=250)
    unp = models.CharField("УНП", max_length=9, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Схема начисляющей организации"
        verbose_name_plural = "Схемы начисляющих организаций"

    def __str__(self) -> str:
        return self.name


class ServiceOrganization(TimeStampedModel, SoftDeleteModel):
    """Обслуживающая организация / поставщик внутри схемы (PROVIDER_ID в выгрузке)."""

    organization = models.ForeignKey(
        Organization, on_delete=models.PROTECT, related_name="service_organizations", verbose_name="Схема"
    )
    provider_id = models.BigIntegerField("Код организации в АИС")
    short_name = models.CharField("Краткое наименование", max_length=100)
    full_name = models.CharField("Полное наименование", max_length=250, blank=True)
    is_supplier = models.BooleanField("Поставщик услуг", default=False)

    class Meta:
        ordering = ["short_name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "provider_id"], name="uniq_service_org_provider")
        ]
        verbose_name = "Обслуживающая организация"
        verbose_name_plural = "Обслуживающие организации"

    def __str__(self) -> str:
        return self.short_name


class User(AbstractUser):
    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Суперадминистратор"
        LOCAL_ADMIN = "local_admin", "Локальный администратор"
        SPECIALIST = "specialist", "Специалист"
        OBSERVER = "observer", "Наблюдатель"

    role = models.CharField("Роль", max_length=20, choices=Role.choices, default=Role.SPECIALIST)
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.PROTECT, related_name="users", verbose_name="Схема"
    )
    # Пустой список = доступ ко всем обслуживающим организациям схемы (ТЗ 4.2.9.4)
    service_organizations = models.ManyToManyField(
        ServiceOrganization, blank=True, related_name="users", verbose_name="Контур: обслуживающие организации"
    )
    middle_name = models.CharField("Отчество", max_length=150, blank=True)
    position = models.CharField("Должность", max_length=250, blank=True)
    phone = models.CharField("Телефон", max_length=50, blank=True)

    class Meta:
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"

    @property
    def is_superadmin(self) -> bool:
        return self.role == self.Role.SUPERADMIN

    @property
    def display_name(self) -> str:
        """Имя для обращения в оповещениях: «Имя Отчество» или логин."""
        parts = [p for p in (self.first_name, self.middle_name) if p]
        return " ".join(parts) or self.get_full_name() or self.username

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role = self.Role.SUPERADMIN
        super().save(*args, **kwargs)
