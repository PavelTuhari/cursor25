# Контракт API синхронизации

Базовый адрес задаётся в `config/app.config.json` → `api.baseUrl`
(по умолчанию `https://api.una.md/retail/v1`). Все ответы — JSON в UTF-8.

Эталонная реализация контракта — `tools/mock-server.mjs`; она используется в
end-to-end тестах (`__tests__/e2e.test.ts`), так что документ и код не расходятся.

## Авторизация

- `Authorization: Bearer <token>` — если `api.auth.mode = "bearer"` и токен есть.
- На `401` клиент один раз вызывает `refresh` и повторяет запрос (сами эндпоинты
  `/auth/*` из этого правила исключены).
- Сущности с `requiresAuth: true` (`profile`, `receipts`, `loyalty_account`,
  `favorites`) не запрашиваются, пока пользователь не авторизован.
- Дополнительные заголовки берутся из `api.headers` (в поставке — `X-Tenant`,
  `X-App-Platform`).

### Вход по коду из SMS (`flow: "otp"`)

```
POST /auth/request-code   { "phone": "+37360123456" }
→ 200 { "request_id": "req-1", "resend_after_seconds": 60,
        "expires_in_seconds": 300, "dev_code": "1234" }
→ 422 если номер не подходит
```

`dev_code` возвращают только dev- и staging-контуры, чтобы QA не ждал SMS; приложение
показывает его отдельной строкой.

```
POST /auth/login   { "phone": "+37360123456", "code": "1234", "request_id": "req-1" }
→ 200 { "access_token": "...", "refresh_token": "...", "expires_in": 3600,
        "user": { "id": "usr-1001", "phone": "+37360123456", "email": "...",
                  "first_name": "Ion", "last_name": "Popescu" } }
→ 422 если код неверный или истёк
→ 429 если кодов запрошено слишком много
```

Телефон приложение нормализует до `+373XXXXXXXX` перед отправкой.

### Вход по паролю (`flow: "password"`)

```
POST /auth/login   { "login": "ion@example.md", "password": "..." }
```

### Продление и выход

```
POST /auth/refresh   { "refresh_token": "..." }   → тот же ответ с токенами
POST /auth/logout                                  → 204
```

Если `refresh` вернул ошибку, приложение считает сессию завершённой: очищает токен и
данные аккаунта на устройстве.

## Загрузка данных (pull)

```
GET {endpoint}?updated_since={cursor}&cursor={pageCursor}&limit={pageSize}
```

| Параметр | Когда отправляется |
|----------|--------------------|
| `updated_since` | при дельта-синхронизации, если курсор уже сохранён |
| `cursor` | при переходе на следующую страницу |
| `limit` | всегда, значение `api.pageSize` |

Ответ:

```json
{
  "items": [ { "id": "p-1001", "name": {"ro": "Lapte", "ru": "Молоко"}, "price": 17.9,
               "updated_at": "2026-08-23T10:00:00Z" } ],
  "deleted": ["p-0999"],
  "cursor": "2026-08-23T10:00:00Z",
  "has_more": false,
  "server_time": "2026-08-23T10:00:05Z"
}
```

Правила:

- `items` — записи в формате колонок сущности; `localized`-поля приходят объектом,
  `json`-поля — массивом или объектом, `boolean` — `true`/`false`.
- `deleted` — идентификаторы, удалённые на сервере после `updated_since`. Локальные
  строки с несинхронизированными правками не удаляются.
- `cursor` — что клиент пришлёт следующим `updated_since`. Если сервер его не вернул,
  клиент возьмёт максимальное значение `cursorField` из полученных записей.
- `has_more: true` **обязано** сопровождаться `cursor`, иначе клиент прерывает
  синхронизацию сущности с ошибкой (защита от бесконечного цикла); дополнительно
  действует лимит `sync.maxPagesPerEntity`.
- Для сущностей с `syncMode: "full"` сервер возвращает коллекцию целиком; всё, чего
  в ответе не было, клиент удаляет локально.

## Отправка изменений (push)

Очередь исходящих операций хранится локально (`_outbox`) и отправляется до загрузки,
чтобы свежая локальная правка не была перетёрта старой копией с сервера.

### `pushMode: "rest"` (список покупок)

```
PUT    {endpoint}/{id}    → 200 { …каноническая запись… }
DELETE {endpoint}/{id}    → 204 | 404 (404 считается успехом: записи уже нет)
```

Тело `PUT` — запись целиком, в формате колонок сущности. Ответ (если он есть)
записывается в базу как канонический, кроме `conflict: "client_wins"`.

### `pushMode: "batch"` (избранное)

```
POST {endpoint}/batch
{
  "operations": [
    { "op": "upsert", "id": "fav-1", "data": { "product_id": "p-1001" } },
    { "op": "delete", "id": "fav-2" }
  ]
}
```

```json
{
  "results": [
    { "id": "fav-1", "status": "ok", "record": { "id": "fav-1", "product_id": "p-1001",
      "updated_at": "2026-08-23T10:00:09Z" } },
    { "id": "fav-2", "status": "error", "error": "unknown product" }
  ]
}
```

Операции без результата или со `status: "error"` остаются в очереди и повторяются.

## Повторы и ошибки

| Ситуация | Поведение клиента |
|----------|-------------------|
| Сетевая ошибка, `429`, `5xx` | повтор, `api.retry.attempts` попыток, задержка `backoffMs × factor^(n-1)` до `maxBackoffMs` |
| `4xx` (кроме 429) | без повтора, ошибка отдаётся вызывающему коду |
| Ошибка push-задачи | задача остаётся в очереди, следующая попытка через `sync.outbox.backoffMs × factor^(n-1)` |
| `sync.outbox.maxAttempts` исчерпаны | задача удаляется, текст ошибки сохраняется в `_sync_state.last_error` и показывается в блоке «Синхронизация» |
| Ошибка одной сущности | остальные сущности синхронизируются, отчёт помечается `ok: false` |

## Удалённая конфигурация

```
GET /app-config?tenant={tenantId}&config_version={configVersion}
```

Ответ — частичная конфигурация; любая секция необязательна:

```json
{
  "configVersion": 2,
  "app":   { "features": { "promoFlyers": false } },
  "theme": { "light": { "colors": { "primary": "#0055AA" } } },
  "navigation": { "...": "заменяет секцию целиком" },
  "entities":   { "...": "заменяет секцию целиком" },
  "screens":    { "home": { "id": "home", "blocks": [] } },
  "translations": { "ru": { "home.deals": "Лучшие цены недели" } }
}
```

Объекты сливаются со встроенной конфигурацией, массивы заменяются. Ответ, не прошедший
валидацию, игнорируется — приложение остаётся на предыдущей конфигурации.

## Заказы

Заказ создаётся на устройстве (идентификатор генерируется там же, поэтому повторная
отправка идемпотентна) и уходит как `PUT /account/orders/{id}`:

```json
{
  "id": "ord_m1a2b3", "status": "new", "fulfillment": "delivery",
  "store_id": null, "address": "str. Dacia 47, ap. 12", "phone": "+37360123456",
  "slot_date": "2026-08-24", "slot_time": "12:00-14:00",
  "items": [{ "product_id": "p-1001", "title": "Lapte 2.5% 1 L", "quantity": 2,
              "unit": "l", "price": 17.9, "total": 35.8 }],
  "item_count": 1, "subtotal": 35.8, "discount_total": 0, "delivery_fee": 39,
  "total": 74.8, "coupon_code": null, "payment_method": "cash",
  "placed_at": "2026-08-23T12:05:00Z", "updated_at": "2026-08-23T12:05:00Z"
}
```

Ответ — канонический заказ: сервер присваивает `number`, выставляет `status`
(`new` → `confirmed` → `picking` → `ready` / `delivering` → `completed`, либо
`cancelled`) и его версия записывается поверх локальной (`conflict: server_wins`).
Отмена приходит тем же `PUT` со `status: "cancelled"`. Дальнейшие изменения статуса
приложение забирает дельта-синхронизацией.

## Купоны

`GET /account/coupons` отдаёт персональные купоны:

```json
{
  "id": "cpn-1001", "code": "LACTATE10",
  "title": { "ro": "-10% la lactate", "ru": "-10% на молочное" },
  "discount_type": "percent", "discount_value": 10, "min_order_total": 0,
  "category_ids": ["cat-dairy"], "product_ids": [],
  "starts_at": "2026-08-01T00:00:00Z", "ends_at": "2026-09-30T20:59:59Z",
  "is_activated": false, "used_at": null, "updated_at": "2026-08-20T08:00:00Z"
}
```

Активация уходит пачкой в `POST /account/coupons/batch` (`op: "upsert"` с
`is_activated: true` и `activated_at`). `discount_type` — `percent` или `amount`;
пустые `product_ids`/`category_ids` означают «весь чек».

## Push-уведомления

```
POST   /account/push-token   { "token": "ExponentPushToken[…]", "platform": "android",
                               "locale": "ro", "user_id": "usr-1001",
                               "topics": ["promotions", "orders", "personal"] }
→ 204
DELETE /account/push-token/{token}   → 204   (при выходе из аккаунта)
```

Полезная нагрузка уведомления задаёт переход: либо `{"screen": "order", "params": {"orderId": "…"}}`,
либо короткая форма `{"type": "order", "order_id": "…"}`. Приложение принимает только
известные экраны и только строковые параметры — всё остальное игнорируется.

## Формат чека

Позиции чека приходят в поле `items` как JSON-массив, поэтому история покупок читается
без дополнительных запросов:

```json
{
  "id": "rcp-1001", "number": "2026000001", "store_id": "st-01",
  "purchased_at": "2026-08-22T18:42:00Z",
  "total": 51.3, "discount_total": 7.2,
  "points_earned": 5, "points_spent": 0,
  "payment_method": "card", "fiscal_code": "MD00010000513",
  "item_count": 3,
  "items": [
    { "product_id": "p-1001", "name": { "ro": "Lapte 2.5% 1 L", "ru": "Молоко 2,5% 1 л" },
      "quantity": 2, "unit": "l", "price": 17.9, "total": 35.8, "discount": 7.2 }
  ],
  "updated_at": "2026-08-22T18:42:00Z"
}
```

`product_id` в позициях позволяет одной кнопкой перенести покупку в список покупок.

## Минимальный набор эндпоинтов

| Сущность | Эндпоинт | Направление | Режим |
|----------|----------|-------------|-------|
| `categories` | `/catalog/categories` | pull | delta |
| `products` | `/catalog/products` | pull | delta |
| `banners` | `/content/banners` | pull | full |
| `promotions` | `/promo/flyers` | pull | delta |
| `stores` | `/network/stores` | pull | full |
| `loyalty_account` | `/loyalty/account` | pull (auth) | full |
| `profile` | `/account/profile` | bidirectional (auth) | full, REST |
| `receipts` | `/account/receipts` | pull (auth) | delta |
| `coupons` | `/account/coupons` | bidirectional (auth) | delta, batch |
| `orders` | `/account/orders` | bidirectional (auth) | delta, REST |
| `cart_items` | — | local (не синхронизируется) | — |
| `shopping_list_items` | `/list/items` | bidirectional | delta, REST |
| `favorites` | `/account/favorites` | bidirectional | delta, batch |
| `company` | `/account/company` | bidirectional (auth) | full, REST |
| `fiscal_invoices` | `/account/invoices` | bidirectional (auth) | delta, REST |

Набор задаётся конфигурацией: добавление сущности на стороне UNA.md — это новая запись
в `entities.config.json`, а не изменение кода приложения.

## Корпоративные клиенты и e-Factura

Включается флагами `features.corporate` и `features.eFactura`; настройки —
в секции `corporate` файла `app.config.json`.

### `/account/company`

Реквизиты юрлица покупателя. Двусторонняя сущность: клиент заполняет их в
приложении, изменения уходят через очередь, поэтому форма работает офлайн.

```json
{
  "id": "cmp-2001",
  "idno": "1000000000015",
  "name": "ALFA DEMO SRL",
  "vat_code": "0305678",
  "legal_address": "mun. Chisinau, bd. Dacia 47/2",
  "delivery_address": "mun. Chisinau, str. Uzinelor 12",
  "bank_account": "MD24AG000225100013104168",
  "bank_name": "BC Moldova Agroindbank SA",
  "bank_swift": "MOBBMD22",
  "contact_name": "Ion Popescu",
  "contact_email": "contabilitate@example.md",
  "contact_phone": "+37322334455",
  "efactura_verified": true,
  "efactura_actor": true,
  "status": "active",
  "updated_at": "2026-08-20T09:00:00Z"
}
```

`efactura_verified` и `efactura_actor` **выставляет сервер**, а не приложение:
это результат вызова `GetTaxpayersInfo` в реестре SFS через микросервис
e-Factura. Приложение показывает их значками и никогда не меняет.

### `/account/company/lookup`

`GET ?idno=1000000000015` — подстановка названия и адреса из реестра SFS, чтобы
покупателю не пришлось вводить их вручную. Проксируется на
`GET /efactura/v1/taxpayers/{idno}` микросервиса.

### `/account/invoices`

Фискальные фактуры. Запрос создаётся приложением (push), сами документы приходят
с сервера (pull) по мере прохождения через e-Factura.

```json
{
  "id": "inv-3001",
  "receipt_id": "rcp-1006",
  "company_id": "cmp-2001",
  "seria": "EAA",
  "number": "000005948",
  "issued_at": "2026-07-21T12:40:00Z",
  "total": 811.00,
  "total_vat": 135.17,
  "state": "confirmed",
  "efactura_status": 3,
  "qr_text": "https://efactura.sfs.md/EFactura.aspx?id=...",
  "pdf_url": "https://api.una.md/retail/v1/account/invoices/inv-3001/pdf",
  "updated_at": "2026-07-22T08:15:00Z"
}
```

**Запрос фактуры по чеку.** Приложение пишет запись с
`id = "req-<receipt_id>"`, `receipt_id`, `company_id` и `state: "requested"`;
очередь отправляет её обычным upsert. Идентификатор выводится из чека, поэтому
повторное нажатие не создаёт вторую заявку. Сервер отвечает записью с
собственным `id`, которая заменяет черновик при следующей синхронизации.

**Поля состояния.** `state` — очередь микросервиса (`pending`, `posted`,
`confirmed`, `failed`, …), `efactura_status` — код SIA e-Factura:

| Код | Значение |
|---|---|
| 0 | черновик |
| 1 | подписана поставщиком |
| 2 | отклонена покупателем |
| 3 | принята покупателем |
| 5 | отозвана поставщиком |
| 7 | отправлена покупателю |
| 8 | подписана покупателем |
| 10 | доставлена |

Приложение сводит эти два поля в одно понятное покупателю состояние
(`invoiceView` в `src/domain/company.ts`), поэтому новый код на стороне SFS не
ломает экран — документ просто останется в состоянии «Запрошена», пока маппинг
не обновят.
