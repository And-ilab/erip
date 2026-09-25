"""FastAPI-шлюз: асинхронная доставка оповещений и каркас внешних интеграций."""

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from .api.v1 import health, integrations, notifications
from .core.config import get_settings
from .core.errors import register_exception_handlers
from .core.logging import setup_logging
from .core.middleware import RequestIdMiddleware
from .core.singletons import Database, HttpClient
from .models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    db = Database()
    await db.create_tables(Base.metadata)
    HttpClient().client  # noqa: B018 — открыть общий HTTP-клиент
    from .adapters.registry import build_default_registry
    from .services.notification_service import NotificationService

    service = NotificationService(db, build_default_registry(), HttpClient(), get_settings())
    await service.resume_pending()
    await service.purge_old(get_settings().log_retention_days)
    yield
    await HttpClient().close()
    await db.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    public_docs = settings.environment != "prod"
    app = FastAPI(
        title="ЕРИП: шлюз оповещений и интеграций",
        version="0.1.0",
        docs_url="/gw/docs" if public_docs else None,
        openapi_url="/gw/openapi.json" if public_docs else None,
        lifespan=lifespan,
    )
    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)

    v1 = APIRouter(prefix="/gw/v1")
    v1.include_router(health.router)
    v1.include_router(notifications.router)
    v1.include_router(integrations.router)
    app.include_router(v1)
    app.state.settings = settings
    return app


app = create_app()
