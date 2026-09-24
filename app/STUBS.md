# Заглушки и временные упрощения MVP

Список мест, где вместо реальной работы стоит заглушка, и того, что нужно сделать, чтобы её заменить.
Пути указаны от каталога `app/`.

## 1. Каналы доставки оповещений (шлюз)

Реальной отправки нет: адаптер пишет сообщение в JSON-лог и возвращает «доставлено».

| Канал | Файл | Во что превратится |
|---|---|---|
| `email` | `gateway/app/adapters/email_stub.py` → `EmailStubAdapter` | SMTP Заказчика (ТЗ 4.2.10.7), отправитель по организации |
| `sms` | `gateway/app/adapters/sms_stub.py` → `SmsStubAdapter` | SMS-шлюз (в ТЗ упомянут, интеграция не описана) |
| `voice` | `gateway/app/adapters/voice_stub.py` → `VoiceStubAdapter` | Asterisk AMI: originate + TTS, статусы звонков (ТЗ 4.2.10.6) |
| `inbox` | `gateway/app/adapters/inbox.py` → `InboxAdapter` | Не заглушка по смыслу: внешней системы нет, текст уходит в панель уведомлений ПМ через callback |

Общая логика заглушек — `gateway/app/adapters/stub.py` (`StubAdapter`).

**Как заменить:**
1. Написать класс, унаследованный от `ChannelAdapter` (`gateway/app/adapters/base.py`), с методом `async def send(message) -> DeliveryResult`.
2. Зарегистрировать его вместо заглушки в `build_default_registry()` (`gateway/app/adapters/registry.py`).

Остальной код менять не нужно.

**Имитация отказа.** Если в `meta` сообщения пришло `fail: true`, заглушка выбрасывает `AdapterError`. На стороне Django это задаётся полем `context: {"_fail": true}` при создании оповещения (`backend/apps/notifications/services/dispatcher.py`, `build_payload`). Когда появятся реальные адаптеры, этот флаг нужно убрать из `stub.py` и `dispatcher.py`.

## 2. АИС ПРИС (Минюст)

- **Файл:** `gateway/app/integrations/pris/client.py` → `StubPrisClient`.
- **Поведение:** запросы проверяются схемами регламента (`pris/schemas.py`), ответ — пример из регламента, токен вида `stub-token-N`.
- **Реальный клиент уже написан:** `HttpPrisClient` в том же файле (авторизация, токен на 30 минут, повтор при 401, разбор конверта `code/data/message`). Проверен только на имитации ответов, не на живом сервере.
- **Выбор реализации:** `get_pris_client()` в `gateway/app/api/v1/integrations.py`, переключатель `GW_PRIS_MODE`.

**Как включить:** получить через Минюст доступ к тестовому контуру (`http://192.168.101.81:10116`), затем задать в `.env`:

```
GW_PRIS_MODE=http
GW_PRIS_USER_ID=...
GW_PRIS_ACCESS_KEY=...
```

Дальше проверить `GET /gw/v1/integrations/pris/echo`.

## 3. Белорусская нотариальная палата (ЛК БНП)

- **Файл:** `gateway/app/integrations/bnp/client.py` → `StubBnpClient.submit()`.
- **Поведение:** проверяет манифест (`bnp/schemas.py`) и файлы (только `.pdf`, не более 15 МБ), логирует, возвращает `submission_id` вида `stub-…`. В ЛК ничего не отправляется.
- **Реального клиента нет:** промышленного API у БНП нет. Способ — API, фоновый робот (RPA) или ручной режим — согласуется с Заказчиком (ТЗ 4.2.10.5).
- **Как заменить:** написать класс-наследник `BnpClient` и вернуть его из `get_bnp_client()` в `gateway/app/api/v1/integrations.py`.

## 4. Проверочные эндпоинты шлюза

Эндпоинты в `gateway/app/api/v1/integrations.py` сделаны для проверки каркаса и ходят в заглушки:

- `GET /gw/v1/integrations/pris/echo`;
- `POST /gw/v1/integrations/pris/claimant-info`;
- `POST /gw/v1/integrations/pris/save-data-debt/validate` — при реальном клиенте `GW_PRIS_MODE=http` он **отправит пакет в ПРИС**, а не только проверит;
- `POST /gw/v1/integrations/bnp/validate`;
- `GET /gw/v1/integrations/bnp/dictionaries`.

Перед подключением реальных систем их нужно закрыть служебным токеном или убрать.

## 5. Тестовые подмены (только для тестов)

| Что | Файл |
|---|---|
| `FakeGatewayClient` — клиент шлюза без HTTP | `backend/apps/notifications/services/gateway_client.py`, подключается в `backend/tests/conftest.py` |
| `BackendRecorder` — имитация backend для шлюза | `gateway/tests/conftest.py` |
| `httpx.MockTransport` для ПРИС и шлюза | `gateway/tests/test_integrations.py`, `backend/tests/test_notifications.py` |

В рабочем коде они не используются, трогать их не нужно.

## 6. Тестовые данные вместо реальных выгрузок АИС

- **Генератор:** `backend/apps/imports/samples.py`, команда `generate_ais_samples`. Строит CSV по спецификациям из «Примеры данных», значения вымышленные.
- **Как заменить:** реальные файлы загружаются тем же `import_ais` или `POST /api/v1/imports/`.
- **Что проверить на реальной выгрузке:**
  - заголовки колонок совпадают с `COLUMN_NAME` из спецификаций;
  - порядок повторяющихся колонок (`ACCOUNT_ID`, `ATTR_VALUE`, `FULL_NAME`, `CLIENT_ACCOUNT`) тот же, что в спецификации;
  - колонка «Тип оплаты» названа `PAYMENT_TYPE`;
  - `DEBT_PERIOD` — число месяцев, а не дата.

  Сопоставление колонок лежит в `backend/apps/imports/field_maps.py`.

## 7. Временные технические упрощения (не заглушки, но под замену)

| Что сейчас | Где | Что нужно в проде |
|---|---|---|
| Таблицы шлюза создаются `create_all` при старте | `gateway/app/core/singletons.py` → `Database.create_tables`, вызов в `gateway/app/main.py` | Миграции Alembic |
| Фоновая доставка через `BackgroundTasks` FastAPI (при перезапуске шлюза незавершённые отправки теряются) | `gateway/app/api/v1/notifications.py` | Очередь RabbitMQ/Kafka (ТЗ 4.4.8) |
| Импорт выполняется прямо в HTTP-запросе, построчно | `backend/apps/imports/views.py`, `services.py` | Фоновая задача (Airflow по ТЗ) и пакетная загрузка (`COPY`/`bulk_create`) для 1,5 млн ЛС |
| Без `POSTGRES_HOST` Django работает на SQLite, шлюз по умолчанию — на SQLite-файле | `backend/config/settings/dev.py`, `gateway/app/core/config.py` | Только PostgreSQL (в `docker-compose.yml` уже так) |
| Служебный токен шлюз ↔ backend — общий секрет `INTERNAL_TOKEN` / `GW_INTERNAL_TOKEN` | `.env.example` | Сменить значения; при необходимости — mTLS или отдельный сервисный аккаунт |
| Роли упрощены до 4 (`superadmin`, `local_admin`, `specialist`, `observer`) | `backend/apps/users/models.py` | Полная матрица ролей Приложения 1 ТЗ |
