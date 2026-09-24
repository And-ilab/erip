"""Абстрактные базовые модели, общие для всех приложений."""

from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    # default вместо auto_now*: значения заполняются и при loaddata (raw-сохранение фикстур НСИ)
    created_at = models.DateTimeField("Создано", default=timezone.now, editable=False)
    updated_at = models.DateTimeField("Изменено", default=timezone.now, editable=False)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.updated_at = timezone.now()
        super().save(*args, **kwargs)


class ActiveQuerySet(models.QuerySet):
    def active(self):
        return self.filter(is_active=True)


class SoftDeleteModel(models.Model):
    """Деактивация вместо физического удаления (требование к НСИ, ТЗ 4.2.8.1)."""

    is_active = models.BooleanField("Активна", default=True)
    deactivated_at = models.DateTimeField("Деактивирована", null=True, blank=True)

    objects = ActiveQuerySet.as_manager()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False):
        self.is_active = False
        self.deactivated_at = timezone.now()
        self.save(update_fields=["is_active", "deactivated_at"])
        return 0, {}


class OrganizationScopedModel(TimeStampedModel):
    """Запись принадлежит схеме начисляющей организации; фильтрация — ScopedQuerysetMixin."""

    organization = models.ForeignKey(
        "users.Organization", on_delete=models.PROTECT, related_name="+", verbose_name="Организация"
    )

    class Meta:
        abstract = True
