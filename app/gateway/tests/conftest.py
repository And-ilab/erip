import os
import tempfile
from pathlib import Path

import httpx
import pytest

_TMP = Path(tempfile.mkdtemp(prefix="gw-tests-"))
os.environ["GW_DATABASE_URL"] = f"sqlite+aiosqlite:///{(_TMP / 'gateway.db').as_posix()}"
os.environ["GW_BACKEND_URL"] = "http://backend.test"
os.environ["GW_INTERNAL_TOKEN"] = "test-internal"
os.environ.pop("GW_DB_SCHEMA", None)
os.environ.pop("GW_REDIS_URL", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.core.singletons import Database, HttpClient  # noqa: E402


class BackendRecorder:
    """Имитация backend: принимает callback статуса и журнал ошибок от шлюза."""

    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(200, json={"ok": True})

    def by_path(self, fragment: str) -> list[httpx.Request]:
        return [r for r in self.requests if fragment in r.url.path]


@pytest.fixture
def backend():
    return BackendRecorder()


@pytest.fixture
def client(backend, tmp_path):
    Database.reset_instance()
    HttpClient.reset_instance()
    Database(url=f"sqlite+aiosqlite:///{(tmp_path / 'gateway.db').as_posix()}")
    HttpClient(transport=httpx.MockTransport(backend))
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
    Database.reset_instance()
    HttpClient.reset_instance()
