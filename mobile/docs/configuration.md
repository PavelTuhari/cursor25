# Руководство по конфигурации

Вся конфигурация — это JSON. Приложение собирает её из трёх источников, в порядке
возрастания приоритета:

1. **Встроенная** — файлы `config/*.json`, попадающие в бандл (`src/config/defaults.ts`).
2. **Кэшированная удалённая** — последняя принятая конфигурация с сервера, лежит в
   таблице `_kv` (ключ `config:remote`).
3. **Свежая удалённая** — `GET /app-config`, загружается при старте в фоне.

Слияние выполняет `src/config/merge.ts`: объекты сливаются по ключам (можно
переопределить один цвет или один фич-флаг), **массивы заменяются целиком** —
частично слитый список вкладок или блоков был бы конфигурацией, которую никто не писал.

Любая конфигурация — встроенная или пришедшая с сервера — проходит валидацию
(`src/config/validate.ts`). Невалидная удалённая конфигурация отбрасывается, приложение
продолжает работать на предыдущей (`remoteConfig.failOpen`). Невалидная встроенная —
это ошибка сборки, приложение падает на старте намеренно.

```
config/*.json ─┐
               ├─► merge ─► validate ─► ConfigBundle ─► UI, БД, синхронизация
GET /app-config┘                 └─ ошибки → откат к предыдущей конфигурации
```

---

## `app.config.json`

| Секция | Назначение |
|--------|-----------|
| `app` | идентификатор, название, `tenantId`, локали, валюта, контакты поддержки |
| `api` | `baseUrl`, таймаут, размер страницы, политика повторов, режим авторизации, доп. заголовки |
| `sync` | синхронизация при старте, интервал, порог «устаревших» данных, настройки outbox, лимит страниц |
| `remoteConfig` | включение удалённой конфигурации, endpoint, TTL кэша, `failOpen` |
| `features` | фич-флаги: `loyalty`, `shoppingList`, `favorites`, `stores`, `promoFlyers`, `search`, `account`, `purchaseHistory`, `eReceipts`, `cart`, `onlineOrders` |
| `loyalty` | формат штрихкода (`ean13` / `code128`), показ баллов и прогресса уровня |
| `account` | редактируемые поля профиля, галочка рассылки, размер страницы истории покупок, формат штрихкода чека |
| `catalog` | что показывать на карточке товара, число колонок, размер страницы |
| `search` | минимум символов, размер истории, задержка ввода |

Валидатор проверяет: `defaultLocale` входит в `locales`, `baseUrl` — абсолютный http(s),
`sync.minIntervalMinutes ≤ sync.intervalMinutes`, `maxPagesPerEntity > 0`, все фич-флаги
булевы.

### Вход в личный кабинет (`api.auth`)

```json
{
  "mode": "bearer",
  "flow": "otp",
  "requestCodeEndpoint": "/auth/request-code",
  "loginEndpoint": "/auth/login",
  "refreshEndpoint": "/auth/refresh",
  "logoutEndpoint": "/auth/logout",
  "otpLength": 4,
  "otpResendSeconds": 60,
  "anonymousAllowed": true,
  "termsUrl": "https://una.md/terms"
}
```

`flow: "otp"` — вход по коду из SMS (экран сам показывает шаг «телефон» → шаг «код» с
таймером повтора), `flow: "password"` — логин и пароль. Валидатор требует эндпоинты,
которые нужны выбранному сценарию, и предупреждает, если не задан `refreshEndpoint`
(без него истёкший токен просто разлогинит пользователя).

## `theme.config.json`

Две схемы — `light` и `dark` — с одинаковым набором цветов (валидатор следит за
паритетом, чтобы тёмная тема не «поехала» после ребрендинга), плюс типографика,
радиусы, отступы и URL плейсхолдера картинок.

Смена бренда сети — это обычно четыре значения: `primary`, `onPrimary`, `primaryMuted`,
`badge`.

## `navigation.config.json`

```json
{ "id": "list", "screen": "list", "icon": "list", "titleKey": "tab.list",
  "visibleIf": { "feature": "shoppingList" }, "badge": "shoppingListCount" }
```

- `screen` — id экрана из `config/screens/`;
- `titleKey` — ключ перевода;
- `icon` — имя из карты глифов `src/ui/components/Icon.tsx`;
- `visibleIf` — правило видимости (см. ниже);
- `badge` — счётчик из состояния приложения (сейчас поддержан `shoppingListCount`).

## Экраны и блоки: `config/screens/*.json`

Экран — это список блоков. Блок описывается типом, необязательным заголовком,
правилом видимости и свойствами:

```json
{
  "id": "home-deals",
  "type": "product_carousel",
  "titleKey": "home.deals",
  "visibleIf": { "feature": "promoFlyers" },
  "props": {
    "cardWidth": 156,
    "source": {
      "entity": "products",
      "where": [{ "field": "discount_percent", "op": ">", "value": 0 }],
      "orderBy": [{ "field": "discount_percent", "dir": "desc" }],
      "limit": 20
    },
    "moreAction": { "type": "navigate", "screen": "category", "params": { "preset": "deals" } }
  }
}
```

### Типы блоков

| Тип | Что рисует | Ключевые `props` |
|-----|------------|------------------|
| `search_bar` | строка поиска | `placeholderKey`, `target` |
| `hero_carousel` | баннеры-карусель | `source`, `aspectRatio`, `autoplayMs` |
| `category_grid` | плитка категорий | `source`, `columns`, `moreAction` |
| `category_list` | список категорий | `source`, `showProductCount` |
| `product_carousel` | горизонтальная лента товаров | `source`, `cardWidth`, `moreAction` |
| `product_grid` | сетка товаров | `source`, `columns` |
| `promo_flyers` | каталоги акций | `source`, `layout` (`carousel`/`grid`), `columns` |
| `loyalty_card` | карта лояльности со штрихкодом | `compact`, `action` |
| `info_banner` | информационный блок | `titleKey`, `textKey`, `icon`, `action` |
| `store_list` | список магазинов | `source`, `showWorkingHours`, `showServices` |
| `store_locator_card` | «ваш магазин» на главной | `limit`, `action` |
| `shopping_list` | список покупок | `showTotals`, `allowManualItems`, `suggestions` |
| `profile_header` | шапка профиля | — |
| `login_prompt` | приглашение войти (для анонимных) | `titleKey`, `textKey` |
| `logout_button` | выход из аккаунта с подтверждением | — |
| `purchase_history` | последние чеки на экране профиля | `source`, `moreAction` |
| `receipt_list` | полная история покупок | `source`, `showStore`, `showPoints` |
| `menu_list` | меню профиля | `items[]` |
| `sync_status` | состояние синхронизации | — |

Новый тип блока добавляется в двух местах: компонент в `src/ui/blocks/` и имя в
`src/ui/blocks/blockTypes.ts` (тест следит, чтобы реестр и список совпадали).

### Запросы к данным (`source`)

```json
{
  "entity": "promotions",
  "select": ["id", "title", "cover_url"],
  "where": [
    { "field": "ends_at", "op": ">=", "value": "$today", "orNull": true },
    { "field": "store_ids", "op": "like", "value": "%st-01%" }
  ],
  "orderBy": [{ "field": "sort_order", "dir": "asc" }],
  "search": "lapte",
  "limit": 20,
  "offset": 0
}
```

- операторы: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `in`, `is null`, `is not null`;
- `orNull: true` — строка подходит и если поле `NULL` (бессрочные акции);
- подстановки: `$now`, `$today`, `$locale`, `$storeId`, `$userId`, `$param.<имя>`;
- `search` ищет по колонкам сущности из `searchColumns`; каждое слово должно найтись
  хотя бы в одной колонке.

Имена полей проверяются по схеме сущности до попадания в SQL, значения всегда идут
параметрами — конфигурация не может выполнить произвольный SQL (см. тесты в
`__tests__/db.test.ts`).

### Правила видимости `visibleIf`

```json
{ "feature": "loyalty", "auth": "required", "locales": ["ro", "ru"] }
```

`auth: "required"` скрывает элемент у неавторизованного пользователя,
`auth: "anonymous"` — наоборот.

### Действия `action`

```json
{ "type": "navigate", "screen": "product", "params": { "productId": "p-1001" } }
{ "type": "url", "url": "https://una.md/support" }
{ "type": "addToList", "productId": "p-1001" }
{ "type": "sync" }
```

## `entities.config.json` — модель данных и синхронизация

Одна запись описывает и таблицу SQLite, и правила обмена:

```json
{
  "name": "shopping_list_items",
  "table": "shopping_list_items",
  "endpoint": "/list/items",
  "direction": "bidirectional",
  "syncMode": "delta",
  "pushMode": "rest",
  "conflict": "last_write_wins",
  "primaryKey": "id",
  "cursorField": "updated_at",
  "order": 70,
  "columns": [
    { "name": "id", "type": "text", "primaryKey": true },
    { "name": "product_id", "type": "text", "index": true },
    { "name": "quantity", "type": "real", "default": 1 },
    { "name": "is_done", "type": "boolean", "default": 0 },
    { "name": "updated_at", "type": "datetime", "index": true }
  ]
}
```

| Поле | Значения |
|------|----------|
| `direction` | `pull` (только с сервера), `push`, `bidirectional` |
| `syncMode` | `delta` (по курсору) или `full` (небольшие справочники целиком) |
| `pushMode` | `rest` (PUT/DELETE по записи) или `batch` (одним запросом) |
| `conflict` | `server_wins` (по умолчанию), `client_wins`, `last_write_wins` |
| `requiresAuth` | сущность синхронизируется только у авторизованного пользователя |
| `order` | порядок синхронизации: родительские сущности раньше дочерних |
| `columns[].type` | `text`, `integer`, `real`, `boolean`, `json`, `localized`, `datetime` |
| `requiresAuth` | данные аккаунта: не синхронизируются без входа и удаляются при выходе |
| `searchColumns` | колонки, по которым работает `search` в запросах |

`localized` — это JSON вида `{"ro": "Lapte", "ru": "Молоко"}`; приложение выбирает
перевод по текущей локали с откатом на локаль по умолчанию.

**Изменение схемы.** Для каждой таблицы хранится отпечаток её структуры. Если он
изменился (добавили колонку, индекс, тип), таблица пересоздаётся, курсор сбрасывается —
и данные приезжают заново при ближайшей синхронизации. Локальные несинхронизированные
изменения при этом не теряются: они лежат в `_outbox`, который никогда не удаляется.
Сущность, исчезнувшая из конфигурации, удаляется вместе со своей таблицей, курсором и
очередью.

## Данные аккаунта и выход

Сущности с `requiresAuth: true` (`profile`, `receipts`, `loyalty_account`, `favorites`)
синхронизируются только у авторизованного пользователя, а при выходе их таблицы,
курсоры и очереди удаляются с устройства — следующий человек, открывший приложение на
этом же телефоне, не увидит чужие чеки. `shopping_list_items` отмечен как данные
устройства и остаётся.

Чтобы сделать какую-то сущность «личной», достаточно проставить ей `requiresAuth: true`
в конфигурации — код менять не нужно.

## Переводы

`config/l10n/<локаль>.json` — плоские пары «ключ → строка», подстановки в фигурных
скобках: `"list.total": "Примерная сумма: {total}"`.

Валидатор требует: все ключи локали по умолчанию присутствуют в остальных локалях, и
каждый `*Key` из навигации и экранов действительно переведён.

## Пример: запуск нового клиента сети

Скопируйте `config/` в `config-<клиент>/` и измените:

1. `app.config.json`: `app.id`, `app.name`, `app.tenantId`, `api.baseUrl`, `features`.
2. `theme.config.json`: фирменные цвета в обеих схемах.
3. `navigation.config.json`: уберите ненужные вкладки.
4. `screens/home.json`: соберите главную из нужных блоков.
5. `l10n/*.json`: замените тексты бренда.

Проверьте: `npm run validate-config -- config-<клиент>`.

Тот же набор файлов можно отдавать с сервера в `GET /app-config` — тогда и правки в
раскладке главной, и включение новой вкладки доедут до установленных приложений без
публикации новой версии.
