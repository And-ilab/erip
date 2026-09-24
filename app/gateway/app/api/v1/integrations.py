"""Проверочные эндпоинты каркаса интеграций (реальные вызовы ПРИС/БНП в MVP не выполняются)."""

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
from ...integrations.pris.schemas import ByProcNumRequest, SaveDataDebtRequest

router = APIRouter(prefix="/integrations", tags=["Интеграции"])


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


@router.post("/pris/claimant-info", summary="ПРИС: сведения по номеру производства")
@api_response
async def pris_claimant_info(request: ByProcNumRequest, client: PrisClient = Depends(get_pris_client)):
    info = await client.get_by_proc_num(request)
    return [i.model_dump() for i in info]


@router.post("/pris/save-data-debt/validate", summary="ПРИС: проверка пакета PutClaimantSaveDataDebt")
@api_response
async def pris_validate_package(request: SaveDataDebtRequest, client: PrisClient = Depends(get_pris_client)):
    envelope = await client.put_save_data_debt(request)
    return envelope.model_dump()


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

