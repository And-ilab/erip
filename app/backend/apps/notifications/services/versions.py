"""Версии шаблонов сообщений. Отправленное оповещение хранит номер и не переписывается."""

from rest_framework.exceptions import ValidationError

from apps.notifications.models import MessageTemplate, MessageTemplateRevision


def remember_template(template: MessageTemplate, previous_body: str | None, previous_subject: str | None, user):
    if previous_body is None:
        MessageTemplateRevision.objects.get_or_create(
            template=template, version=template.version,
            defaults={"body": template.body, "subject": template.subject, "author": user},
        )
        return template
    MessageTemplateRevision.objects.get_or_create(
        template=template, version=template.version,
        defaults={"body": previous_body, "subject": previous_subject or "", "author": user},
    )
    if previous_body == template.body and (previous_subject or "") == (template.subject or ""):
        return template
    template.version += 1
    template.save(update_fields=["version", "updated_at"])
    MessageTemplateRevision.objects.create(
        template=template, version=template.version, body=template.body, subject=template.subject, author=user,
    )
    return template


def restore_template(template: MessageTemplate, version: int, user) -> MessageTemplate:
    revision = template.revisions.filter(version=version).first()
    if revision is None:
        raise ValidationError("Такой версии шаблона нет")
    previous_body, previous_subject = template.body, template.subject
    template.body = revision.body
    template.subject = revision.subject
    template.save(update_fields=["body", "subject", "updated_at"])
    return remember_template(template, previous_body, previous_subject, user)
