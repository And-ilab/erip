from django.conf import settings
from django.db import models


class ErrorLog(models.Model):
    """Журнал ошибок backend и шлюза (видит только суперадминистратор)."""

    service = models.CharField("Сервис", max_length=50, default="backend")
    request_id = models.CharField("ID запроса", max_length=64, blank=True, db_index=True)
    path = models.CharField("Путь", max_length=500, blank=True)
    error_type = models.CharField("Тип ошибки", max_length=200)
    message = models.TextField("Сообщение")
    traceback = models.TextField("Трассировка", blank=True)
    user_id = models.BigIntegerField("Пользователь", null=True, blank=True)
    created_at = models.DateTimeField("Создано", auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Ошибка"
        verbose_name_plural = "Журнал ошибок"

    def __str__(self) -> str:
        return f"[{self.service}] {self.error_type}: {self.message[:80]}"


class AuditLog(models.Model):
    """Журнал действий пользователей, включая просмотр карточек (ТЗ 4.4.4)."""

    class Action(models.TextChoices):
        CREATE = "create", "Создание"
        UPDATE = "update", "Изменение"
        DELETE = "delete", "Удаление/деактивация"
        VIEW = "view", "Просмотр"
        IMPORT = "import", "Импорт"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, verbose_name="Пользователь"
    )
    action = models.CharField("Действие", max_length=20, choices=Action.choices)
    object_type = models.CharField("Объект", max_length=100)
    object_id = models.CharField("ID объекта", max_length=64, blank=True)
    before = models.JSONField("До", null=True, blank=True)
    after = models.JSONField("После", null=True, blank=True)
    request_id = models.CharField("ID запроса", max_length=64, blank=True)
    ip = models.GenericIPAddressField("IP", null=True, blank=True)
    created_at = models.DateTimeField("Время", auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Запись аудита"
        verbose_name_plural = "Журнал аудита"
