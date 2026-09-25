"""Удаляет устаревшие raw, журнал аудита и журнал ошибок. Запускать по расписанию, не на каждый запрос."""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.audit.models import AuditLog, ErrorLog
from apps.debts.models import Account, AccountService, Payment, Registration


class Command(BaseCommand):
    help = "Очистка raw выгрузок, AuditLog и ErrorLog старше заданного срока"

    def add_arguments(self, parser):
        parser.add_argument("--raw-days", type=int, default=None)
        parser.add_argument("--audit-days", type=int, default=None)
        parser.add_argument("--error-days", type=int, default=None)

    def handle(self, *args, **options):
        raw_days = settings.RAW_RETENTION_DAYS if options["raw_days"] is None else options["raw_days"]
        audit_days = settings.AUDIT_RETENTION_DAYS if options["audit_days"] is None else options["audit_days"]
        error_days = settings.ERROR_LOG_RETENTION_DAYS if options["error_days"] is None else options["error_days"]
        now = timezone.now()

        raw_cutoff = now - timedelta(days=raw_days)
        cleared = 0
        for model in (Account, AccountService, Payment, Registration):
            cleared += model.objects.filter(updated_at__lt=raw_cutoff).exclude(raw={}).update(raw={})
        audit_deleted, _ = AuditLog.objects.filter(created_at__lt=now - timedelta(days=audit_days)).delete()
        error_deleted, _ = ErrorLog.objects.filter(created_at__lt=now - timedelta(days=error_days)).delete()
        self.stdout.write(
            f"raw очищено: {cleared}, записей аудита удалено: {audit_deleted}, ошибок удалено: {error_deleted}"
        )
