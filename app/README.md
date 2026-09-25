# ЕРИП — ПМ «Модуль по работе с задолженностью» (MVP)

Каркас веб-приложения:

- **backend** — Django 5 + DRF: доменная модель, CRUD/REST, роли и контуры доступа, импорт выгрузок АИС «Расчет-ЖКУ», оповещения, журналы ошибок и аудита;
- **gateway** — FastAPI: асинхронная доставка оповещений (каналы на заглушках) и каркас интеграций ПРИС и БНП;
- **frontend** — Angular 18 + Angular Material;
- PostgreSQL 16, Redis, NGINX.

```
Angular ──/api/──> Django ──(httpx + X-Internal-Token)──> FastAPI ──> адаптеры каналов (заглушки)
                      ▲                                    │
                      └── callback статуса, ErrorLog       └──> ПРИС / БНП (заглушки)
```

`/gw/` снаружи без служебного токена отвечает 401. Браузер ходит только в `/api/`.

## Запуск в Docker

```bash
cd app
cp .env.example .env        # задать секреты
docker compose up --build
```

На Windows фронт собирается на хосте: `npm install` внутри Docker роняет демон с `error reading from server: EOF`. Предупреждения npm про устаревшие пакеты к этой ошибке не относятся. Из каталога `app`:

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
cd frontend
npm run build
cd ..
docker compose build backend
docker compose build gateway
docker compose build nginx
docker compose up
```

`npm run build` кладёт статику в `frontend/dist/erip/browser`, образ nginx только копирует её. Повторно собирать фронт нужно после изменений в `frontend/src`.

Первый запуск сам готовит базу: миграции Django, схема `gateway` и схема `ais` из `postgres/ais_3nf.sql` (все таблицы 3НФ). Отдельный `migrate` и `loaddata` после `up` не нужны. Скрипты в `docker-entrypoint-initdb.d` выполняются только на пустом томе `pgdata`. Если том уже был создан раньше, схему накатывают один раз:

```powershell
Get-Content .\postgres\ais_3nf.sql | docker compose exec -T postgres psql -U erip -d erip -v ON_ERROR_STOP=1
```

Пример `.env` поднимает локальный контур с `DJANGO_SETTINGS_MODULE=config.settings.dev` и `GW_ENVIRONMENT=dev`. Вход `admin` / `admin` из `DJANGO_SUPERUSER_*`. Приложение: http://localhost:8080, Swagger шлюза: http://localhost:8080/gw/docs, админка Django: http://localhost:8080/admin/.

На сервере нужны `config.settings.prod` и `GW_ENVIRONMENT=prod`. Процесс не стартует, если `DJANGO_SECRET_KEY`, `INTERNAL_TOKEN`, `DJANGO_ALLOWED_HOSTS=*` или пароль суперадмина `admin` остались заготовками из примера. `INTERNAL_TOKEN` и `GW_INTERNAL_TOKEN` должны совпадать. Документация `/gw/docs` в prod выключена.

При старте backend применяет миграции, загружает фикстуры (`debt_group_scale`, `bnp_dictionaries`, `message_templates` — шесть каркасов писем по группам долга 1–6) и создаёт суперадминистратора. Каталог `../Примеры данных` монтируется в контейнер как `AIS_SPEC_DIR`. Если Docker не смог смонтировать путь с кириллицей, интерфейс всё равно открывается, не работает только сверка импорта со спецификациями.

Загрузка тестовых данных:

```bash
docker compose exec backend python manage.py generate_ais_samples /tmp/samples --schema demo_schema --accounts 50
for e in account service payment registration; do
  docker compose exec backend python manage.py import_ais $e /tmp/samples/$e.csv --schema demo_schema --create-org
done
```

## Локальный запуск без Docker

```powershell
cd app
uv venv .venv --python 3.11
uv pip install --python .venv -r backend/requirements.txt -r backend/requirements-dev.txt -r gateway/requirements.txt -r gateway/requirements-dev.txt

# backend (без POSTGRES_HOST используется SQLite)
cd backend
$env:INTERNAL_TOKEN="dev"; $env:GATEWAY_URL="http://127.0.0.1:8001"; $env:BACKEND_PUBLIC_URL="http://127.0.0.1:8000"
..\.venv\Scripts\python manage.py migrate
..\.venv\Scripts\python manage.py loaddata debt_group_scale bnp_dictionaries message_templates
..\.venv\Scripts\python manage.py createsuperuser
..\.venv\Scripts\python manage.py runserver 127.0.0.1:8000

# gateway (в другом терминале)
cd gateway
$env:GW_BACKEND_URL="http://127.0.0.1:8000"; $env:GW_INTERNAL_TOKEN="dev"
..\.venv\Scripts\python -m uvicorn app.main:app --port 8001

# frontend (в третьем терминале) — http://localhost:4200, прокси /api и /gw
cd frontend; npm install; npm start
```

## Тесты и проверки

```bash
cd app/backend && pytest --cov=apps        # 55 тестов
cd app/gateway && pytest --cov=app         # 36 тестов
cd app && ruff check backend gateway scripts
cd app/frontend && npx ng build
python scripts/smoke_e2e.py --backend http://127.0.0.1:8000 --gateway http://127.0.0.1:8001 --user admin --password admin --internal-token dev
```

`scripts/smoke_e2e.py` проверяет на запущенных сервисах критерии приёмки 1, 3, 4 и 5. Критерий 2 (изоляция контуров) проверяется тестами `backend/tests/test_access.py`.

## Устройство

### Данные АИС («Примеры данных»)

- Файлы `Примеры данных/*.csv` — это спецификации полей Oracle-выгрузки (`COLUMN_NAME;DATA_TYPE;COMMENTS;MODULE_NAME`, cp1251), а не сами данные. Модели `Account`, `AccountService`, `Payment`, `Registration` построены по ним и остаются плоским слоем импорта.
- Нормализованная схема PostgreSQL (не ниже 3НФ) по тем же спецификациям — `postgres/ais_3nf.sql`, схема `ais`. Django её не мигрирует. Пустой контейнер PostgreSQL создаёт эти таблицы при первом старте. Повторный запуск скрипта остановится, если схема уже есть; снос — `DROP SCHEMA ais CASCADE`.
- Карта колонок: `backend/apps/imports/field_maps.py`. Повторяющиеся имена (`ACCOUNT_ID`, `ATTR_VALUE`, `FULL_NAME`, `CLIENT_ACCOUNT`) разводятся по порядку следования и `COMMENTS`. Колонка «Тип оплаты» без имени читается из заголовка `PAYMENT_TYPE`. Соответствие карты спецификациям проверяет тест.
- Импорт (`POST /api/v1/imports/` до 50 МБ или `manage.py import_ais` для полной выгрузки):
  - кодировка UTF-8 или cp1251, разделитель `;`;
  - команда читает файл потоком и пишет пакетами по 500 строк (`bulk_create` / `bulk_update`);
  - upsert по ключу;
  - повторная загрузка не меняет данные;
  - строки чужой схемы отклоняются;
  - журнал пишется в `ImportJob`;
  - после импорта пересчитываются группы задолженности, пакетами по 500 лицевых счетов.
- Исходная строка сохраняется в `raw`. `manage.py purge_retained` очищает `raw` старше `RAW_RETENTION_DAYS` (по умолчанию 90), `AuditLog` старше `AUDIT_RETENTION_DAYS` (365) и `ErrorLog` старше `ERROR_LOG_RETENTION_DAYS` (90). Команду ставят в планировщик, она не вызывается на каждый запрос.
- Списки лицевых счетов опираются на индексы `(organization, provider_id, debt_group)` и `(organization, balance_out)`. На PostgreSQL миграция `0005_pg_trgm` создаёт расширение `pg_trgm` и GIN-индексы по ФИО, адресу и идентификационному номеру. Роли БД нужно право `CREATE EXTENSION`, иначе расширение создают один раз отдельно и миграцию прогоняют снова.
- В спецификации `DEBT_PERIOD` имеет тип DATE, но по описанию это число месяцев долга. Хранится как целое, это стоит уточнить у команды АИС.

### Оповещения

1. Каркас выбирается по группе долга ЛС (`effective_group`: ручная, иначе расчётная) и каналу: локальный шаблон схемы, иначе центральный из фикстуры `message_templates` (группы 1–6, канал e-mail). `POST /api/v1/notifications/` может не передавать `template` — тогда каркас подставится сам. В контекст попадают `{fio}`, `{account}`, `{amount}`, `{address}`, `{debt_group}`, `{group_name}` — эти ключи берутся только из лицевого счёта, поля из запроса их не затирают. Название группы отдаёт карточка ЛС (`group_name`). На вкладке «Оповестить» каркас этой группы уже выбран, ниже показан текст с подставленными данными счёта, кнопка отправки блокируется до ответа сервера. Повтор с тем же автором, ЛС, шаблоном и каналом, пока статус `new` или `queued`, возвращает уже созданное оповещение и в шлюз не уходит. `POST .../resend/` в этих статусах отвечает 400. Приветствие шлюз добавляет отдельно. Шаблоны правятся в разделе «Шаблоны» (поле «Группа долга»).
2. `NotificationDispatcher` (зависит от абстракции `GatewayClient`) → `HttpGatewayClient` асинхронно через `httpx.AsyncClient` → `POST /gw/v1/notifications` с заголовком `X-Internal-Token` (ответ 202). Адрес callback шлюз собирает сам из `GW_BACKEND_URL` и id оповещения, поле из запроса не принимается.
3. Шлюз пишет `delivery_log`, в фоне формирует текст декоратором `@with_greeting` («Добрый день, {имя}! … С уважением, ЖКУ») и передаёт его адаптеру канала из `AdapterRegistry` (`inbox`, `email`, `sms`, `voice` — заглушки). В шаблоне подставляются только простые имена `{fio}`, `{account}` и т.п.
4. Итог шлюз возвращает в backend: `POST /api/v1/notifications/{id}/delivery-status/` с заголовком `X-Internal-Token` (до трёх попыток). Статус становится `sent` или `failed`. Перед отправкой строка журнала атомарно переводится из `accepted` в `processing`, поэтому два процесса uvicorn не отправляют одно сообщение дважды. Зависшую доставку (дольше 2 минут) шлюз забирает снова при старте. Завершённые записи `delivery_log` старше `GW_LOG_RETENTION_DAYS` (по умолчанию 90) удаляются при старте.
5. `context: {"_fail": true}` имитирует отказ канала. Ошибка попадает в `ErrorLog` с тем же `X-Request-ID`, что у исходного запроса.

### Паттерны

| Паттерн | Где |
|---|---|
| Singleton | `gateway/app/core/singletons.py` (`Database` — пул `AsyncEngine`, `HttpClient` — общий `httpx.AsyncClient`), `get_gateway_client()` в Django. Соединениями Django с БД управляет ORM (`CONN_MAX_AGE`) |
| Decorator | `@with_greeting`, `@api_response` (конверт `{"data", "meta": {"request_id", "duration_ms"}}`) |
| Strategy / Adapter | `ChannelAdapter` + `AdapterRegistry`; `PrisClient` / `BnpClient` со Stub- и Http-реализациями |
| Repository | `apps/debts/repositories.py` |
| DIP / OCP | Dispatcher зависит от `GatewayClient`; новый канал — новый класс и `registry.register(...)` |

### Интеграции («Информация по интеграции»)

- **ПРИС:** схемы запросов и ответов по регламенту (`PutClaimantSaveDataDebt`, `PutClaimantSaveRepayDebt`, `GetClaimantInfoBy*`, `GetNSIData`), авторизация `x-user_id` / `x-accesskey` → `x-token` + `x-timestamp`, кэш токена (память или Redis) на 30 минут. По умолчанию `GW_PRIS_MODE=stub`; `http` включает `HttpPrisClient` после получения доступа к тестовому контуру.
- **БНП:** манифест заявления (`BnpManifest`) с проверками:
  - `personType` и условно обязательные поля;
  - структура личного номера (14 символов) и УНП;
  - `amount` в формате `10.00`, даты в формате `YYYY-MM-DD`;
  - `serviceId`, `typeId` и `docType` — по справочникам БНП;
  - документы только `.pdf`, не более 15 МБ.

  Справочники извлекаются из `Справочники БНП.docx` скриптом `scripts/extract_bnp_dictionaries.py`.
- Проверочные эндпоинты: `/gw/v1/integrations/pris/echo`, `/pris/claimant-info`, `/pris/save-data-debt/validate`, `/bnp/validate`, `/bnp/dictionaries`.

### Логи и ошибки

- JSON-логи в stdout (поля `timestamp`, `level`, `service`, `request_id`, `user_id`, `path`, `message`), формат готов к ELK/OpenSearch.
- Необработанные ошибки backend и ошибки шлюза пишутся в `ErrorLog`: `/api/v1/audit/errors/` и раздел «Журнал ошибок», доступны только суперадминистратору.
- Просмотр карточки ЛС и изменения записываются в `AuditLog`. Список и поиск лицевых счетов и регистраций пишут одну строку на запрос (фильтры и страница), а не строку на каждую запись. В списке регистраций идентификационный номер маскируется, в карточке ЛС он полный. IP в журнале — адрес, который NGINX дописал в `X-Forwarded-For` (`NUM_PROXIES=1`).

### Роли (MVP)

- `superadmin` — все схемы.
- `local_admin` — своя схема: специалисты и наблюдатели, шаблоны, импорт. Другого локального администратора и суперадмина он не видит и не назначает.
- `specialist` — реестр, карточки, оповещения.
- `observer` — только чтение.

Контур доступа реализован в одном месте, `apps/users/scoping.py`, и действует и для списков, и для запросов по id. Оповещение по лицевому счёту дополнительно ограничено назначенными обслуживающими организациями. «Прочитано» ставит только получатель.

Вход выдаёт access-токен в ответе (браузер держит его только в памяти вкладки, 30 минут; после перезагрузки страницы его восстанавливает refresh) и refresh в httpOnly-cookie `erip_refresh` (8 часов, одноразовый: при обновлении старый попадает в чёрный список). На `/api/v1/auth/token/` не больше 10 попыток в минуту с адреса клиента за NGINX. Выход: `POST /api/v1/auth/logout/`. Смена своего пароля: `POST /api/v1/auth/password/` (`old_password`, `new_password`) и пункт «Смена пароля»; все refresh этой учётной записи отзываются. Неактивная схема не пускает своих пользователей, суперадминистратор без схемы по-прежнему входит.

## Сервер

ОС, ядра, память и диск для тестового и рабочего сервера — в [SERVER.md](SERVER.md).

## Заглушки

Полный список заглушек и временных упрощений, с указанием файлов и порядка замены, — в [STUBS.md](STUBS.md).

## Что дальше

- Микросервисы на Go: шлюз и адаптеры вынесены за интерфейсы, Django от них не зависит.
- Alembic для таблиц шлюза (сейчас `create_all` и добавление колонки `claimed_at` при старте) и брокер (RabbitMQ/Kafka) вместо `BackgroundTasks`, когда воркеров станет больше двух.
- `COPY` из PostgreSQL, если пакетный `import_ais` на полной выгрузке всё ещё не укладывается в окно загрузки.
- Реальные адаптеры SMTP и Asterisk AMI; включение `HttpPrisClient`.
