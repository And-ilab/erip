"""Одиночки шлюза: пул соединений с БД и HTTP-клиент.

Создаются лениво и один раз на процесс (потокобезопасно), открываются и закрываются
в lifespan FastAPI. Повторные вызовы Database() / HttpClient() возвращают тот же объект.
"""

from __future__ import annotations

import threading
from typing import Any

import httpx
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings


class SingletonMeta(type):
    _instances: dict[type, Any] = {}
    _lock = threading.Lock()

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            with cls._lock:
                if cls not in cls._instances:
                    cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

    def reset_instance(cls) -> None:
        """Сброс одиночки (для тестов и переинициализации)."""
        with cls._lock:
            cls._instances.pop(cls, None)


class Database(metaclass=SingletonMeta):
    def __init__(self, url: str | None = None):
        self.url = url or get_settings().database_url
        self._engine: AsyncEngine | None = None
        self._sessionmaker: async_sessionmaker[AsyncSession] | None = None

    @property
    def engine(self) -> AsyncEngine:
        if self._engine is None:
            self._engine = create_async_engine(self.url, pool_pre_ping=True)
            self._sessionmaker = async_sessionmaker(self._engine, expire_on_commit=False)
        return self._engine

    def session(self) -> AsyncSession:
        self.engine  # noqa: B018 — ленивая инициализация
        assert self._sessionmaker is not None
        return self._sessionmaker()

    async def create_tables(self, metadata: MetaData) -> None:
        """Создание таблиц шлюза (для MVP вместо миграций Alembic)."""
        async with self.engine.begin() as conn:
            await conn.run_sync(metadata.create_all)

    async def dispose(self) -> None:
        if self._engine is not None:
            await self._engine.dispose()
            self._engine = None
            self._sessionmaker = None


class HttpClient(metaclass=SingletonMeta):
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=get_settings().http_timeout, transport=self._transport)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
