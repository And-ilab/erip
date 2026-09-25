from fastapi import APIRouter, BackgroundTasks, Depends

from ...core.context import get_request_id
from ...decorators import api_response
from ...schemas import NotificationIn, PreviewIn
from ...services.notification_service import NotificationService
from ...services.rendering import MessageRenderer
from ..deps import get_notification_service, require_internal_token

router = APIRouter(prefix="/notifications", tags=["Оповещения"], dependencies=[Depends(require_internal_token)])


def serialize(log) -> dict:
    return {
        "id": log.id, "notification_id": log.notification_id, "channel": log.channel, "recipient": log.recipient,
        "status": log.status, "error": log.error, "text": log.text, "request_id": log.request_id,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "finished_at": log.finished_at.isoformat() if log.finished_at else None,
    }


@router.post("", status_code=202, summary="Принять оповещение к доставке")
@api_response
async def accept_notification(
    payload: NotificationIn,
    background: BackgroundTasks,
    service: NotificationService = Depends(get_notification_service),
):
    request_id = get_request_id()
    log = await service.accept(payload, request_id)
    background.add_task(service.process, log.id, payload, request_id)
    return {"id": log.id, "status": "accepted"}


@router.post("/preview", summary="Предпросмотр текста с приветствием")
@api_response
async def preview(payload: PreviewIn):
    text = await MessageRenderer().render(payload.template_body, payload.context, user_name=payload.user_name)
    return {"text": text}


@router.get("", summary="Последние доставки")
@api_response
async def recent(limit: int = 50, service: NotificationService = Depends(get_notification_service)):
    return [serialize(log) for log in await service.list_recent(min(limit, 500))]


@router.get("/{delivery_id}", summary="Статус доставки")
@api_response
async def delivery_status(delivery_id: str, service: NotificationService = Depends(get_notification_service)):
    return serialize(await service.get(delivery_id))
