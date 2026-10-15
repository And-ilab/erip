"""Интеграции ПРИС и БНП. ПРИС ходит в боевой контур только при GW_PRIS_MODE=http."""

from functools import lru_cache

from fastapi import APIRouter, Body, Depends

from ...core.config import Settings, get_settings
from ...core.singletons import HttpClient
from ...decorators import api_response
from ...integrations.bnp.client import BnpClient, StubBnpClient
from ...integrations.bnp.dictionaries import load_dictionaries
from ...integrations.bnp.schemas import BnpManifest
from ...integrations.pris.client import (
    HttpPrisClient,
    InMemoryTokenCache,
    PrisClient,
    RedisTokenCache,
    StubPrisClient,
    TokenCache,
)
from ...integrations.pris.schemas import (
    ByNumDebtRequest,
    ByProcNumRequest,
    SaveDataDebtRequest,
    SaveDataDebtWofeRequest,
    SaveRepayRequest,
)
from ..deps import require_internal_token

router = APIRouter(prefix="/integrations", tags=["Интеграции"], dependencies=[Depends(require_internal_token)])


@lru_cache
def get_token_cache() -> TokenCache:
    settings = get_settings()
    return RedisTokenCache(settings.redis_url) if settings.redis_url else InMemoryTokenCache()


@lru_cache
def get_pris_client() -> PrisClient:
    settings: Settings = get_settings()
    if settings.pris_mode == "http":
        return HttpPrisClient(settings, HttpClient().client, get_token_cache())
    return StubPrisClient(settings, get_token_cache())


def get_bnp_client() -> BnpClient:
    return StubBnpClient()


@router.get("/pris/echo", summary="ПРИС: Echo (проверка доступности)")
@api_response
async def pris_echo(client: PrisClient = Depends(get_pris_client)):
    return {"result": await client.echo()}


@router.get("/pris/nsi", summary="ПРИС: справочники GetNSIData")
@api_response
async def pris_nsi(client: PrisClient = Depends(get_pris_client), settings: Settings = Depends(get_settings)):
    return {"mode": settings.pris_mode, "items": await client.get_nsi()}


def _pris_result(envelope, settings: Settings) -> dict:
    payload = envelope.model_dump()
    payload["mode"] = settings.pris_mode
    return payload


@router.post("/pris/claimant-info", summary="ПРИС: сведения по номеру производства (3.11.05)")
@api_response
async def pris_claimant_info(
    request: ByProcNumRequest,
    client: PrisClient = Depends(get_pris_client),
    settings: Settings = Depends(get_settings),
):
    info = await client.get_by_proc_num(request)
    return {"mode": settings.pris_mode, "items": [item.model_dump() for item in info]}


@router.post("/pris/claimant-info-by-debt", summary="ПРИС: сведения по идентификатору задолженности (3.11.04)")
@api_response
async def pris_claimant_info_by_debt(
    request: ByNumDebtRequest,
    client: PrisClient = Depends(get_pris_client),
    settings: Settings = Depends(get_settings),
):
    info = await client.get_by_num_debt(request)
    return {"mode": settings.pris_mode, "items": [item.model_dump() for item in info]}


@router.post("/pris/save-data-debt/validate", summary="ПРИС: PutClaimantSaveDataDebt (3.11.02)")
@api_response
async def pris_validate_package(
    request: SaveDataDebtRequest,
    client: PrisClient = Depends(get_pris_client),
    settings: Settings = Depends(get_settings),
):
    return _pris_result(await client.put_save_data_debt(request), settings)


@router.post("/pris/save-data-debt-wofe", summary="ПРИС: PutClaimantSaveDataDebtWOFE, файл .sgn")
@api_response
async def pris_save_wofe(
    request: SaveDataDebtWofeRequest,
    client: PrisClient = Depends(get_pris_client),
    settings: Settings = Depends(get_settings),
):
    return _pris_result(await client.put_save_data_debt_wofe(request), settings)


@router.post("/pris/save-repay-debt", summary="ПРИС: PutClaimantSaveRepayDebt (3.11.03)")
@api_response
async def pris_save_repay(
    request: SaveRepayRequest,
    client: PrisClient = Depends(get_pris_client),
    settings: Settings = Depends(get_settings),
):
    return _pris_result(await client.put_save_repay_debt(request), settings)


@router.post("/bnp/validate", summary="БНП: проверка манифеста заявления на исполнительную надпись")
@api_response
async def bnp_validate(
    manifest: BnpManifest = Body(...),
    client: BnpClient = Depends(get_bnp_client),
):
    submission = await client.submit(manifest)
    return {"submission_id": submission.submission_id, "applications": submission.applications,
            "status": submission.status}


@router.get("/bnp/dictionaries", summary="БНП: справочники услуг, типов долга и документов")
@api_response
async def bnp_dictionaries():
    d = load_dictionaries()
    return {"services": list(d.services.values()), "debt_types": d.debt_types, "doc_types": d.doc_types}

