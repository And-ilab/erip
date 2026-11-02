# API Белпочты (бизнес) — срез с dev.belpost.by

Снято 02.11.2026 с дев-портала после входа в ЛК. **Логин, пароль и JWT в репозиторий не класть.**

Портал: https://dev.belpost.by/  
База API: `https://api.belpost.by/api`  
Профиль при входе: юрлицо (type `legal`), УНП `692204462` (ООО «Финсельват»).

OpenAPI (YAML) лежат в `docs/tz/belpochta-openapi/`. Их отдал `GET /api/v1/technical-documents/openapi?path=…` после Bearer-токена.

## Авторизация

1. `POST /api/v1/dev-portal/token`  
   Тело: `{ "login": "<email или УНП>", "password": "…", "filial": null }`  
   (филиал нужен, если логин — УНП с несколькими филиалами: сначала `GET /api/v1/filials?trn=…`).
2. Ответ: `{ "access_token": "<JWT>", "token_type": "Bearer", … }`.
3. Дальше: `Authorization: Bearer <JWT>`, `Accept: application/json`.

Ключи API для боевых вызовов создаются в ЛК («Настройки»); для разделов (справочник, партионные, трекинг) выбирают нужный scope. Документация статей читается тем же JWT портала.

Документация статей:  
`GET /api/v1/blog/tree/all?group=dev` → дерево;  
`GET /api/v1/blog/pages/{id}` → HTML статьи.  
Список технических OpenAPI: `GET /api/v1/technical-documents`.

## Что нужно ПМ (предупреждения заказным)

Цепочка из раздела «Партионные отправления» (`batch-mailing`):

| Шаг | Метод | Путь |
|---|---|---|
| Список / поиск партий | GET | `/api/v1/business/batch-mailing/list` |
| Создать партию | POST | `/api/v1/business/batch-mailing/list` |
| Обновить / удалить партию | PUT/DELETE | `/api/v1/business/batch-mailing/list/{id}` |
| Сформировать партию | POST | `/api/v1/business/batch-mailing/list/{id}/commit` (см. YAML) |
| Добавить отправления | POST | `/api/v1/business/batch-mailing/list/{id}/item` |
| Получатели | CRUD | `/api/v1/business/batch-mailing/recipient…` |
| Расписки | CRUD + скачать | `/api/v1/business/batch-mailing/receipt…` |
| Бланки / документы | GET/POST | `/api/v1/business/batch-mailing/…/documents` |

Отслеживание вручения (статус «Вручено» и др.):

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/v1/business/tracking` | одно отправление: тело `{ "number": "XX123456789BY" }` → `steps[].event` |
| (см. `tracking.yaml`) | диапазон / подписка на номер | пакетный опрос |

Справочник адресов/индексов (проверка адреса должника):

| Метод | Путь |
|---|---|
| GET | `/api/v1/business/geo-directory/search-address` |
| (см. `postcode.yaml`, `ops.yaml`) | индекс, ОПС |

Точные схемы полей, коды ошибок и примеры — в YAML:

| Файл | Содержание |
|---|---|
| `belpost_api_buisness.yaml` | партионные отправления |
| `tracking.yaml` | отслеживание |
| `postcode.yaml` | справочник адресов/индексов |
| `ops.yaml` | отделения почтовой связи |
| `postal_delivery_order.yaml` | предварительное оформление |
| `post_market_*.yml` | postmarket (ПМ ЖКУ не использует) |

## Связь с ПМ

Сейчас в `app/STUBS.md`: статус вручения Белпочты вводит пользователь. Боевой контур:

1. Шлюз: адаптер `GW_BELPOST_MODE=stub|http`, JWT/ключ из env (не из UI).
2. Создание партии предупреждений → `batch-mailing` → сохранить `s10code` на `MeasureItem`.
3. Ночной/ручной опрос `POST …/tracking` → при событии «Вручено» / возврат писать дату вручения в мероприятие (как ручной `deliver/`).

Postmarket API в объём ЖКУ не входит.

## Повторный съём

```powershell
$env:BELPOST_LOGIN='…'
$env:BELPOST_PASSWORD='…'
python .tmp_belpost/fetch_docs.py
python .tmp_belpost/fetch_openapi.py
```

Скрипты и сырой HTML — только локально (каталог `.tmp_belpost/` в `.gitignore`).
