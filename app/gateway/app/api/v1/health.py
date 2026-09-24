from fastapi import APIRouter
from sqlalchemy import text

from ...core.singletons import Database
from ...decorators import api_response

router = APIRouter(tags=["Служебные"])


@router.get("/health", summary="Проверка доступности шлюза и БД")
@api_response
async def health():
    async with Database().engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
