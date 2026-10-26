"""Клиент АИС ПРИС. По умолчанию — заглушка (реальные вызовы в MVP не выполняются).

Авторизация по регламенту: POST /core/auth/authorizate с x-user_id и x-accesskey → x-token и
x-timestamp (живут 30 минут); далее каждый вызов передаёт x-user_id, x-token, x-timestamp.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from ...core.config import Settings
from ...core.errors import GatewayError
from .schemas import (
    AuthorizeResponse,
    ByNumDebtRequest,
    ByProcNumRequest,
    ClaimantInfo,
    Envelope,
    SaveDataDebtRequest,
    SaveDataDebtWofeRequest,
    SaveRepayRequest,
)

logger = logging.getLogger("gateway.pris")


class PrisEndpoints:
    AUTHORIZE = "/core/auth/authorizate"
    LOGOUT = "/core/auth/logout"
    ECHO = "/core/service/Echo"
    VERSION = "/core/service/Version"
    GET_IP = "/core/service/GetIP"
    GET_STAT = "/core/service/getstat"
    BY_PROC_NUM = "/core/bi/GetClaimantInfoByProcNum"
    BY_NUM_DEBT = "/core/bi/GetClaimantInfoByNumDebt"
    SAVE_DATA_DEBT = "/core/BI/PutClaimantSaveDataDebt"
    SAVE_DATA_DEBT_WOFE = "/core/BI/PutClaimantSaveDataDebtWOFE"
    SAVE_REPAY_DEBT = "/core/BI/PutClaimantSaveRepayDebt"
    NSI = "/core/BI/NSI/GetNSIData"


class PrisError(GatewayError):
    status_code = 502
    code = "pris_error"


# ---------------------------------------------------------------- кэш токена

@dataclass(frozen=True)
class PrisToken:
    token: str
    timestamp: str


class TokenCache(ABC):
    @abstractmethod
    async def get(self) -> PrisToken | None: ...

    @abstractmethod
    async def peek(self) -> PrisToken | None: ...

    @abstractmethod
    async def set(self, token: PrisToken, ttl_seconds: int) -> None: ...

    @abstractmethod
    async def clear(self) -> None: ...


class InMemoryTokenCache(TokenCache):
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._token: PrisToken | None = None
        self._expires_at = 0.0

    async def get(self) -> PrisToken | None:
        if self._token is not None and self._clock() < self._expires_at:
            return self._token
        return None

    async def set(self, token: PrisToken, ttl_seconds: int) -> None:
        self._token, self._expires_at = token, self._clock() + ttl_seconds

    async def peek(self) -> PrisToken | None:
        return self._token

    async def clear(self) -> None:
        self._token, self._expires_at = None, 0.0


class RedisTokenCache(TokenCache):
    """Общий кэш токена для нескольких реплик шлюза."""

    key = "gateway:pris:token"
    last_key = "gateway:pris:token:last"

    def __init__(self, redis_url: str):
        from redis.asyncio import Redis

        self.redis = Redis.from_url(redis_url, decode_responses=True)

    async def get(self) -> PrisToken | None:
        value = await self.redis.get(self.key)
        if not value:
            return None
        token, _, timestamp = value.partition("|")
        return PrisToken(token, timestamp)

    async def peek(self) -> PrisToken | None:
        value = await self.redis.get(self.last_key)
        if not value:
            return None
        token, _, timestamp = value.partition("|")
        return PrisToken(token, timestamp)

    async def set(self, token: PrisToken, ttl_seconds: int) -> None:
        raw = f"{token.token}|{token.timestamp}"
        await self.redis.set(self.key, raw, ex=ttl_seconds)
        await self.redis.set(self.last_key, raw, ex=86400)

    async def clear(self) -> None:
        await self.redis.delete(self.key, self.last_key)


# ---------------------------------------------------------------- клиенты

class PrisClient(ABC):
    @abstractmethod
    async def authorize(self) -> PrisToken: ...

    @abstractmethod
    async def logout(self) -> None: ...

    @abstractmethod
    async def echo(self) -> str: ...

    @abstractmethod
    async def version(self) -> str: ...

    @abstractmethod
    async def get_by_proc_num(self, request: ByProcNumRequest) -> list[ClaimantInfo]: ...

    @abstractmethod
    async def get_by_num_debt(self, request: ByNumDebtRequest) -> list[ClaimantInfo]: ...

    @abstractmethod
    async def put_save_data_debt(self, request: SaveDataDebtRequest) -> Envelope: ...

    @abstractmethod
    async def put_save_data_debt_wofe(self, request: SaveDataDebtWofeRequest) -> Envelope: ...

    @abstractmethod
    async def put_save_repay_debt(self, request: SaveRepayRequest) -> Envelope: ...

    @abstractmethod
    async def get_nsi(self) -> list[dict]: ...


class _TokenMixin:
    cache: TokenCache
    settings: Settings

    async def token(self) -> PrisToken:
        cached = await self.cache.get()
        if cached is not None:
            return cached
        # Регламент: новый x-token выдаётся после logout. Истёкший токен ещё доступен через peek.
        await self._end_session()
        token = await self.authorize()
        # Запас 60 с, чтобы не отправить запрос с истекающим токеном
        await self.cache.set(token, max(self.settings.pris_token_ttl_seconds - 60, 60))
        return token

    async def _end_session(self) -> None:
        stale = await self.cache.peek()
        await self.cache.clear()
        if stale is None:
            return
        try:
            await self.logout_token(stale)
        except Exception:
            logger.info("ПРИС: logout перед новой авторизацией не выполнен")

    async def logout_token(self, token: PrisToken) -> None:
        return None


class HttpPrisClient(_TokenMixin, PrisClient):
    """Реальный клиент по регламенту (включается после получения доступа к тестовому контуру)."""

    def __init__(self, settings: Settings, http: httpx.AsyncClient, cache: TokenCache | None = None):
        self.settings = settings
        self.http = http
        self.cache = cache or InMemoryTokenCache()
        self.base_url = settings.pris_base_url.rstrip("/")

    async def authorize(self) -> PrisToken:
        response = await self.http.post(
            self.base_url + PrisEndpoints.AUTHORIZE,
            headers={"x-user_id": self.settings.pris_user_id, "x-accesskey": self.settings.pris_access_key},
        )
        self._raise_for_status(response)
        body = response.json()
        if "x-token" not in body:
            raise PrisError(f"ПРИС: авторизация отклонена — {body.get('response') or body.get('message')}")
        auth = AuthorizeResponse.model_validate(body)
        return PrisToken(auth.x_token, auth.x_timestamp)

    async def logout(self) -> None:
        token = await self.cache.get() or await self.cache.peek()
        await self.cache.clear()
        if token is not None:
            await self.logout_token(token)

    async def logout_token(self, token: PrisToken) -> None:
        await self.http.post(
            self.base_url + PrisEndpoints.LOGOUT, headers={"x-token": token.token}, timeout=20.0,
        )

    async def _headers(self) -> dict:
        token = await self.token()
        return {"x-user_id": self.settings.pris_user_id, "x-token": token.token, "x-timestamp": token.timestamp}

    async def _get_result(self, path: str) -> str:
        response = await self.http.get(self.base_url + path, timeout=20.0)
        self._raise_for_status(response)
        return str(response.json().get("result", ""))

    async def _post(self, path: str, payload: dict | None, *, accepted: bool = False) -> Envelope:
        response = await self.http.post(
            self.base_url + path, json=payload, headers=await self._headers(), timeout=60.0,
        )
        if response.status_code == 401:
            await self._end_session()
            response = await self.http.post(
                self.base_url + path, json=payload, headers=await self._headers(), timeout=60.0,
            )
        self._raise_for_status(response)
        envelope = Envelope.model_validate(response.json())
        if accepted:
            reason = envelope.put_rejection()
            if reason:
                raise PrisError(f"ПРИС: {reason}")
        elif not envelope.ok:
            raise PrisError(f"ПРИС: {envelope.message or envelope.tag or 'ошибка бизнес-логики'}")
        return envelope

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code >= 400:
            raise PrisError(f"ПРИС вернул HTTP {response.status_code}", details=response.text[:500])

    async def echo(self) -> str:
        return await self._get_result(PrisEndpoints.ECHO)

    async def version(self) -> str:
        return await self._get_result(PrisEndpoints.VERSION)

    async def get_by_proc_num(self, request: ByProcNumRequest) -> list[ClaimantInfo]:
        envelope = await self._post(PrisEndpoints.BY_PROC_NUM, request.pris_body())
        return [ClaimantInfo.model_validate(item) for item in envelope.data]

    async def get_by_num_debt(self, request: ByNumDebtRequest) -> list[ClaimantInfo]:
        envelope = await self._post(PrisEndpoints.BY_NUM_DEBT, request.pris_body())
        return [ClaimantInfo.model_validate(item) for item in envelope.data]

    async def put_save_data_debt(self, request: SaveDataDebtRequest) -> Envelope:
        return await self._post(PrisEndpoints.SAVE_DATA_DEBT, request.model_dump(mode="json"), accepted=True)

    async def put_save_data_debt_wofe(self, request: SaveDataDebtWofeRequest) -> Envelope:
        return await self._post(PrisEndpoints.SAVE_DATA_DEBT_WOFE, request.model_dump(mode="json"), accepted=True)

    async def put_save_repay_debt(self, request: SaveRepayRequest) -> Envelope:
        return await self._post(PrisEndpoints.SAVE_REPAY_DEBT, request.model_dump(mode="json"), accepted=True)

    async def get_nsi(self) -> list[dict]:
        response = await self.http.post(
            self.base_url + PrisEndpoints.NSI, headers=await self._headers(), timeout=60.0,
        )
        if response.status_code == 401:
            await self._end_session()
            response = await self.http.post(
                self.base_url + PrisEndpoints.NSI, headers=await self._headers(), timeout=60.0,
            )
        self._raise_for_status(response)
        body = response.json()
        if isinstance(body, dict) and body.get("code") == "0":
            raise PrisError(f"ПРИС: {body.get('message') or body.get('tag') or 'справочник не получен'}")
        if not isinstance(body, list):
            raise PrisError("ПРИС: справочник пришёл не массивом")
        return body


def _stub_accepted(cl_num: str) -> Envelope:
    return Envelope(
        code="1",
        data=[{
            "responseId": f"stub-{cl_num}",
            "processStatus": 1000,
            "processMessage": "Данные получены успешно!",
        }],
    )


# Сокращённый пример GetNSIData из регламента: только справочник 120. Остальные номера
# приходят с контура Минюста, в заглушку их не подставляем.
STUB_NSI = [{
    "type": "120",
    "type_name": "ОРГАНЫ ПРИНУДИТЕЛЬНОГО ИСПОЛНЕНИЯ МИНИСТЕРСТВА ЮСТИЦИИ",
    "content": {
        "code": "1",
        "data": [
            {"code": 0, "lex1": "(пусто)", "code_sorting": 0},
            {"code": 801, "lex1": "ГУПИ МИНИСТЕРСТВА ЮСТИЦИИ РЕСПУБЛИКИ БЕЛАРУСЬ", "code_sorting": 0},
        ],
        "message": "",
        "tag": "",
    },
}]


SAMPLE_CLAIMANT_INFO = {
    "p_ispdoc": [{"doc_name": "15", "doc_num": "7-5334", "doc_date": "02.11.2017 0:00:00", "proc_num": "60118000051",
                  "opi": "601", "crednum": "", "req_init": "205"}],
    "p_ost": [{"req_sum": "1279,44", "ost_sum": "1270,62", "curr_code": "933"}],
    "p_status": [{"status": "6", "date_status": "28.06.2018 0:00:00", "reason": "", "actual": "1"}],
    "p_action": [], "p_nachisl": [], "p_repay": [], "p_cred": [], "p_debt": [],
}


class StubPrisClient(_TokenMixin, PrisClient):
    """Заглушка: логирует вызовы, валидирует запросы схемами регламента, возвращает пример из регламента."""

    def __init__(self, settings: Settings, cache: TokenCache | None = None):
        self.settings = settings
        self.cache = cache or InMemoryTokenCache()
        self.authorize_calls = 0

    async def authorize(self) -> PrisToken:
        self.authorize_calls += 1
        logger.info("ПРИС (заглушка): authorizate")
        return PrisToken(token=f"stub-token-{self.authorize_calls}", timestamp=time.strftime("%d.%m.%Y %H:%M:%S"))

    async def logout(self) -> None:
        await self.cache.clear()

    async def echo(self) -> str:
        token = await self.token()
        return f"Echo: заглушка ПРИС ({self.settings.pris_base_url}), токен {token.token}"

    async def version(self) -> str:
        return "Версия API: stub"

    async def get_by_proc_num(self, request: ByProcNumRequest) -> list[ClaimantInfo]:
        await self.token()
        info = dict(SAMPLE_CLAIMANT_INFO)
        info["p_ispdoc"] = [{**SAMPLE_CLAIMANT_INFO["p_ispdoc"][0], "proc_num": request.p_proc_num}]
        return [ClaimantInfo.model_validate(info)]

    async def get_by_num_debt(self, request: ByNumDebtRequest) -> list[ClaimantInfo]:
        await self.token()
        return [ClaimantInfo.model_validate(SAMPLE_CLAIMANT_INFO)]

    async def put_save_data_debt(self, request: SaveDataDebtRequest) -> Envelope:
        await self.token()
        logger.info("ПРИС (заглушка): PutClaimantSaveDataDebt, записей %s", len(request.package))
        return _stub_accepted(request.package[0].identif.p_cl_num)

    async def put_save_data_debt_wofe(self, request: SaveDataDebtWofeRequest) -> Envelope:
        await self.token()
        logger.info("ПРИС (заглушка): PutClaimantSaveDataDebtWOFE, записей %s", len(request.package))
        return _stub_accepted(request.package[0].identif.p_cl_num)

    async def put_save_repay_debt(self, request: SaveRepayRequest) -> Envelope:
        await self.token()
        return _stub_accepted(request.package[0].p_cl_num)

    async def get_nsi(self) -> list[dict]:
        await self.token()
        return list(STUB_NSI)
