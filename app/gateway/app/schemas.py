from pydantic import BaseModel, Field


class NotificationIn(BaseModel):
    """Оповещение от backend. Текст собирается в шлюзе: шаблон + контекст + приветствие."""

    notification_id: int | None = None
    channel: str = Field(pattern=r"^[a-z_]+$", max_length=20)
    user_name: str = Field(min_length=1, max_length=250)
    recipient: str = Field(default="", max_length=250)
    subject: str = Field(default="", max_length=250)
    template_body: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict, description="Служебные флаги, например fail=true для имитации отказа")


class PreviewIn(BaseModel):
    channel: str = "email"
    user_name: str = Field(min_length=1, max_length=250)
    template_body: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)
