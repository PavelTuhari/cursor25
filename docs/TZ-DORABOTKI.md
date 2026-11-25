# ТЗ на доработки существующего кода

[← к оглавлению](INDEX.md) · Редакция 1.1 · 25.08.2026

> **Статус: работы 1–9 выполнены.** Микросервис и приложение собираются,
> проходят типизацию и 243 теста. Не сделано: платежи (работа 11, ждёт OQ-5) и
> пуш-уведомления (работа 10, часть C — вне этого репозитория). Отметки о
> готовности проставлены в таблице [«Оценка и порядок»](#оценка-и-порядок).

Что конкретно менять, чтобы реализовать [ТЗ на кошелёк](TZ-WALLET.md). Отсчёт от
текущего состояния репозитория: приложение с корпоративной опцией и микросервис,
работающий **в роли продавца от имени одной компании**.

Главное изменение одно, и из него следует почти всё остальное:

> Сервис перестаёт быть «одна установка = одна компания-продавец» и становится
> «одна установка обслуживает много компаний, каждая в своей роли».

## Что уже готово и не меняется

Пересматривать это не нужно — оно спроектировано с запасом:

* клиент SOAP и все 19 операций, включая `GetAcceptedInvoices`,
  `GetRejectedInvoices`, `GetArchivedInvoices`, `PostAcceptedInvoices`,
  `PostRejectedInvoices`, `SearchInvoices` — **написаны, оттипизированы и
  покрыты тестами, но не заведены в очередь**;
* формирование и валидация XML, подпись, outbox, резерв серий;
* конфигурируемость приложения через JSON, генерация схемы SQLite из
  конфигурации сущностей, офлайн-очередь;
* сущности `company` и `fiscal_invoices`, экран корпоративного кабинета.

---

# Часть A. Микросервис

## A-1. Учётные данные на компанию, а не на установку

**Сейчас.** `sfs.username` и `sfs.password` — глобальная конфигурация;
`EFacturaClient` создаётся один раз в `main.ts`.

**Нужно.** Клиент создаётся под конкретную связку. Конфигурационные учётные
данные остаются как «своя» связка продавца — тогда текущее поведение не
ломается.

```
src/sfs/clientFactory.ts   (новый)
  createClientFor(connection): EFacturaClient
  кэш по connectionId, инвалидация при отзыве
```

`EFacturaClient` **менять не нужно** — он уже принимает `SfsConfig` в
конструкторе. Достаточно собирать этот объект из связки.

## A-2. Хранилище связок

Новая таблица и репозиторий.

```sql
CREATE TABLE EFACT_CONNECTION (
  ID              NUMBER(19) GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID       VARCHAR2(64)  NOT NULL,
  IDNO            VARCHAR2(16)  NOT NULL,
  ACTOR_ROLE      NUMBER(1)     NOT NULL,   -- 1 продавец, 2 покупатель
  SFS_USERNAME    VARCHAR2(128) NOT NULL,
  SFS_SECRET      BLOB          NOT NULL,   -- AES-256-GCM
  SFS_SECRET_IV   RAW(12)       NOT NULL,
  STATE           VARCHAR2(16)  NOT NULL,   -- active | invalid | revoked
  CONSENT_AT      TIMESTAMP(6),
  CONSENT_VERSION VARCHAR2(32),
  LAST_POLL_AT    TIMESTAMP(6),
  LAST_ERROR      VARCHAR2(1000),
  CREATED_AT      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT EFACT_CONNECTION_UK UNIQUE (TENANT_ID, IDNO, ACTOR_ROLE)
);
```

**Требования к реализации:**

* `SFS_SECRET` шифруется AES-256-GCM; ключ из `EFACT__CRYPTO__KEY` или OCI Vault
  (SEC-1);
* расшифровка только в памяти на время вызова, результат никуда не сохраняется
  (SEC-2);
* `state = invalid` выставляется автоматически, когда SFS отвечает
  `AuthenticationFailedException` — дальше связка не опрашивается до
  вмешательства пользователя;
* отзыв **физически удаляет** `SFS_SECRET` и `SFS_USERNAME` (SEC-5).

**Файлы:** `sql/003_connections.sql`, `src/db/connections.ts`,
`src/crypto/secretBox.ts`.

## A-3. Входящие документы — зеркало outbox

```sql
CREATE TABLE EFACT_INBOX (
  ID              NUMBER(19) GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID       VARCHAR2(64)  NOT NULL,
  CONNECTION_ID   NUMBER(19)    NOT NULL,
  SERIA           VARCHAR2(16)  NOT NULL,
  NUMBER_         VARCHAR2(32)  NOT NULL,
  SUPPLIER_IDNO   VARCHAR2(16)  NOT NULL,
  BUYER_IDNO      VARCHAR2(16)  NOT NULL,
  ISSUED_AT       TIMESTAMP(6),
  TOTAL           NUMBER(18,2),
  TOTAL_VAT       NUMBER(18,2),
  INVOICE_STATUS  NUMBER(3),
  DECISION        VARCHAR2(16),   -- none | accepting | accepted | rejecting | rejected
  DECISION_NOTE   VARCHAR2(1000),
  XML             CLOB,
  PDF_CONTENT     BLOB,
  QR_TEXT         VARCHAR2(512),
  SOURCE          VARCHAR2(16)  NOT NULL,   -- sfs | platform
  UPDATED_AT      TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL
);

-- Ключ склейки: один документ, даже если пришёл двумя путями (FR-11).
CREATE UNIQUE INDEX EFACT_INBOX_DOC_UK
  ON EFACT_INBOX (TENANT_ID, SUPPLIER_IDNO, SERIA, NUMBER_);
```

Уникальный индекс — техническая реализация FR-11 и один из критериев приёмки:
НН от officeplus.md, пришедшая и напрямую, и из SFS, обязана остаться одной
записью.

## A-4. Воркер входящих

Новый модуль `src/queue/inbox.ts`, устроенный как существующий `pipeline.ts`.

Цикл по активным связкам с `actorRole = 2`:

1. `SearchInvoices` с `BuyerIDNO` и `IssuedOn` от последнего успешного опроса —
   узнаём, что появилось;
2. `GetInvoicesBySeriaNumber` для новых — забираем XML;
3. `upsert` в `EFACT_INBOX` по ключу склейки;
4. `CheckInvoicesStatus` для тех, что ещё не в терминальном статусе;
5. отправка отложенных решений: `PostAcceptedInvoices` и
   `PostRejectedInvoices` для записей в `accepting` и `rejecting`.

**Требования:**

* интервал на связку не чаще 15 минут, фаза сдвигается по `ID`, чтобы сотня
  связок не била в SFS одновременно (NFR, OQ-3);
* при `AuthenticationFailedException` связка переводится в `invalid` без
  повторов — пароль сам не починится;
* первичная загрузка — за 12 месяцев назад, страницами через
  `GetArchivedInvoices`;
* каждый вызов пишется в `EFACT_AUDIT` с `CONNECTION_ID` (SEC-4).

## A-5. REST: входящие и связки

Добавить в `src/http/server.ts`. Стиль и коды — как в
[API.md](../efactura-service/docs/API.md).

| Метод | Назначение |
|---|---|
| `POST /connections` | создать связку: IDNO, роль, логин, пароль, версия согласия |
| `GET /connections` | список связок со статусами, **без секретов** |
| `POST /connections/{id}/verify` | проверить учётные данные вызовом `Test` |
| `DELETE /connections/{id}` | отозвать доступ и удалить учётные данные |
| `GET /inbox` | входящие НН с фильтрами: компания, поставщик, статус, период |
| `GET /inbox/{id}` | одна НН |
| `GET /inbox/{id}/pdf` · `/xml` · `/qr` | вложения |
| `POST /inbox/{id}/accept` | принять |
| `POST /inbox/{id}/reject` | отклонить, комментарий обязателен |
| `GET /connections/{id}/audit` | что делалось от имени компании (SEC-4) |

**Отдельно:** ни один ответ не содержит пароля даже в замаскированном виде.
Тест на это обязателен.

## A-6. Прочее

**A-6.1 Роль покупателя в конфигурации.** `sfs.actorRole` перестаёт быть
глобальной величиной и берётся из связки. Значение в конфигурации остаётся
значением по умолчанию для «своей» связки.

**A-6.2 Метрики.** `GET /stats` дополняется разрезом по входящим: связок
активных и невалидных, документов по статусам, время последнего успешного опроса.

**A-6.3 Электронные накладные.** `InvoiceType: 1` проходит по коду, но не
проверялся. Отдельная задача, вне этого ТЗ.

---

# Часть B. Мобильное приложение

## B-1. Сущности

**Расширить `fiscal_invoices`** вместо создания второй сущности — так список
входящих и исходящих един, а экран один:

| Колонка | Тип | Зачем |
|---|---|---|
| `direction` | text | `in` \| `out` |
| `supplier_idno`, `supplier_name` | text | для входящих |
| `buyer_idno` | text | для исходящих |
| `decision` | text | `none` \| `accepting` \| `accepted` \| `rejecting` \| `rejected` |
| `decision_note` | text | комментарий при отклонении |
| `source` | text | `sfs` \| `platform` — только для метки |
| `paid_amount` | real | этап 3 |

**Новая сущность `connections`** — статус привязки компаний. Направление
`bidirectional`, но **пароль в неё не пишется никогда**: он уходит одноразовым
вызовом REST, минуя очередь синхронизации.

> Это исключение из принципа «всё через очередь» сделано намеренно: очередь
> хранит полезную нагрузку в локальной базе, а пароль чужой компании там
> оказаться не должен (FR-4).

**Новая сущность `payments`** — этап 3, модель закладывается сразу.

Схема SQLite сгенерируется сама, миграция выполнится при старте — это уже
работает.

## B-2. Экраны и блоки

| Что | Тип | Файл |
|---|---|---|
| Кошелёк — все документы | экран | `config/screens/wallet.json` |
| Подключения компаний | экран | `config/screens/connections.json` |
| Привязка компании | экран | `src/ui/screens/ConnectCompanyScreen.tsx` |
| Согласие на доступ | экран | `src/ui/screens/ConsentScreen.tsx` |
| Карточка НН с действиями | экран | `src/ui/screens/InvoiceScreen.tsx` |
| `wallet_list` | блок | входящие и исходящие с фильтрами |
| `connection_list` | блок | связки со статусами |
| `invoice_actions` | блок | принять / отклонить |
| `invoice_payment` | блок | этап 3 |

`fiscal_invoice_list` из корпоративного кабинета остаётся: он показывает
исходящие. Кошелёк — надстройка, а не замена.

Регистрация новых типов — в `blockTypes.ts` и `BLOCK_REGISTRY`, как обычно.

## B-3. Домен

**Расширить** [`src/domain/company.ts`](../mobile/src/domain/company.ts):

* `invoiceView` учитывает `direction` — для входящих словарь состояний другой
  («Ожидает решения», «Принята», «Отклонена»);
* `canDecide(invoice)` — решение возможно только в статусе 7 и при `decision:
  none`;
* `validateConnection(...)` — IDNO, непустой логин, отметка согласия.

**Новый** `src/domain/wallet.ts`: группировка по компаниям и поставщикам, суммы
по периоду, признак приближающегося срока оплаты.

## B-4. Конфигурация

Секция `wallet` в `app.config.json`: эндпоинты связок и входящих, интервал
обновления, глубина первичной загрузки, срок хранения PDF на устройстве,
включённость платежей.

Фич-флаги: `features.wallet`, `features.incomingInvoices`, `features.payments` —
разведены, чтобы этапы включались независимо.

## B-5. Переводы

Все новые ключи — сразу в `ro`, `ru`, `en`. Проверка одинаковости наборов уже
есть в тестах и в `validate-config`; она не даст выпустить неполный перевод.

---

# Часть C. Бэкенд UNA.md

Вне этого репозитория, но контракт фиксируем.

**C-1.** Прокси корпоративных эндпоинтов микросервиса с проверкой, что
пользователь имеет право действовать от имени компании.

**C-2.** `/account/connections` и `/account/inbox` — как в
[api-contract.md](../mobile/docs/api-contract.md), с дельта-синхронизацией по
`updated_at`.

**C-3.** Пароль API-пользователя проходит бэкенд **транзитом**, не логируется и
не сохраняется: сразу дальше в микросервис.

**C-4.** Пуш-уведомления по событиям FR-25.

---

## Оценка и порядок

| № | Работа | Часть | Зависимости | Статус |
|---|---|---|---|---|
| 1 | Шифрование секретов, таблица связок | A-2 | — | ✅ `src/crypto/secretBox.ts`, `sql/003_connections.sql` |
| 2 | Фабрика клиентов | A-1 | 1 | ✅ `src/sfs/clientFactory.ts` |
| 3 | Таблица входящих | A-3 | 1 | ✅ `src/db/connectionRepo.ts` |
| 4 | Воркер входящих | A-4 | 2, 3 | ✅ `src/queue/inbox.ts` |
| 5 | REST связок и входящих | A-5 | 4 | ✅ `src/http/routes/connections.ts` |
| 6 | Сущности и конфигурация приложения | B-1, B-4 | 5 | ✅ `connections`, `payments`, секция `wallet` |
| 7 | Экраны привязки и согласия | B-2 | 6 | ✅ `ConnectCompanyScreen.tsx` |
| 8 | Кошелёк и карточка НН | B-2, B-3 | 6 | ✅ `wallet.tsx`, `InvoiceScreen.tsx`, `domain/wallet.ts` |
| 9 | Действия покупателя | A-4, B-2 | 8 | ✅ `invoice_actions`, офлайн-очередь |
| 10 | Уведомления | C-4 | 9 | ⬜ часть C, вне репозитория |
| 11 | Платежи | B-1, B-2 | этап 3, OQ-5 | ⬜ модель заложена, реализация ждёт OQ-5 |

Пункты 1–5 делаются в микросервисе и проверяются против расширенного
эмулятора SFS — доступ к настоящей SFS для них не нужен.

## Эмулятор SFS — расширен ✅

`mock/sfs-mock.ts` доработан под пункты 1–9:

* **учёт разных учётных данных** — три пользователя, каждый видит только те
  документы, где его компания сторона сделки; неверный пароль даёт
  `AuthenticationFailedException`;
* `SearchInvoices` по `BuyerIDNO`, статусу и дате;
* `GetInvoicesBySeriaNumber` с полным XML;
* `GetArchivedInvoices` со страницами, `GetAcceptedInvoices`,
  `GetRejectedInvoices`;
* `PostAcceptedInvoices` и `PostRejectedInvoices`, **меняющие статус** и
  сохраняющие комментарий отказа;
* `seedIncomingInvoice()` — документ стороннего поставщика, который никогда не
  проходил через наш outbox; именно он проверяет, что кошелёк показывает не
  только наши собственные фактуры.

Последний пункт нужен для ветки TC-09 сценария: без него не проверить перевод
связки в `invalid`.

## Смотри также

* [TZ-WALLET.md](TZ-WALLET.md) — требования, откуда всё это следует
* [TEST-E2E-OFFICEPLUS.md](TEST-E2E-OFFICEPLUS.md) — как проверять
* [TESTING.md](TESTING.md) — что покрыто сейчас
