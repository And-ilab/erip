"""Импорт выгрузок АИС «Расчет-ЖКУ»: идемпотентный upsert с журналом ImportJob.

Повторная загрузка того же файла не создаёт дублей: записи ищутся по ключу
(схема + ключ из field_maps), неизменённые строки не перезаписываются.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from django.db import models, transaction
from django.utils import timezone

from apps.debts.models import Account
from apps.debts.services.grouping import DebtGroupCalculator
from apps.users.models import Organization, ServiceOrganization

from .field_maps import ACCOUNT_LOOKUP, ENTITY_MAPS, EntityMap
from .models import ImportJob
from .parsing import ConversionError, bind_columns, convert, decode, read_rows

logger = logging.getLogger(__name__)

MAX_STORED_ERRORS = 1000


class RowRejected(Exception):
    pass


@dataclass
class RowResult:
    status: str  # created | updated | unchanged
    account_pk: int | None = None


class AisImporter:
    def __init__(self, entity: str, organization: Organization, user=None):
        if entity not in ENTITY_MAPS:
            raise ValueError(f"Неизвестный тип выгрузки: {entity}")
        self.map: EntityMap = ENTITY_MAPS[entity]
        self.organization = organization
        self.user = user
        self._accounts: dict[int, Account] = {}
        self._last_pk: int | None = None
        self._max_lengths = {
            f.name: f.max_length for f in self.map.model._meta.fields if isinstance(f, models.CharField)
        }

    def run(self, content: bytes, file_name: str) -> ImportJob:
        job = ImportJob.objects.create(
            organization=self.organization,
            entity=self.map.entity,
            file_name=file_name[:255],
            checksum=hashlib.sha256(content).hexdigest(),
            started_by=self.user if getattr(self.user, "is_authenticated", False) else None,
        )
        try:
            text, job.encoding = decode(content)
            headers, rows = read_rows(text)
            bindings, job.unknown_columns = bind_columns(headers, self.map)
            missing = [k for k in self.map.key if k not in {b.spec.field for b in bindings if b.spec}]
            if missing:
                raise ConversionError(f"В файле нет ключевых колонок: {', '.join(missing)}")
            touched_accounts: set[int] = set()
            for line_no, row in enumerate(rows, start=2):
                job.total += 1
                try:
                    with transaction.atomic():
                        result = self._import_row(row, bindings, job)
                except (RowRejected, ConversionError) as exc:
                    self._reject(job, line_no, str(exc))
                    continue
                setattr(job, result.status, getattr(job, result.status) + 1)
                if result.account_pk:
                    touched_accounts.add(result.account_pk)
            self._after_import(touched_accounts)
            job.status = ImportJob.Status.DONE_WITH_ERRORS if job.rejected else ImportJob.Status.DONE
        except ConversionError as exc:
            job.status = ImportJob.Status.FAILED
            self._reject(job, 0, str(exc))
        except Exception as exc:
            job.status = ImportJob.Status.FAILED
            self._reject(job, 0, f"Внутренняя ошибка: {exc}")
            from apps.audit.services import record_error

            record_error(exc, path=f"import:{self.map.entity}")
        job.finished_at = timezone.now()
        job.save()
        logger.info(
            "Импорт %s завершён: %s", self.map.entity, job.status,
            extra={"import_job": job.pk, "rows_created": job.created, "rows_updated": job.updated,
                   "rows_rejected": job.rejected},
        )
        return job

    # ------------------------------------------------------------------ строки

    def _import_row(self, row: list[str], bindings, job: ImportJob) -> RowResult:
        values: dict = {}
        raw: dict = {}
        for binding in bindings:
            cell = row[binding.index] if binding.index < len(row) else ""
            raw[binding.raw_key] = cell
            spec = binding.spec
            if spec is None or spec.field is None:
                continue
            try:
                value = convert(cell, spec.kind)
            except ConversionError as exc:
                raise RowRejected(f"{binding.raw_key}: {exc}") from exc
            if isinstance(value, str) and spec.field in self._max_lengths:
                value = value[: self._max_lengths[spec.field]]
            values[spec.field] = value

        for key in self.map.key:
            if values.get(key) in (None, ""):
                raise RowRejected(f"Не заполнено ключевое поле {key}")

        lookup = {"organization": self.organization}
        account = None
        if self.map.parent:
            account = self._account(values.pop(ACCOUNT_LOOKUP, None))
            lookup["account"] = account
        else:
            self._check_schema(values)
        lookup.update({k: values.pop(k) for k in self.map.key})
        values["raw"] = raw

        status = self._upsert(lookup, values, job)
        if self.map.parent:
            return RowResult(status, account.pk)
        return RowResult(status, self._last_pk)

    def _check_schema(self, values: dict) -> None:
        schema = values.get("schema_name")
        if schema and schema != self.organization.schema_name:
            raise RowRejected(f"ЛС относится к схеме {schema}, а импорт выполняется в {self.organization.schema_name}")

    def _account(self, account_id: int | None) -> Account:
        if account_id is None:
            raise RowRejected("Не заполнен ACCOUNT_ID")
        if account_id not in self._accounts:
            account = Account.objects.filter(organization=self.organization, account_id=account_id).first()
            if account is None:
                raise RowRejected(f"ЛС с ACCOUNT_ID={account_id} не найден — сначала загрузите «Карточку ЛС»")
            self._accounts[account_id] = account
        return self._accounts[account_id]

    def _upsert(self, lookup: dict, values: dict, job: ImportJob) -> str:
        model = self.map.model
        instance = model.objects.filter(**lookup).first()
        if instance is None:
            instance = model.objects.create(**lookup, **values, import_job=job)
            self._last_pk = instance.pk
            return "created"
        self._last_pk = instance.pk
        changed = [name for name, value in values.items() if getattr(instance, name) != value]
        if not changed:
            return "unchanged"
        for name in changed:
            setattr(instance, name, values[name])
        instance.import_job = job
        instance.save(update_fields=[*changed, "import_job", "updated_at"])
        return "updated"

    def _reject(self, job: ImportJob, line_no: int, reason: str) -> None:
        if line_no:
            job.rejected += 1
        if len(job.errors) < MAX_STORED_ERRORS:
            job.errors.append({"line": line_no, "reason": reason})

    # ------------------------------------------------------------------ после импорта

    def _after_import(self, account_pks: set[int]) -> None:
        if not account_pks:
            return
        accounts = Account.objects.filter(pk__in=account_pks)
        if self.map.entity == "account":
            self._sync_service_organizations(accounts)
        if self.map.entity in {"account", "service"}:
            DebtGroupCalculator().recalculate_many(accounts.prefetch_related("services"))

    def _sync_service_organizations(self, accounts) -> None:
        """Справочник обслуживающих организаций пополняется из выгрузки (ТЗ 4.2.8.6)."""
        pairs = accounts.values_list("provider_id", "provider_short_name").distinct()
        for provider_id, short_name in pairs:
            ServiceOrganization.objects.get_or_create(
                organization=self.organization,
                provider_id=provider_id,
                defaults={"short_name": short_name or str(provider_id)},
            )
