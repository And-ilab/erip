from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


class Organization(TimeStampedModel, SoftDeleteModel):
    """Схема начисляющей организации (SCHEMA_NAME в выгрузке АИС «Расчет-ЖКУ»)."""

    schema_name = models.CharField("Имя схемы АИС", max_length=30, unique=True)
    name = models.CharField("Наименование", max_length=250)
    unp = models.CharField("УНП", max_length=9, blank=True)
    pris_claimant = models.JSONField(
        "Реквизиты взыскателя для АИС ПРИС",
        default=dict,
        blank=True,
        help_text="ОПФ, адрес и банковский счёт. Коды справочников 306, 308 и 309 задаёт пользователь.",
    )
    call_legal = models.BooleanField("Звонить юридическим лицам", default=False)
    outgoing_numbers = models.JSONField(
        "Исходящие номера обзвона",
        default=list,
        blank=True,
        help_text="Пул номеров +375. Прогон берёт следующий по кругу и передаёт его адаптеру.",
    )
    outgoing_cursor = models.PositiveIntegerField("Сдвиг ротации исходящих номеров", default=0)
    call_recording = models.BooleanField(
        "Запись разговора",
        default=False,
        help_text="Выключено, пока Asterisk не отдаёт запись.",
    )
    call_transfer = models.BooleanField(
        "Перевод на оператора",
        default=False,
        help_text="Выключено, пока Asterisk не отдаёт перевод.",
    )
    warning_wait_days = models.PositiveSmallIntegerField(
        "Дней на оплату после предупреждения", null=True, blank=True,
        help_text="Пусто — общее значение из параметров расчёта.",
    )
    step_waits = models.JSONField(
        "Ожидание перед шагом, дней", default=dict, blank=True,
        help_text="Ключ — действие шага сценария. Пустой ключ берёт срок из самого шага.",
    )
    mail_from = models.CharField(
        "E-mail отправителя", max_length=254, blank=True,
        help_text="Адрес From для писем этой схемы. Пусто — боевой SMTP письмо не примет.",
    )
    mail_from_name = models.CharField("Имя отправителя", max_length=250, blank=True)
    mail_subject = models.CharField(
        "Тема письма", max_length=250, blank=True,
        help_text="Берётся, если у шаблона тема пустая.",
    )
    mail_signature = models.CharField(
        "Подпись письма", max_length=500, blank=True,
        help_text="Пусто — шлюз ставит «С уважением, ЖКУ». Прочтение письма не отмечается.",
    )

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
        LEGAL = "legal", "Специалист ЮС"
        OBSERVER = "observer", "Наблюдатель"
        VIEWER = "viewer", "Специалист «Просмотр»"

    class Contour(models.TextChoices):
        BILLING = "billing", "Начисляющая организация"
        SUPPLIER = "supplier", "Поставщик услуг"

    role = models.CharField("Роль", max_length=20, choices=Role.choices, default=Role.SPECIALIST)
    can_approve = models.BooleanField(
        "Согласует", default=False,
        help_text="Специалист с этим признаком может пропустить мероприятие или этап воронки.",
    )
    contour = models.CharField(
        "Контур", max_length=20, choices=Contour.choices, default=Contour.BILLING,
        help_text="Поставщик видит только услуги, где его организация назначена поставщиком",
    )
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

    @property
    def registry_name(self) -> str:
        """Фамилия, имя и отчество в реестре и в группировке."""
        parts = [p for p in (self.last_name, self.first_name, self.middle_name) if p]
        return " ".join(parts) or self.username

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role = self.Role.SUPERADMIN
        super().save(*args, **kwargs)
