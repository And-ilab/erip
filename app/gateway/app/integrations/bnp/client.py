"""Клиент ЛК Белорусской нотариальной палаты. Промышленного API нет: в MVP — заглушка.

Способ взаимодействия (API / фоновый робот RPA / ручной режим) согласуется с Заказчиком (ТЗ 4.2.10.5).
"""

from __future__ import annotations

import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

from ...core.errors import GatewayError
from .schemas import MAX_FILE_BYTES, BnpManifest

logger = logging.getLogger("gateway.bnp")


class BnpValidationError(GatewayError):
    status_code = 422
    code = "bnp_validation_error"


@dataclass(frozen=True)
class BnpSubmission:
    submission_id: str
    applications: int
    status: str


def check_files(manifest: BnpManifest, files: dict[str, int]) -> None:
    """files — имя файла → размер в байтах. Проверка наличия, формата .pdf и лимита 15 МБ."""
    problems = []
    for name in manifest.referenced_files():
        if name not in files:
            problems.append(f"{name}: файл не приложен")
        elif files[name] > MAX_FILE_BYTES:
            problems.append(f"{name}: больше 15 МБ")
    if problems:
        raise BnpValidationError("Файлы манифеста не прошли проверку", details=problems)


class BnpClient(ABC):
    @abstractmethod
    async def submit(self, manifest: BnpManifest, files: dict[str, int] | None = None) -> BnpSubmission: ...


class StubBnpClient(BnpClient):
    async def submit(self, manifest: BnpManifest, files: dict[str, int] | None = None) -> BnpSubmission:
        if files is not None:
            check_files(manifest, files)
        logger.info(
            "БНП (заглушка): манифест v%s, заявлений %s", manifest.version, len(manifest.applications),
            extra={"external_ids": [a.external_id for a in manifest.applications]},
        )
        return BnpSubmission(submission_id=f"stub-{uuid.uuid4().hex[:12]}",
                             applications=len(manifest.applications), status="validated")
