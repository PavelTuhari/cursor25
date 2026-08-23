# Контракт API синхронизации

Базовый адрес задаётся в `config/app.config.json` → `api.baseUrl`
(по умолчанию `https://api.una.md/retail/v1`). Все ответы — JSON в UTF-8.

Эталонная реализация контракта — `tools/mock-server.mjs`; она используется в
end-to-end тестах (`__tests__/e2e.test.ts`), так что документ и код не расходятся.

## Авторизация

- `Authorization: Bearer <token>` — если `api.auth.mode = "bearer"` и токен есть.
- На `401` клиент один раз вызывает `refresh` и повторяет запрос.
- Сущности с `requiresAuth: true` (например, `loyalty_account`) не запрашиваются,
  пока пользователь не авторизован.
- Дополнительные заголовки берутся из `api.headers` (в поставке — `X-Tenant`,
  `X-App-Platform`).

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

## Минимальный набор эндпоинтов

| Сущность | Эндпоинт | Направление | Режим |
|----------|----------|-------------|-------|
| `categories` | `/catalog/categories` | pull | delta |
| `products` | `/catalog/products` | pull | delta |
| `banners` | `/content/banners` | pull | full |
| `promotions` | `/promo/flyers` | pull | delta |
| `stores` | `/network/stores` | pull | full |
| `loyalty_account` | `/loyalty/account` | pull (auth) | full |
| `shopping_list_items` | `/list/items` | bidirectional | delta, REST |
| `favorites` | `/account/favorites` | bidirectional | delta, batch |

Набор задаётся конфигурацией: добавление сущности на стороне UNA.md — это новая запись
в `entities.config.json`, а не изменение кода приложения.
