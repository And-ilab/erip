from django.conf import settings
from django.db import models

from apps.core.models import OrganizationScopedModel


class ImportJob(OrganizationScopedModel):
    """Журнал загрузки файла выгрузки АИС: принято / отклонено / причины."""

    class Entity(models.TextChoices):
        ACCOUNT = "account", "Карточка ЛС"
        SERVICE = "service", "Услуги"
        PAYMENT = "payment", "Оплаты"
        REGISTRATION = "registration", "Регистрация"

    class Status(models.TextChoices):
        RUNNING = "running", "Выполняется"
        DONE = "done", "Завершён"
        DONE_WITH_ERRORS = "done_with_errors", "Завершён с ошибками"
        FAILED = "failed", "Ошибка"

    entity = models.CharField("Тип выгрузки", max_length=20, choices=Entity.choices)
    file_name = models.CharField("Файл", max_length=255)
    checksum = models.CharField("SHA-256", max_length=64, db_index=True)
    encoding = models.CharField("Кодировка", max_length=20, blank=True)
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.RUNNING)
    total = models.PositiveIntegerField("Строк", default=0)
    created = models.PositiveIntegerField("Создано", default=0)
    updated = models.PositiveIntegerField("Обновлено", default=0)
    unchanged = models.PositiveIntegerField("Без изменений", default=0)
    rejected = models.PositiveIntegerField("Отклонено", default=0)
    errors = models.JSONField("Причины отклонения", default=list, blank=True)
    unknown_columns = models.JSONField("Колонки без сопоставления", default=list, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, verbose_name="Запустил"
    )
    finished_at = models.DateTimeField("Завершён", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Импорт выгрузки"
        verbose_name_plural = "Журнал импорта"

    def __str__(self) -> str:
        return f"{self.get_entity_display()} {self.file_name} ({self.get_status_display()})"
