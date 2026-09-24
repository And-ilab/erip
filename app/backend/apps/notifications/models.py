from django.conf import settings
from django.db import models

from apps.core.models import SoftDeleteModel, TimeStampedModel


class Channel(models.TextChoices):
    INBOX = "inbox", "Панель уведомлений ПМ"
    EMAIL = "email", "E-mail"
    SMS = "sms", "SMS"
    VOICE = "voice", "Голосовой звонок"


class MessageTemplate(TimeStampedModel, SoftDeleteModel):
    """Шаблон сообщения. organization=None — центральный шаблон, доступный всем схемам.

    Каркас с debt_group подставляется сам, когда у ЛС та же группа задолженности.
    В body — {fio}, {account}, {amount}, {address}, {debt_group}, {group_name}.
    Приветствие «Добрый день, …» и подпись добавляет шлюз.
    """

    organization = models.ForeignKey(
        "users.Organization", null=True, blank=True, on_delete=models.PROTECT, related_name="+",
        verbose_name="Схема (пусто — центральный)",
    )
    code = models.SlugField("Код", max_length=100)
    name = models.CharField("Наименование", max_length=250)
    channel = models.CharField("Канал", max_length=10, choices=Channel.choices)
    subject = models.CharField("Тема (e-mail)", max_length=250, blank=True)
    body = models.TextField("Текст")
    debt_group = models.PositiveSmallIntegerField(
        "Группа задолженности", null=True, blank=True, db_index=True,
        help_text="Если задана, каркас подставляется для ЛС с этой группой (ручная важнее расчётной).",
    )

    class Meta:
        ordering = ["debt_group", "name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "code"], name="uniq_template_code"),
            models.UniqueConstraint(
                fields=["channel", "debt_group"],
                condition=models.Q(organization__isnull=True, debt_group__isnull=False),
                name="uniq_central_template_for_debt_group",
            ),
        ]
        verbose_name = "Шаблон сообщения"
        verbose_name_plural = "Шаблоны сообщений"

    def __str__(self) -> str:
        return self.name


class Notification(TimeStampedModel):
    class Status(models.TextChoices):
        NEW = "new", "Новое"
        QUEUED = "queued", "Передано в шлюз"
        SENT = "sent", "Доставлено"
        FAILED = "failed", "Ошибка"

    organization = models.ForeignKey(
        "users.Organization", on_delete=models.PROTECT, related_name="+", verbose_name="Схема"
    )
    channel = models.CharField("Канал", max_length=10, choices=Channel.choices)
    template = models.ForeignKey(
        MessageTemplate, null=True, blank=True, on_delete=models.SET_NULL, verbose_name="Шаблон"
    )
    body = models.TextField("Текст (если без шаблона)", blank=True)
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="notifications",
        verbose_name="Получатель — пользователь ПМ",
    )
    account = models.ForeignKey(
        "debts.Account", null=True, blank=True, on_delete=models.CASCADE, related_name="notifications",
        verbose_name="Получатель — должник по ЛС",
    )
    recipient_name = models.CharField("Обращение к получателю", max_length=250, blank=True)
    recipient_address = models.CharField("Адрес (e-mail/телефон)", max_length=250, blank=True)
    context = models.JSONField("Переменные шаблона", default=dict, blank=True)
    status = models.CharField("Статус", max_length=10, choices=Status.choices, default=Status.NEW, db_index=True)
    gateway_id = models.CharField("ID в шлюзе", max_length=64, blank=True)
    rendered_text = models.TextField("Итоговый текст", blank=True)
    error = models.TextField("Ошибка", blank=True)
    request_id = models.CharField("ID запроса", max_length=64, blank=True)
    is_read = models.BooleanField("Прочитано", default=False)
    sent_at = models.DateTimeField("Доставлено", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        verbose_name="Создал",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Оповещение"
        verbose_name_plural = "Оповещения"

    def __str__(self) -> str:
        return f"{self.get_channel_display()} → {self.recipient_name or self.recipient_address} ({self.status})"
