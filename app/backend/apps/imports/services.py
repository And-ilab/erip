"""Импорт выгрузок АИС «Расчет-ЖКУ»: идемпотентный upsert с журналом ImportJob.

Повторная загрузка того же файла не создаёт дублей: записи ищутся по ключу
(схема + ключ из field_maps), неизменённые строки не перезаписываются.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from django.db import models, transaction
from django.utils import timezone

from apps.debts.models import Account
from apps.debts.services.grouping import DebtGroupCalculator
from apps.users.models import Organization, ServiceOrganization

from .field_maps import ACCOUNT_LOOKUP, ENTITY_MAPS, EntityMap
from .models import ImportJob
from .parsing import ConversionError, bind_columns, convert, decode, detect_encoding_path, read_header, read_rows

logger = logging.getLogger(__name__)

MAX_STORED_ERRORS = 1000
WRITE_BATCH = 500


class RowRejected(Exception):
    pass


class AisImporter:
    def __init__(self, entity: str, organization: Organization, user=None):
        if entity not in ENTITY_MAPS:
            raise ValueError(f"Неизвестный тип выгрузки: {entity}")
        self.map: EntityMap = ENTITY_MAPS[entity]
        self.organization = organization
        self.user = user
        self._accounts: dict[int, Account] = {}
        self._max_lengths = {
            f.name: f.max_length for f in self.map.model._meta.fields if isinstance(f, models.CharField)
        }

    def run(self, content: bytes, file_name: str) -> ImportJob:
        job = self._new_job(file_name, hashlib.sha256(content).hexdigest())

        def work() -> None:
            text, encoding = decode(content)
            headers, rows = read_rows(text)
            self._consume(job, encoding, headers, rows)

        return self._finish(job, work)

    def run_path(self, path: Path) -> ImportJob:
        """Потоковое чтение файла: для полной выгрузки АИС, которую нельзя держать в памяти HTTP-запроса."""
        job = self._new_job(path.name, self._checksum(path))

        def work() -> None:
            encoding = detect_encoding_path(path)
            with path.open("r", encoding=encoding, newline="") as fh:
                headers, reader = read_header(fh)
                self._consume(job, encoding, headers, reader)

        return self._finish(job, work)

    def _new_job(self, file_name: str, checksum: str) -> ImportJob:
        return ImportJob.objects.create(
            organization=self.organization,
            entity=self.map.entity,
            file_name=file_name[:255],
            checksum=checksum,
            started_by=self.user if getattr(self.user, "is_authenticated", False) else None,
        )

    @staticmethod
    def _checksum(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _finish(self, job: ImportJob, work) -> ImportJob:
        try:
            work()
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

    def _consume(self, job: ImportJob, encoding: str, headers: list[str], rows) -> None:
        job.encoding = encoding
        bindings, job.unknown_columns = bind_columns(headers, self.map)
        missing = [k for k in self.map.key if k not in {b.spec.field for b in bindings if b.spec}]
        if missing:
            raise ConversionError(f"В файле нет ключевых колонок: {', '.join(missing)}")
        touched: set[int] = set()
        pending: list[tuple[int, dict]] = []
        data_rows = (row for row in rows if any((cell or "").strip() for cell in row))
        for line_no, row in enumerate(data_rows, start=2):
            job.total += 1
            try:
                pending.append((line_no, self._values(row, bindings)))
            except (RowRejected, ConversionError) as exc:
                self._reject(job, line_no, str(exc))
                continue
            if len(pending) >= WRITE_BATCH:
                self._flush(pending, job, touched)
                pending = []
        self._flush(pending, job, touched)
        self._after_import(touched)
        job.status = ImportJob.Status.DONE_WITH_ERRORS if job.rejected else ImportJob.Status.DONE

    def _values(self, row: list[str], bindings) -> dict:
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
        values["raw"] = raw
        return values

    def _flush(self, pending: list[tuple[int, dict]], job: ImportJob, touched: set[int]) -> None:
        if not pending:
            return
        if self.map.parent:
            self._warm_accounts({values.get(ACCOUNT_LOOKUP) for _, values in pending})
        ready: list[tuple[dict, dict]] = []
        for line_no, values in pending:
            try:
                ready.append(self._lookup(values))
            except (RowRejected, ConversionError) as exc:
                self._reject(job, line_no, str(exc))
        self._write(ready, job, touched)

    def _lookup(self, values: dict) -> tuple[dict, dict]:
        values = dict(values)
        lookup = {"organization": self.organization}
        if self.map.parent:
            account_id = values.pop(ACCOUNT_LOOKUP, None)
            if account_id is None:
                raise RowRejected("Не заполнен ACCOUNT_ID")
            account = self._accounts.get(account_id)
            if account is None:
                raise RowRejected(f"ЛС с ACCOUNT_ID={account_id} не найден — сначала загрузите «Карточку ЛС»")
            lookup["account"] = account
        else:
            self._check_schema(values)
        lookup.update({key: values.pop(key) for key in self.map.key})
        return lookup, values

    def _lookup_key(self, lookup: dict) -> tuple:
        if self.map.parent:
            return (lookup["account"].pk, *(lookup[key] for key in self.map.key))
        return tuple(lookup[key] for key in self.map.key)

    def _object_key(self, obj) -> tuple:
        if self.map.parent:
            return (obj.account_id, *(getattr(obj, key) for key in self.map.key))
        return tuple(getattr(obj, key) for key in self.map.key)

    def _load_existing(self, items: list[tuple[dict, dict]]) -> dict:
        model = self.map.model
        if self.map.parent:
            ids = {lookup["account"].pk for lookup, _values in items}
            found = model.objects.filter(account_id__in=ids)
        else:
            ids = {lookup["account_id"] for lookup, _values in items}
            found = model.objects.filter(organization=self.organization, account_id__in=ids)
        return {self._object_key(obj): obj for obj in found}

    def _write(self, items: list[tuple[dict, dict]], job: ImportJob, touched: set[int]) -> None:
        if not items:
            return
        model = self.map.model
        index = self._load_existing(items)
        to_create: list = []
        to_update: dict = {}
        update_fields: set[str] = set()
        now = timezone.now()
        with transaction.atomic():
            for lookup, values in items:
                key = self._lookup_key(lookup)
                instance = index.get(key)
                if instance is None:
                    instance = model(**lookup, **values, import_job=job, updated_at=now)
                    index[key] = instance
                    to_create.append(instance)
                    job.created += 1
                else:
                    changed = [name for name, value in values.items() if getattr(instance, name) != value]
                    if not changed:
                        job.unchanged += 1
                    else:
                        for name in changed:
                            setattr(instance, name, values[name])
                        instance.import_job = job
                        instance.updated_at = now
                        job.updated += 1
                        if instance.pk:
                            to_update[instance.pk] = instance
                            update_fields.update(changed)
                if self.map.parent:
                    touched.add(lookup["account"].pk)
            if to_create:
                model.objects.bulk_create(to_create, batch_size=WRITE_BATCH)
            if to_update:
                model.objects.bulk_update(
                    list(to_update.values()), [*update_fields, "import_job", "updated_at"], batch_size=WRITE_BATCH,
                )
        if not self.map.parent:
            for instance in to_create:
                touched.add(instance.pk)
                self._accounts[instance.account_id] = instance

    def _check_schema(self, values: dict) -> None:
        schema = values.get("schema_name")
        if schema and schema != self.organization.schema_name:
            raise RowRejected(f"ЛС относится к схеме {schema}, а импорт выполняется в {self.organization.schema_name}")

    def _warm_accounts(self, account_ids: set) -> None:
        missing = [
            account_id for account_id in account_ids
            if account_id is not None and account_id not in self._accounts
        ]
        if not missing:
            return
        for account in Account.objects.filter(organization=self.organization, account_id__in=missing):
            self._accounts[account.account_id] = account

    def _reject(self, job: ImportJob, line_no: int, reason: str) -> None:
        if line_no:
            job.rejected += 1
        if len(job.errors) < MAX_STORED_ERRORS:
            job.errors.append({"line": line_no, "reason": reason})

    # ------------------------------------------------------------------ после импорта

    def _after_import(self, account_pks: set[int]) -> None:
        if not account_pks:
            return
        pks = list(account_pks)
        for start in range(0, len(pks), WRITE_BATCH):
            accounts = Account.objects.filter(pk__in=pks[start:start + WRITE_BATCH])
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
