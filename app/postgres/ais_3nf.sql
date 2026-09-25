-- Нормализованная схема данных АИС «Расчет-ЖКУ» (не ниже 3НФ).
-- Источник полей: «Примеры данных/*.csv» (COLUMN_NAME;DATA_TYPE;COMMENTS;MODULE_NAME).
--
-- Это не слой импорта MVP. Модели Django (public.debts_*) остаются плоской
-- проекцией выгрузки и этим скриптом не изменяются. Скрипт создаёт отдельную
-- схему ais и не пишет в public и gateway.
--
-- Пустая база Docker применяет этот файл сама: docker-compose монтирует его
-- как /docker-entrypoint-initdb.d/02-ais_3nf.sql. Уже заполненный том pgdata
-- инициализацию не повторяет — тогда тот же файл выполняют вручную:
--   psql "postgresql://USER:PASSWORD@HOST:5432/DBNAME" -v ON_ERROR_STOP=1 -f postgres/ais_3nf.sql
-- Повторный запуск остановится, если схема ais уже есть.
-- Снос: DROP SCHEMA ais CASCADE;
--
-- Ключ почти везде составной: (schema_code, код АИС). Коды ЛС, лиц, квитанций
-- и справочников уникальны внутри схемы начисления (SCHEMA_NAME), не глобально.
-- Тот же принцип, что у пары «схема + PROVIDER_ID + номер ЛС» в приложении.
-- Номер ЛС (CLIENT_ACCOUNT) — текст: в нём бывают ведущие нули.
--
-- Что убрано из плоских строк, чтобы не было аномалий обновления, вставки и удаления:
--   * наименование рядом с кодом (поставщик, банк, услуга, пол, гражданство и т.д.)
--     живёт в справочнике, а не копируется в каждую строку ЛС, оплаты и регистрации;
--   * лицо (SUBJ_ID) отдельно от регистрации на конкретном ЛС (REGISTRATION_ID);
--   * дом отдельно от ЛС;
--   * договор на услугу (SERVICE_LIST_ID) отдельно от операции расчёта (CALCULATION_ID);
--   * квитанция отдельно от строки распределения по услуге и от пачки;
--   * повторяющиеся группы «доп. информация 1/2» и «документ доли 1/2/3» — дочерние строки;
--   * остатки ЛС и состав домохозяйства — срез на oper_date, период входит в ключ,
--     новый месяц не затирает предыдущий.
--
-- Что сознательно хранится фактом, а не вычисляется: формулы сальдо, пени,
-- субсидии и «количества человек» в спецификации не заданы. Итоги АИС нельзя
-- восстановить из соседних колонок, поэтому они лежат в таблицах срезов.
-- ФИО плательщика и краткое ФИО на карточке — производные, в таблицах их нет
-- (см. представления).
--
-- Поля «из файла» на квитанции (номер ЛС, ФИО, адрес) — это текст платёжного
-- документа, а не копия карточки ЛС. Они остаются на квитанции.
--
-- Второй ACCOUNT_ID карточки ЛС — не код счёта, а признак ЧУП (0/1).
-- DEBT_PERIOD в спецификации имеет тип DATE, а комментарий описывает число
-- месяцев долга. Здесь это целое debt_month_count; расхождение нужно подтвердить у АИС.
--
-- Представления v_* собирают форму модулей обратно. Повторяющиеся имена колонок
-- Oracle (два ACCOUNT_ID, три ATTR_VALUE, два FULL_NAME, два CLIENT_ACCOUNT)
-- в представлении разведены — в PostgreSQL имя колонки не может повторяться.

BEGIN;

CREATE SCHEMA ais;

CREATE DOMAIN ais.money AS numeric(20, 2);
CREATE DOMAIN ais.qty AS numeric(20, 6);
CREATE DOMAIN ais.nonneg_int AS integer
    CONSTRAINT nonneg_int_check CHECK (VALUE IS NULL OR VALUE >= 0);

CREATE FUNCTION ais.person_fio(fam text, im text, ot text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT nullif(btrim(concat_ws(' ', fam, im, ot)), '');
$$;

COMMENT ON SCHEMA ais IS
    'Данные АИС «Расчет-ЖКУ» в 3НФ. Не путать с таблицами Django в public.';

-- ---------------------------------------------------------------------------
-- Схема начисления и фиксированный тип оплаты
-- ---------------------------------------------------------------------------

CREATE TABLE ais.billing_schema (
    code varchar(30) PRIMARY KEY,
    name text
);

COMMENT ON TABLE ais.billing_schema IS
    'Схема начисляющей организации (SCHEMA_NAME). Сопоставляется с Organization.schema_name, но внешним ключом с Django не связана.';

CREATE TABLE ais.ref_payment_type (
    code text PRIMARY KEY,
    name text NOT NULL UNIQUE
);

INSERT INTO ais.ref_payment_type (code, name) VALUES
    ('file', 'Файл'),
    ('manual', 'Ввод вручную'),
    ('salary', 'Зачисление из зарплаты');

-- ---------------------------------------------------------------------------
-- Справочники. Код определяет наименование — имени в фактах больше нет.
-- ---------------------------------------------------------------------------

CREATE TABLE ais.provider (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    provider_id bigint NOT NULL,
    short_name  text,
    full_name   text,
    PRIMARY KEY (schema_code, provider_id)
);

COMMENT ON TABLE ais.provider IS
    'Организация АИС (PROVIDER_ID): и обслуживающая организация ЛС, и поставщик услуги.';

CREATE TABLE ais.house (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    house_id    bigint NOT NULL,
    address     text,
    PRIMARY KEY (schema_code, house_id)
);

COMMENT ON TABLE ais.house IS
    'Дом. Адрес из карточки ЛС (до 617 символов); в регистрациях и оплатах тот же адрес укорочен до 250 и отдельно не хранится.';

CREATE TABLE ais.ref_service (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    service_id  bigint NOT NULL,
    name        text,
    report_name text,
    PRIMARY KEY (schema_code, service_id)
);

COMMENT ON TABLE ais.ref_service IS
    'Услуга. report_name — SERVICE_NAME_REPORT. Если наименование в извещении различается у договоров одной услуги, колонку нужно перенести на service_contract.';

CREATE TABLE ais.ref_bank (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    bank_id     bigint NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, bank_id)
);

CREATE TABLE ais.ref_workplace (
    schema_code   varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    work_place_id bigint NOT NULL,
    name          text,
    PRIMARY KEY (schema_code, work_place_id)
);

CREATE TABLE ais.ref_pay_contract (
    schema_code     varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    pay_contract_id bigint NOT NULL,
    name            text,
    PRIMARY KEY (schema_code, pay_contract_id)
);

COMMENT ON TABLE ais.ref_pay_contract IS
    'Документ, по которому задана доля (PAY_CONTRACT_ID / PAY_CONTRACT_NAME).';

CREATE TABLE ais.ref_account_category (
    schema_code      varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    acc_category_id  bigint NOT NULL,
    short_name       text,
    full_name        text,
    PRIMARY KEY (schema_code, acc_category_id)
);

COMMENT ON TABLE ais.ref_account_category IS 'Тип объекта ЛС (ACC_CATEGORY_ID / SHORT / FULL).';

CREATE TABLE ais.ref_housing_category (
    schema_code   varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    category_code bigint NOT NULL,
    short_name    text,
    name          text,
    PRIMARY KEY (schema_code, category_code)
);

COMMENT ON TABLE ais.ref_housing_category IS
    'Категория жилого фонда. В выгрузке код приходит колонкой ATTR_VALUE.';

CREATE TABLE ais.ref_ownership_type (
    schema_code          varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    ownership_type_code  bigint NOT NULL,
    name                 text,
    PRIMARY KEY (schema_code, ownership_type_code)
);

COMMENT ON TABLE ais.ref_ownership_type IS
    'Тип собственности. В выгрузке код приходит второй колонкой ATTR_VALUE.';

CREATE TABLE ais.ref_account_uniqueness (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    uniq_attr   bigint NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, uniq_attr)
);

CREATE TABLE ais.ref_citizenship (
    schema_code    varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    citizenship_id bigint NOT NULL,
    name           text,
    PRIMARY KEY (schema_code, citizenship_id)
);

CREATE TABLE ais.ref_doc_type (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    doc_type_id bigint NOT NULL,
    short_name  text,
    full_name   text,
    PRIMARY KEY (schema_code, doc_type_id)
);

COMMENT ON TABLE ais.ref_doc_type IS
    'Тип документа. Краткое имя — DOC_TYPE_NAME, полное — второе FULL_NAME модуля «Регистрация».';

CREATE TABLE ais.ref_sex (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        integer NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_marital_status (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        integer NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_reg_type (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        integer NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_relation_degree (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        integer NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_payer_type (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        bigint NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_social_category (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        bigint NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

CREATE TABLE ais.ref_social_note (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    note_id     bigint NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, note_id)
);

CREATE TABLE ais.ref_legacy_type (
    schema_code varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    code        integer NOT NULL,
    name        text,
    PRIMARY KEY (schema_code, code)
);

COMMENT ON TABLE ais.ref_legacy_type IS 'Способ перехода прав (LEGACY_PARAM_TYPE_ID).';

-- ---------------------------------------------------------------------------
-- Лицевой счёт
-- ---------------------------------------------------------------------------

CREATE TABLE ais.account (
    schema_code            varchar(30) NOT NULL,
    account_id             bigint NOT NULL,
    provider_id            bigint NOT NULL,
    client_account         varchar(20) NOT NULL,
    unified_account        bigint,
    house_id               bigint,
    address                text,
    flat_number            varchar(50),
    total_space            numeric(14, 4),
    room_count             ais.nonneg_int,
    phone                  varchar(50),
    contact_phone          varchar(50),
    acc_category_id        bigint,
    housing_category_code  bigint,
    ownership_type_code    bigint,
    uniq_attr              bigint,
    is_private_enterprise  boolean,
    start_date             date,
    stop_date              date,
    PRIMARY KEY (schema_code, account_id),
    UNIQUE (schema_code, provider_id, client_account),
    UNIQUE (schema_code, unified_account),
    FOREIGN KEY (schema_code) REFERENCES ais.billing_schema (code),
    FOREIGN KEY (schema_code, provider_id)
        REFERENCES ais.provider (schema_code, provider_id),
    FOREIGN KEY (schema_code, house_id)
        REFERENCES ais.house (schema_code, house_id),
    FOREIGN KEY (schema_code, acc_category_id)
        REFERENCES ais.ref_account_category (schema_code, acc_category_id),
    FOREIGN KEY (schema_code, housing_category_code)
        REFERENCES ais.ref_housing_category (schema_code, category_code),
    FOREIGN KEY (schema_code, ownership_type_code)
        REFERENCES ais.ref_ownership_type (schema_code, ownership_type_code),
    FOREIGN KEY (schema_code, uniq_attr)
        REFERENCES ais.ref_account_uniqueness (schema_code, uniq_attr),
    CONSTRAINT account_period_order CHECK (
        stop_date IS NULL OR start_date IS NULL OR stop_date >= start_date
    )
);

COMMENT ON TABLE ais.account IS
    'Лицевой счёт. Обслуживающая организация — provider_id. Адрес ЛС хранится отдельно от адреса дома: в АИС он собирается запросом, формулы в спецификации нет.';
COMMENT ON COLUMN ais.account.client_account IS 'CLIENT_ACCOUNT, текст с ведущими нулями.';
COMMENT ON COLUMN ais.account.unified_account IS 'UNIFIED_ACCOUNT, уникальный единый номер ЛС.';
COMMENT ON COLUMN ais.account.is_private_enterprise IS
    'Второй ACCOUNT_ID карточки: 1 — есть запись ЧУП, 0 — нет.';
COMMENT ON COLUMN ais.account.phone IS 'Третий ATTR_VALUE карточки, комментарий «Телефон».';
COMMENT ON COLUMN ais.account.contact_phone IS 'ATTR_VALUE_STR, контактный телефон.';

CREATE TABLE ais.account_info (
    schema_code varchar(30) NOT NULL,
    account_id  bigint NOT NULL,
    slot        smallint NOT NULL,
    param_id    bigint NOT NULL,
    param_value varchar(250),
    PRIMARY KEY (schema_code, account_id, slot),
    UNIQUE (schema_code, account_id, param_id),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id),
    CONSTRAINT account_info_slot CHECK (slot >= 1)
);

COMMENT ON TABLE ais.account_info IS
    'Доп. информация ЛС. Слоты 1 и 2 соответствуют INFO_PARAM_*1 и INFO_PARAM_*2; число слотов не ограничено двумя.';

CREATE TABLE ais.account_balance (
    schema_code       varchar(30) NOT NULL,
    account_id        bigint NOT NULL,
    oper_date         date NOT NULL,
    balance_in        ais.money,
    balance_out       ais.money,
    total_calc_sum    ais.money,
    pay_sum           ais.money,
    pay_sum_writeoff  ais.money,
    unshared_sum      ais.money,
    subsidy_sum       ais.money,
    PRIMARY KEY (schema_code, account_id, oper_date),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id)
);

COMMENT ON TABLE ais.account_balance IS
    'Срез сальдо и начислений карточки ЛС на операционную дату. subsidy_sum — это CALC_RESULT_SUM карточки (субсидия), не «Начислено» модуля услуг.';
COMMENT ON COLUMN ais.account_balance.oper_date IS
    'В карточке ЛС периода нет. Дата берётся из операционного периода загрузки, того же, что OPER_DATE регистрации.';

CREATE TABLE ais.account_population (
    schema_code              varchar(30) NOT NULL,
    account_id               bigint NOT NULL,
    oper_date                date NOT NULL,
    subj_count               ais.nonneg_int,
    priv_acc_count           ais.nonneg_int,
    main_subj_count          ais.nonneg_int,
    relatives_count          ais.nonneg_int,
    renters_count            ais.nonneg_int,
    minor_count              ais.nonneg_int,
    temp_absent_count        ais.nonneg_int,
    temp_staying_count       ais.nonneg_int,
    temp_without_reg_count   ais.nonneg_int,
    tenancy_count            ais.nonneg_int,
    pets_count               ais.nonneg_int,
    PRIMARY KEY (schema_code, account_id, oper_date),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id)
);

COMMENT ON TABLE ais.account_population IS
    'Счётчики состава ЛС. В выгрузке они повторяются на каждой регистрации и на карточке; зависят от ЛС и периода, не от лица. temp_staying_count — колонка TEMP_STAING_COUNT.';

-- ---------------------------------------------------------------------------
-- Договор на услугу и расчёт
-- ---------------------------------------------------------------------------

CREATE TABLE ais.service_contract (
    schema_code      varchar(30) NOT NULL,
    service_list_id  bigint NOT NULL,
    account_id       bigint NOT NULL,
    service_id       bigint NOT NULL,
    provider_id      bigint,
    report_group_id  bigint,
    sort_code        bigint,
    start_date       date,
    stop_date        date,
    PRIMARY KEY (schema_code, service_list_id),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id),
    FOREIGN KEY (schema_code, service_id)
        REFERENCES ais.ref_service (schema_code, service_id),
    FOREIGN KEY (schema_code, provider_id)
        REFERENCES ais.provider (schema_code, provider_id),
    CONSTRAINT service_contract_period CHECK (
        stop_date IS NULL OR start_date IS NULL OR stop_date >= start_date
    )
);

COMMENT ON TABLE ais.service_contract IS
    'Договор на услугу по ЛС (SERVICE_LIST_ID). Поставщик услуги может отличаться от обслуживающей организации ЛС.';

CREATE TABLE ais.service_calculation (
    schema_code         varchar(30) NOT NULL,
    calculation_id      bigint NOT NULL,
    service_list_id     bigint NOT NULL,
    calc_date           date,
    debt_month_count    ais.nonneg_int,
    balance_in          ais.money,
    balance_mulct_in    ais.money,
    balance_out         ais.money,
    balance_mulct_out   ais.money,
    calc_sum            ais.money,
    calc_result_sum     ais.money,
    calc_priv_sum       ais.money,
    spent_fact          ais.qty,
    tariff              ais.qty,
    mulct_sum           ais.money,
    recalc_sum          ais.money,
    mulct_recalc_sum    ais.money,
    netting_sum         ais.money,
    netting_mulct_sum   ais.money,
    overdue_debt        ais.money,
    share_service_sum   ais.money,
    share_mulct_sum     ais.money,
    subs_pay            ais.money,
    PRIMARY KEY (schema_code, calculation_id),
    UNIQUE (schema_code, service_list_id, calculation_id),
    FOREIGN KEY (schema_code, service_list_id)
        REFERENCES ais.service_contract (schema_code, service_list_id)
);

COMMENT ON TABLE ais.service_calculation IS
    'Операция расчёта по договору (CALCULATION_ID) и суммы этого расчёта, включая распределённую оплату периода.';
COMMENT ON COLUMN ais.service_calculation.debt_month_count IS
    'DEBT_PERIOD. В файле спецификации тип DATE, по комментарию — число различных месяцев долга.';
COMMENT ON COLUMN ais.service_calculation.tariff IS 'Колонка выгрузки называется TARRIF.';
COMMENT ON COLUMN ais.service_calculation.mulct_recalc_sum IS 'MULCTRECALCSUMM.';
COMMENT ON COLUMN ais.service_calculation.calc_result_sum IS
    '«Начислено» модуля услуг. Не путать с субсидией карточки ЛС.';

-- ---------------------------------------------------------------------------
-- Оплаты
-- ---------------------------------------------------------------------------

CREATE TABLE ais.payment_package (
    schema_code    varchar(30) NOT NULL REFERENCES ais.billing_schema (code),
    package_id     bigint NOT NULL,
    package_status integer,
    PRIMARY KEY (schema_code, package_id)
);

COMMENT ON TABLE ais.payment_package IS
    'Пачка оплат. Статус пачки зависит от пачки, а не от каждой квитанции. Имени статуса в спецификации нет.';

CREATE TABLE ais.payment_receipt (
    schema_code          varchar(30) NOT NULL,
    receipt_id           bigint NOT NULL,
    account_id           bigint NOT NULL,
    package_id           bigint,
    source_receipt_id    bigint,
    receipt_id_ges       bigint,
    execution_id         bigint,
    bank_id              bigint,
    payment_type         text,
    pay_date             date,
    bank_date            date,
    acc_oper_date        date,
    otdel                varchar(11),
    pp_num               varchar(16),
    pay_service_sum      ais.money,
    pay_mulct_sum        ais.money,
    refund_sum           ais.money,
    commission_sum       ais.money,
    notes                varchar(255),
    client_account_file  varchar(25),
    client_name_file     varchar(99),
    payer_address_file   varchar(255),
    PRIMARY KEY (schema_code, receipt_id),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id),
    FOREIGN KEY (schema_code, package_id)
        REFERENCES ais.payment_package (schema_code, package_id),
    FOREIGN KEY (schema_code, bank_id)
        REFERENCES ais.ref_bank (schema_code, bank_id),
    FOREIGN KEY (payment_type)
        REFERENCES ais.ref_payment_type (code),
    FOREIGN KEY (schema_code, source_receipt_id)
        REFERENCES ais.payment_receipt (schema_code, receipt_id)
        DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE ais.payment_receipt IS
    'Квитанция. Суммы pay_* — «по квитанции». Поля *_file — значения из платёжного файла, их нельзя заменять данными ЛС.';
COMMENT ON COLUMN ais.payment_receipt.receipt_id_ges IS
    'ID квитанции в pay_kvit. Это другой контур, внешнего ключа на payment_receipt нет.';
COMMENT ON COLUMN ais.payment_receipt.execution_id IS
    'ID документа на взыскание. Других атрибутов документа в спецификации нет.';
COMMENT ON COLUMN ais.payment_receipt.source_receipt_id IS 'ID исходной квитанции.';

CREATE TABLE ais.payment_allocation (
    schema_code        varchar(30) NOT NULL,
    receipt_id         bigint NOT NULL,
    allocation_no      smallint NOT NULL,
    service_id         bigint,
    provider_id        bigint,
    share_service_sum  ais.money,
    share_mulct_sum    ais.money,
    share_status       smallint,
    PRIMARY KEY (schema_code, receipt_id, allocation_no),
    FOREIGN KEY (schema_code, receipt_id)
        REFERENCES ais.payment_receipt (schema_code, receipt_id) ON DELETE CASCADE,
    FOREIGN KEY (schema_code, service_id)
        REFERENCES ais.ref_service (schema_code, service_id),
    FOREIGN KEY (schema_code, provider_id)
        REFERENCES ais.provider (schema_code, provider_id),
    CONSTRAINT payment_allocation_no CHECK (allocation_no >= 1)
);

COMMENT ON TABLE ais.payment_allocation IS
    'Распределение квитанции по услуге в периоде. Отделено от заголовка, чтобы суммы «по квитанции» не повторялись на каждой услуге.';
COMMENT ON COLUMN ais.payment_allocation.provider_id IS
    'PROVIDER_ID поставщика услуги. PROVIDER_ID_JES (обслуживающая организация ЛС) сюда не копируется: он равен account.provider_id.';
COMMENT ON COLUMN ais.payment_allocation.share_status IS
    'Способ распределения, код. Наименования в спецификации нет.';

-- ---------------------------------------------------------------------------
-- Лицо и регистрация на ЛС
-- ---------------------------------------------------------------------------

CREATE TABLE ais.subject (
    schema_code         varchar(30) NOT NULL,
    subj_id             numeric(20, 0) NOT NULL,
    fam                 varchar(100),
    im                  varchar(100),
    ot                  varchar(100),
    birthday            date,
    sex_code            integer,
    personal_num        varchar(100),
    citizenship_id      bigint,
    nationality         varchar(250),
    marital_status_code integer,
    email               varchar(50),
    contact_phone       varchar(50),
    residence_address   varchar(100),
    death_date          date,
    is_legal_entity     boolean,
    payer_acc_num       varchar(40),
    social_category_id  bigint,
    social_note_id      bigint,
    parent_subj_id      numeric(20, 0),
    PRIMARY KEY (schema_code, subj_id),
    FOREIGN KEY (schema_code) REFERENCES ais.billing_schema (code),
    FOREIGN KEY (schema_code, sex_code)
        REFERENCES ais.ref_sex (schema_code, code),
    FOREIGN KEY (schema_code, citizenship_id)
        REFERENCES ais.ref_citizenship (schema_code, citizenship_id),
    FOREIGN KEY (schema_code, marital_status_code)
        REFERENCES ais.ref_marital_status (schema_code, code),
    FOREIGN KEY (schema_code, social_category_id)
        REFERENCES ais.ref_social_category (schema_code, code),
    FOREIGN KEY (schema_code, social_note_id)
        REFERENCES ais.ref_social_note (schema_code, note_id),
    FOREIGN KEY (schema_code, parent_subj_id)
        REFERENCES ais.subject (schema_code, subj_id)
        DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE ais.subject IS
    'Лицо (SUBJ_ID). Паспорт, гражданство и социальная категория не зависят от того, на каком ЛС лицо зарегистрировано.';
COMMENT ON COLUMN ais.subject.residence_address IS 'REGISTRATION_ADDRESS, адрес местожительства.';
COMMENT ON COLUMN ais.subject.payer_acc_num IS 'Учётный номер плательщика.';
COMMENT ON COLUMN ais.subject.parent_subj_id IS 'SUBJ_PARENT_SUBJ_ID. ФИО родителя собирается представлением.';

CREATE UNIQUE INDEX subject_personal_num_uq
    ON ais.subject (schema_code, personal_num)
    WHERE personal_num IS NOT NULL AND btrim(personal_num) <> '';

CREATE TABLE ais.subject_document (
    schema_code       varchar(30) NOT NULL,
    subj_id           numeric(20, 0) NOT NULL,
    doc_type_id       bigint,
    main_doc_type_id  bigint,
    series_number     varchar(100),
    issue_date        date,
    issued_by         varchar(200),
    digital_code      varchar(10),
    basis_name        varchar(100),
    PRIMARY KEY (schema_code, subj_id),
    FOREIGN KEY (schema_code, subj_id)
        REFERENCES ais.subject (schema_code, subj_id) ON DELETE CASCADE,
    FOREIGN KEY (schema_code, doc_type_id)
        REFERENCES ais.ref_doc_type (schema_code, doc_type_id),
    FOREIGN KEY (schema_code, main_doc_type_id)
        REFERENCES ais.ref_doc_type (schema_code, doc_type_id)
);

COMMENT ON TABLE ais.subject_document IS
    'Основной документ лица, одна текущая запись. doc_type_id — DOC_TYPE_ID, main_doc_type_id — MAINDOCTYPEID: в спецификации это два кода, оба ведут в один справочник типов.';

CREATE TABLE ais.subject_employment (
    schema_code        varchar(30) NOT NULL,
    subj_id            numeric(20, 0) NOT NULL,
    work_place_id      bigint,
    position_name      varchar(250),
    tabel_num          varchar(100),
    is_salary_accept   boolean,
    bank_id            bigint,
    bank_account       varchar(28),
    PRIMARY KEY (schema_code, subj_id),
    FOREIGN KEY (schema_code, subj_id)
        REFERENCES ais.subject (schema_code, subj_id) ON DELETE CASCADE,
    FOREIGN KEY (schema_code, work_place_id)
        REFERENCES ais.ref_workplace (schema_code, work_place_id),
    FOREIGN KEY (schema_code, bank_id)
        REFERENCES ais.ref_bank (schema_code, bank_id)
);

COMMENT ON TABLE ais.subject_employment IS
    'Текущее место работы и реквизиты удержания из зарплаты. В выгрузке блок повторяется на каждой регистрации лица; если у одного SUBJ_ID места работы в разных ЛС расходятся, это уже история занятости и в эту таблицу она не помещается.';

CREATE TABLE ais.registration (
    schema_code            varchar(30) NOT NULL,
    registration_id        numeric(20, 0) NOT NULL,
    account_id             bigint NOT NULL,
    subj_id                numeric(20, 0) NOT NULL,
    payer_reg_id           numeric(20, 0),
    oper_date              date,
    reg_type_code          integer,
    relation_degree_code   integer,
    payer_type_id          bigint,
    date_registration      date,
    date_from_ncp          date,
    check_in_date          date,
    check_out_date         date,
    fraction_land_tax      numeric(18, 8),
    is_main                boolean,
    is_close_relative      boolean,
    is_checked_out         boolean,
    is_registered          boolean,
    is_privileged          boolean,
    is_main_tenancy        boolean,
    tenancy_exists         boolean,
    idler_val              integer,
    idler_dep_val          integer,
    in_out_reason          varchar(250),
    notes                  varchar(250),
    owner_joint_name       text,
    legacy_param_type_id   integer,
    legacy_start_date      date,
    legacy_stop_date       date,
    heritage_date          date,
    PRIMARY KEY (schema_code, registration_id),
    UNIQUE (schema_code, account_id, subj_id, registration_id),
    FOREIGN KEY (schema_code, account_id)
        REFERENCES ais.account (schema_code, account_id),
    FOREIGN KEY (schema_code, subj_id)
        REFERENCES ais.subject (schema_code, subj_id),
    FOREIGN KEY (schema_code, payer_reg_id)
        REFERENCES ais.registration (schema_code, registration_id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (schema_code, reg_type_code)
        REFERENCES ais.ref_reg_type (schema_code, code),
    FOREIGN KEY (schema_code, relation_degree_code)
        REFERENCES ais.ref_relation_degree (schema_code, code),
    FOREIGN KEY (schema_code, payer_type_id)
        REFERENCES ais.ref_payer_type (schema_code, code),
    FOREIGN KEY (schema_code, legacy_param_type_id)
        REFERENCES ais.ref_legacy_type (schema_code, code),
    CONSTRAINT registration_stay_order CHECK (
        check_out_date IS NULL OR check_in_date IS NULL OR check_out_date >= check_in_date
    ),
    CONSTRAINT registration_legacy_order CHECK (
        legacy_stop_date IS NULL OR legacy_start_date IS NULL OR legacy_stop_date >= legacy_start_date
    )
);

COMMENT ON TABLE ais.registration IS
    'Регистрация лица на ЛС. Роль (плательщик, родство, тип регистрации, даты прибытия) зависит от этой регистрации, а не от лица вообще. Текущее состояние, не помесячная история.';
COMMENT ON COLUMN ais.registration.payer_reg_id IS 'Код регистрации плательщика на этом ЛС.';
COMMENT ON COLUMN ais.registration.is_registered IS 'SUBJ_IS_PROPIS, статус регистрации.';
COMMENT ON COLUMN ais.registration.is_privileged IS 'SUBJ_IS_PRIV.';
COMMENT ON COLUMN ais.registration.is_main_tenancy IS 'Является нанимателем без оплаты ЖКУ.';
COMMENT ON COLUMN ais.registration.tenancy_exists IS 'IS_TENANCY_EXIST.';
COMMENT ON COLUMN ais.registration.date_from_ncp IS 'Дата снятия с учёта по паспорту.';
COMMENT ON COLUMN ais.registration.owner_joint_name IS
    'ФИО участника совместной собственности. Идентификатора лица в спецификации нет, поэтому это текст, а не ссылка.';
COMMENT ON COLUMN ais.registration.in_out_reason IS
    'Причина прибытия или убытия. Кода в спецификации нет.';

CREATE TABLE ais.registration_pay_share (
    schema_code      varchar(30) NOT NULL,
    registration_id  numeric(20, 0) NOT NULL,
    slot             smallint NOT NULL,
    pay_contract_id  bigint NOT NULL,
    pay_part         varchar(81),
    PRIMARY KEY (schema_code, registration_id, slot),
    FOREIGN KEY (schema_code, registration_id)
        REFERENCES ais.registration (schema_code, registration_id) ON DELETE CASCADE,
    FOREIGN KEY (schema_code, pay_contract_id)
        REFERENCES ais.ref_pay_contract (schema_code, pay_contract_id),
    CONSTRAINT registration_pay_share_slot CHECK (slot >= 1)
);

COMMENT ON TABLE ais.registration_pay_share IS
    'Доля по документу. Слоты 1–3 соответствуют PAY_CONTRACT_* / PAY_PART* выгрузки; таблица не ограничивает число документов тремя.';

-- ---------------------------------------------------------------------------
-- Индексы внешних ключей, которых нет в левом префиксе первичного ключа
-- ---------------------------------------------------------------------------

CREATE INDEX account_provider_idx ON ais.account (schema_code, provider_id);
CREATE INDEX account_house_idx ON ais.account (schema_code, house_id);
CREATE INDEX account_client_idx ON ais.account (schema_code, client_account);
CREATE INDEX service_contract_account_idx ON ais.service_contract (schema_code, account_id);
CREATE INDEX service_contract_service_idx ON ais.service_contract (schema_code, service_id);
CREATE INDEX service_calculation_contract_idx ON ais.service_calculation (schema_code, service_list_id);
CREATE INDEX payment_receipt_account_idx ON ais.payment_receipt (schema_code, account_id);
CREATE INDEX payment_receipt_package_idx ON ais.payment_receipt (schema_code, package_id);
CREATE INDEX payment_allocation_service_idx ON ais.payment_allocation (schema_code, service_id);
CREATE INDEX registration_account_idx ON ais.registration (schema_code, account_id);
CREATE INDEX registration_subject_idx ON ais.registration (schema_code, subj_id);
CREATE INDEX registration_payer_idx ON ais.registration (schema_code, payer_reg_id);
CREATE INDEX subject_parent_idx ON ais.subject (schema_code, parent_subj_id);

-- ---------------------------------------------------------------------------
-- Представления формы модулей. Последний срез остатков и состава — по max(oper_date).
-- ---------------------------------------------------------------------------

CREATE VIEW ais.v_account_card AS
SELECT
    a.schema_code                                          AS schema_name,
    a.account_id,
    a.is_private_enterprise,
    a.client_account,
    a.unified_account,
    a.provider_id,
    p.short_name                                           AS shot_name,
    a.house_id,
    h.address                                              AS house_address,
    a.address                                              AS account_address,
    a.flat_number,
    a.total_space                                          AS acc_total_space,
    a.room_count,
    a.phone,
    a.contact_phone,
    a.acc_category_id,
    cat.short_name                                         AS acc_category_short,
    cat.full_name                                          AS acc_category_full,
    a.housing_category_code,
    hc.short_name                                          AS category_short_name,
    hc.name                                                AS category_name,
    a.ownership_type_code,
    ow.name                                                AS ownership_type_name,
    a.uniq_attr,
    uq.name                                                AS uniq_attr_name,
    a.start_date,
    a.stop_date,
    i1.param_id                                            AS info_param_id1,
    i1.param_value                                         AS info_param_value1,
    i2.param_id                                            AS info_param_id2,
    i2.param_value                                         AS info_param_value2,
    bal.oper_date                                          AS balance_oper_date,
    bal.balance_in,
    bal.balance_out,
    bal.total_calc_sum,
    bal.pay_sum,
    bal.pay_sum_writeoff,
    bal.unshared_sum,
    bal.subsidy_sum,
    pop.oper_date                                          AS population_oper_date,
    pop.subj_count,
    pop.priv_acc_count,
    (
        SELECT string_agg(ais.person_fio(s.fam, s.im, s.ot), ', ' ORDER BY s.fam, s.im, s.subj_id)
        FROM ais.registration r
        JOIN ais.subject s
          ON s.schema_code = r.schema_code AND s.subj_id = r.subj_id
        WHERE r.schema_code = a.schema_code
          AND r.account_id = a.account_id
          AND r.is_main IS TRUE
    )                                                      AS payer_names
FROM ais.account a
JOIN ais.provider p
  ON p.schema_code = a.schema_code AND p.provider_id = a.provider_id
LEFT JOIN ais.house h
  ON h.schema_code = a.schema_code AND h.house_id = a.house_id
LEFT JOIN ais.ref_account_category cat
  ON cat.schema_code = a.schema_code AND cat.acc_category_id = a.acc_category_id
LEFT JOIN ais.ref_housing_category hc
  ON hc.schema_code = a.schema_code AND hc.category_code = a.housing_category_code
LEFT JOIN ais.ref_ownership_type ow
  ON ow.schema_code = a.schema_code AND ow.ownership_type_code = a.ownership_type_code
LEFT JOIN ais.ref_account_uniqueness uq
  ON uq.schema_code = a.schema_code AND uq.uniq_attr = a.uniq_attr
LEFT JOIN ais.account_info i1
  ON i1.schema_code = a.schema_code AND i1.account_id = a.account_id AND i1.slot = 1
LEFT JOIN ais.account_info i2
  ON i2.schema_code = a.schema_code AND i2.account_id = a.account_id AND i2.slot = 2
LEFT JOIN LATERAL (
    SELECT b.*
    FROM ais.account_balance b
    WHERE b.schema_code = a.schema_code AND b.account_id = a.account_id
    ORDER BY b.oper_date DESC
    LIMIT 1
) bal ON TRUE
LEFT JOIN LATERAL (
    SELECT pop.*
    FROM ais.account_population pop
    WHERE pop.schema_code = a.schema_code AND pop.account_id = a.account_id
    ORDER BY pop.oper_date DESC
    LIMIT 1
) pop ON TRUE;

COMMENT ON VIEW ais.v_account_card IS
    'Карточка ЛС. payer_names — полное ФИО плательщиков; шаблон сокращения SHORT_FIO спецификация не задаёт.';

CREATE VIEW ais.v_service AS
SELECT
    c.schema_code,
    c.service_list_id,
    c.account_id,
    c.service_id,
    svc.name                                               AS service_name,
    svc.report_name                                        AS service_name_report,
    c.provider_id,
    pr.short_name                                          AS shot_name,
    pr.full_name,
    c.report_group_id,
    c.sort_code,
    c.start_date,
    c.stop_date,
    calc.calculation_id,
    calc.calc_date,
    calc.debt_month_count                                  AS debt_period,
    calc.balance_in,
    calc.balance_mulct_in,
    calc.balance_out,
    calc.balance_mulct_out,
    calc.calc_sum,
    calc.calc_result_sum,
    calc.calc_priv_sum,
    calc.spent_fact,
    calc.tariff                                            AS tarrif,
    calc.mulct_sum,
    calc.recalc_sum,
    calc.mulct_recalc_sum                                  AS mulctrecalcsumm,
    calc.netting_sum,
    calc.netting_mulct_sum,
    calc.overdue_debt,
    calc.share_service_sum                                 AS share_service_summ,
    calc.share_mulct_sum                                   AS share_mulct_summ,
    calc.subs_pay
FROM ais.service_contract c
JOIN ais.ref_service svc
  ON svc.schema_code = c.schema_code AND svc.service_id = c.service_id
LEFT JOIN ais.provider pr
  ON pr.schema_code = c.schema_code AND pr.provider_id = c.provider_id
LEFT JOIN ais.service_calculation calc
  ON calc.schema_code = c.schema_code AND calc.service_list_id = c.service_list_id;

COMMENT ON VIEW ais.v_service IS 'Модуль «Услуги»: договор и его расчёты. Имена услуги и поставщика берутся из справочников.';

CREATE VIEW ais.v_payment AS
SELECT
    r.schema_code,
    r.receipt_id,
    r.source_receipt_id,
    r.receipt_id_ges,
    r.account_id,
    a.client_account,
    r.client_account_file,
    a.provider_id                                          AS provider_id_jes,
    r.package_id,
    pkg.package_status,
    r.execution_id,
    r.otdel,
    r.pp_num,
    h.address                                              AS house_address,
    a.address                                              AS account_address,
    r.payer_address_file                                   AS address,
    r.bank_id,
    bk.name                                                AS bankname,
    r.pay_date,
    r.bank_date,
    r.acc_oper_date,
    r.pay_service_sum                                      AS pay_service_summ,
    r.pay_mulct_sum                                        AS pay_mulct_summ,
    r.refund_sum,
    r.commission_sum                                       AS commission_summ,
    r.notes,
    r.payment_type,
    pt.name                                                AS payment_type_name,
    r.client_name_file                                     AS client_name,
    al.allocation_no,
    al.provider_id,
    sp.short_name                                          AS shot_name,
    al.service_id,
    svc.name                                               AS service_name,
    al.share_service_sum,
    al.share_mulct_sum,
    al.share_status,
    (
        SELECT string_agg(ais.person_fio(s.fam, s.im, s.ot), ', ' ORDER BY s.fam, s.im, s.subj_id)
        FROM ais.registration reg
        JOIN ais.subject s
          ON s.schema_code = reg.schema_code AND s.subj_id = reg.subj_id
        WHERE reg.schema_code = a.schema_code
          AND reg.account_id = a.account_id
          AND reg.is_main IS TRUE
    )                                                      AS payer_reg_name
FROM ais.payment_receipt r
JOIN ais.account a
  ON a.schema_code = r.schema_code AND a.account_id = r.account_id
LEFT JOIN ais.house h
  ON h.schema_code = a.schema_code AND h.house_id = a.house_id
LEFT JOIN ais.payment_package pkg
  ON pkg.schema_code = r.schema_code AND pkg.package_id = r.package_id
LEFT JOIN ais.ref_bank bk
  ON bk.schema_code = r.schema_code AND bk.bank_id = r.bank_id
LEFT JOIN ais.ref_payment_type pt
  ON pt.code = r.payment_type
LEFT JOIN ais.payment_allocation al
  ON al.schema_code = r.schema_code AND al.receipt_id = r.receipt_id
LEFT JOIN ais.provider sp
  ON sp.schema_code = al.schema_code AND sp.provider_id = al.provider_id
LEFT JOIN ais.ref_service svc
  ON svc.schema_code = al.schema_code AND svc.service_id = al.service_id;

COMMENT ON VIEW ais.v_payment IS
    'Модуль «Оплаты». Строка без распределения остаётся одной. client_account — номер ЛС, client_account_file — номер из файла.';

CREATE VIEW ais.v_registration AS
SELECT
    reg.schema_code,
    reg.registration_id,
    reg.account_id,
    a.client_account,
    a.provider_id,
    org.short_name                                         AS provider_name,
    org.full_name                                          AS provider_full_name,
    a.house_id,
    h.address                                              AS house_address,
    a.address                                              AS account_address,
    reg.oper_date,
    reg.subj_id,
    sub.fam,
    sub.im,
    sub.ot,
    ais.person_fio(sub.fam, sub.im, sub.ot)               AS fio,
    sub.birthday,
    sub.sex_code                                           AS sex,
    sex.name                                               AS sex_name,
    sub.personal_num,
    sub.citizenship_id,
    cit.name                                               AS citizenship_name,
    sub.nationality                                        AS subj_nationality,
    sub.marital_status_code                                AS marital_status,
    mar.name                                               AS marital_status_name,
    sub.email,
    sub.contact_phone,
    sub.residence_address                                  AS registration_address,
    sub.death_date                                         AS subj_death_date,
    sub.is_legal_entity                                    AS subj_legal_entity,
    sub.payer_acc_num,
    sub.social_category_id                                 AS citizen_social_category_id,
    scat.name                                              AS citizen_social_category_name,
    sub.social_note_id                                     AS note_id,
    snote.name                                             AS note_name,
    sub.parent_subj_id                                     AS subj_parent_subj_id,
    ais.person_fio(par.fam, par.im, par.ot)               AS parent_fio,
    doc.doc_type_id,
    doc.main_doc_type_id                                   AS maindoctypeid,
    dtype.short_name                                       AS doc_type_name,
    dtype.full_name                                        AS doc_type_full_name,
    doc.series_number                                      AS maindocsnum,
    doc.issue_date                                         AS maindocdate,
    doc.issued_by                                          AS maindocorgan,
    doc.digital_code                                       AS maindoc_digital_code,
    doc.basis_name,
    emp.work_place_id,
    wp.name                                                AS work_place_name,
    emp.position_name                                      AS work_place_capacity,
    emp.tabel_num,
    emp.is_salary_accept,
    emp.bank_id,
    ebk.name                                               AS bankname,
    emp.bank_account,
    reg.payer_reg_id,
    ais.person_fio(pay_sub.fam, pay_sub.im, pay_sub.ot)   AS payer_reg_name,
    reg.reg_type_code                                      AS reg_type,
    rtype.name                                             AS reg_type_name,
    reg.relation_degree_code                               AS relation_degree_value,
    rel.name                                               AS relation_degree_name,
    reg.payer_type_id,
    ptype.name                                             AS payer_type_name,
    reg.date_registration,
    reg.date_from_ncp,
    reg.check_in_date,
    reg.check_out_date,
    reg.fraction_land_tax,
    reg.is_main                                            AS subj_is_main,
    reg.is_close_relative,
    reg.is_checked_out                                     AS subj_is_check_out,
    reg.is_registered                                      AS subj_is_propis,
    reg.is_privileged                                      AS subj_is_priv,
    reg.is_main_tenancy,
    reg.tenancy_exists                                     AS is_tenancy_exist,
    reg.idler_val,
    reg.idler_dep_val,
    reg.in_out_reason                                      AS in_out_reason_name,
    reg.notes,
    reg.owner_joint_name,
    reg.legacy_param_type_id,
    leg.name                                               AS legacy_param_type_name,
    reg.legacy_start_date,
    reg.legacy_stop_date,
    reg.heritage_date                                      AS subj_heritage_date,
    sh1.pay_contract_id                                    AS pay_contract_id1,
    c1.name                                                AS pay_contract_name1,
    sh1.pay_part                                           AS pay_part1,
    sh2.pay_contract_id                                    AS pay_contract_id2,
    c2.name                                                AS pay_contract_name2,
    sh2.pay_part                                           AS pay_part2,
    sh3.pay_contract_id                                    AS pay_contract_id3,
    c3.name                                                AS pay_contract_name3,
    sh3.pay_part                                           AS pay_part3,
    pop.subj_count,
    pop.priv_acc_count,
    pop.main_subj_count,
    pop.relatives_count,
    pop.renters_count,
    pop.minor_count,
    pop.temp_absent_count,
    pop.temp_staying_count,
    pop.temp_without_reg_count,
    pop.tenancy_count,
    pop.pets_count
FROM ais.registration reg
JOIN ais.account a
  ON a.schema_code = reg.schema_code AND a.account_id = reg.account_id
JOIN ais.subject sub
  ON sub.schema_code = reg.schema_code AND sub.subj_id = reg.subj_id
JOIN ais.provider org
  ON org.schema_code = a.schema_code AND org.provider_id = a.provider_id
LEFT JOIN ais.house h
  ON h.schema_code = a.schema_code AND h.house_id = a.house_id
LEFT JOIN ais.subject par
  ON par.schema_code = sub.schema_code AND par.subj_id = sub.parent_subj_id
LEFT JOIN ais.ref_sex sex
  ON sex.schema_code = sub.schema_code AND sex.code = sub.sex_code
LEFT JOIN ais.ref_citizenship cit
  ON cit.schema_code = sub.schema_code AND cit.citizenship_id = sub.citizenship_id
LEFT JOIN ais.ref_marital_status mar
  ON mar.schema_code = sub.schema_code AND mar.code = sub.marital_status_code
LEFT JOIN ais.ref_social_category scat
  ON scat.schema_code = sub.schema_code AND scat.code = sub.social_category_id
LEFT JOIN ais.ref_social_note snote
  ON snote.schema_code = sub.schema_code AND snote.note_id = sub.social_note_id
LEFT JOIN ais.subject_document doc
  ON doc.schema_code = sub.schema_code AND doc.subj_id = sub.subj_id
LEFT JOIN ais.ref_doc_type dtype
  ON dtype.schema_code = doc.schema_code AND dtype.doc_type_id = doc.main_doc_type_id
LEFT JOIN ais.subject_employment emp
  ON emp.schema_code = sub.schema_code AND emp.subj_id = sub.subj_id
LEFT JOIN ais.ref_workplace wp
  ON wp.schema_code = emp.schema_code AND wp.work_place_id = emp.work_place_id
LEFT JOIN ais.ref_bank ebk
  ON ebk.schema_code = emp.schema_code AND ebk.bank_id = emp.bank_id
LEFT JOIN ais.registration pay_reg
  ON pay_reg.schema_code = reg.schema_code AND pay_reg.registration_id = reg.payer_reg_id
LEFT JOIN ais.subject pay_sub
  ON pay_sub.schema_code = pay_reg.schema_code AND pay_sub.subj_id = pay_reg.subj_id
LEFT JOIN ais.ref_reg_type rtype
  ON rtype.schema_code = reg.schema_code AND rtype.code = reg.reg_type_code
LEFT JOIN ais.ref_relation_degree rel
  ON rel.schema_code = reg.schema_code AND rel.code = reg.relation_degree_code
LEFT JOIN ais.ref_payer_type ptype
  ON ptype.schema_code = reg.schema_code AND ptype.code = reg.payer_type_id
LEFT JOIN ais.ref_legacy_type leg
  ON leg.schema_code = reg.schema_code AND leg.code = reg.legacy_param_type_id
LEFT JOIN ais.registration_pay_share sh1
  ON sh1.schema_code = reg.schema_code AND sh1.registration_id = reg.registration_id AND sh1.slot = 1
LEFT JOIN ais.ref_pay_contract c1
  ON c1.schema_code = sh1.schema_code AND c1.pay_contract_id = sh1.pay_contract_id
LEFT JOIN ais.registration_pay_share sh2
  ON sh2.schema_code = reg.schema_code AND sh2.registration_id = reg.registration_id AND sh2.slot = 2
LEFT JOIN ais.ref_pay_contract c2
  ON c2.schema_code = sh2.schema_code AND c2.pay_contract_id = sh2.pay_contract_id
LEFT JOIN ais.registration_pay_share sh3
  ON sh3.schema_code = reg.schema_code AND sh3.registration_id = reg.registration_id AND sh3.slot = 3
LEFT JOIN ais.ref_pay_contract c3
  ON c3.schema_code = sh3.schema_code AND c3.pay_contract_id = sh3.pay_contract_id
LEFT JOIN ais.account_population pop
  ON pop.schema_code = reg.schema_code
 AND pop.account_id = reg.account_id
 AND pop.oper_date = reg.oper_date;

COMMENT ON VIEW ais.v_registration IS
    'Модуль «Регистрация». Счётчики состава подставляются из среза с той же oper_date. Документы доли 4 и далее в три колонки выгрузки не входят, они остаются в registration_pay_share.';

COMMIT;
