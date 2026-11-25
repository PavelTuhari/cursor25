# REST-контракт una-efactura

Базовый путь — `service.http.basePath`, по умолчанию `/efactura/v1`.
Все методы кроме `GET /health` требуют заголовок
`Authorization: Bearer <service.apiToken>`. Пустой `apiToken` отключает
проверку — допустимо только в закрытом контуре.

Все ответы — JSON, UTF-8, `Cache-Control: no-store`.

---

## GET /health

Живость процесса. Без токена, чтобы оркестратор мог опрашивать без секретов.

```json
{ "ok": true, "service": "una-efactura" }
```

## GET /ready

Готовность обслуживать: проверяет соединение с Oracle. `503`, если БД
недоступна.

```json
{ "ok": true, "database": true, "signing": "pkcs12" }
```

## GET /stats

Количество документов по состояниям — для дашборда и алертов.

```json
{ "pending": 2, "posted": 14, "confirmed": 1203, "failed": 1 }
```

---

## POST /invoices

Принимает документ в очередь. **Идемпотентно по `externalId`**: повторная
отправка возвращает существующую строку и не создаёт вторую фактуру.

Тело — модель `InvoiceDocument`:

| Поле | Тип | Обязательно | Примечание |
|---|---|---|---|
| `externalId` | string | да | идентификатор в учётной системе |
| `deliveryDate` | ISO-8601 | да | дата поставки |
| `seria`, `number` | string | нет | если не заданы, сервис возьмёт из резерва |
| `supplier`, `buyer` | Party | да | см. ниже |
| `transporter` | Party | нет | |
| `delegateName`, `delegateDate` | string / ISO | нет | делегат |
| `lines[]` | InvoiceLine | да, минимум одна | |
| `total`, `totalVat` | number | нет | по умолчанию считаются из строк |
| `isPharma` | boolean | нет | `IsFarma` |
| `creationMotive` | number | нет | по умолчанию 4 |

**Party**: `idno` (13 цифр), `taxpayerType` (1 юрлицо, 2 физлицо,
3 нерезидент), `title`, `address`, `bankAccount { account, branchTitle,
branchCode }`.

**InvoiceLine**: `code`, `name`, `unitOfMeasure`, `quantity`,
`unitPriceWithoutVat`, `totalPriceWithoutVat`, `vatRate`, `totalVat`,
`totalPrice`.

Пример — [example-invoice.json](example-invoice.json).

**Ответы**

| Код | Когда |
|---|---|
| `202` | принято, тело — состояние документа |
| `400` | тело не разобралось (не JSON, обрыв, больше 5 МБ) |
| `422` | документ не прошёл проверку; `details[]` перечисляет что именно |
| `401` | нет или неверный токен |

```json
{
  "error": "invalid document",
  "details": [
    "buyer.idno must be 13 digits, got \"42\"",
    "lines[0].totalVat 30 does not match the 8% rate (11.94)"
  ]
}
```

Проверка выполняется синхронно именно для того, чтобы вызывающая сторона
узнала об ошибке, пока у неё ещё есть контекст: `PostInvoices` в SFS отвечает
на кривую пачку одним «1 - XML incorect» без указания документа и поля.

## GET /invoices

Последние 100 документов, новые первыми.

## GET /invoices/{externalId}

```json
{
  "externalId": "DOC-1001",
  "state": "posted",
  "seria": "EAA",
  "number": "000005001",
  "invoiceStatus": 7,
  "invoiceStatusName": "sent_to_buyer",
  "attempts": 0,
  "lastError": null,
  "createdAt": "2026-08-24T09:00:00.000Z",
  "updatedAt": "2026-08-24T09:00:12.000Z"
}
```

`state` — очередь сервиса: `pending`, `reserved`, `built`, `signed`, `posted`,
`confirmed`, `failed`, `canceled`.
`invoiceStatus` — код SIA e-Factura (см. [SFS.md](SFS.md)).

`404`, если документа нет.

## GET /invoices/{externalId}/pdf

Печатная форма из `GetInvoicesContentForPrint`.

```json
{ "format": "pdf", "contentBase64": "JVBERi0xLjQ..." }
```

`409`, если серия и номер ещё не назначены.

## GET /invoices/{externalId}/qr

```json
{
  "text": "https://efactura.sfs.md/EFactura.aspx?id=...",
  "pngBase64": "iVBORw0KGgo..."
}
```

## GET /invoices/{externalId}/xml

Отправленный XML — с блоком `<Signatures>`, если документ подписан. Нужен для
разбора претензий: показывает ровно то, что ушло в SFS.

## GET /taxpayers/{idno}

Данные контрагента из реестра SFS (`GetTaxpayersInfo`). `idno` — ровно 13 цифр,
иначе `404` без обращения к SFS.

```json
{
  "IDNO": "1000000000033",
  "Name": "UNA RETAIL SRL",
  "Address": "mun. Chisinau, str. Alba Iulia 75",
  "CodTVA": "0301234",
  "TaxpayerType": 1,
  "IsEFacturaActor": "true",
  "ExistInTaxRegistry": "true"
}
```

Используется формой корпоративного клиента в мобильном приложении: покупатель
вводит IDNO, приложение подставляет название и адрес из реестра.

## POST /tick

Прогоняет очередь немедленно, не дожидаясь `worker.pollIntervalMs`. Полезно в
тестах и при разборе инцидента.

```json
{ "posted": 3, "refreshed": 12 }
```

---

---

# Входящие фактуры и связки компаний

Доступно, когда `inbox.enabled: true`. Без `crypto.key` эти маршруты отвечают
`503`: хранить чужие учётные данные незашифрованными сервис отказывается.

## POST /connections

Подключает компанию: её IDNO, роль и **API-пользователя e-Factura**, созданного
директором этой компании в кабинете.

```json
{
  "idno": "1000000000015",
  "actorRole": 2,
  "sfsUsername": "buyer",
  "sfsPassword": "...",
  "consentAccepted": true
}
```

Порядок обработки важен и намеренно такой:

1. проверка полей, включая `consentAccepted` — без согласия пароль не читается
   дальше и никуда не уходит;
2. **проверка учётных данных** вызовом `Test` в SFS;
3. подстановка названия компании из реестра;
4. только теперь пароль шифруется и сохраняется.

Учётные данные, которые не работают, не превращаются в строку, которую воркер
будет бесконечно перепроверять.

| Код | Когда |
|---|---|
| `201` | связка создана; тело — её состояние |
| `422` | не прошло проверку поле, либо **SFS отклонила учётные данные** |
| `502` | SFS недоступна, проверить не удалось |
| `503` | `crypto.key` не настроен |

Повторный вызов для той же пары «компания + роль» **заменяет** учётные данные,
а не создаёт вторую связку.

## GET /connections · GET /connections/{id}

```json
{
  "id": 1,
  "idno": "1000000000015",
  "title": "ALFA DEMO SRL",
  "actorRole": 2,
  "state": "active",
  "sfsUsername": "buyer",
  "consentAt": "2026-08-25T08:30:00.000Z",
  "consentVersion": "2026-08-25",
  "lastPollAt": "2026-08-25T09:45:00.000Z",
  "lastError": null
}
```

Пароля здесь нет **по построению**: в объекте, который отдаёт этот маршрут, для
него нет поля. Тест проверяет, что ни одно слово, похожее на пароль, в ответ не
попадает.

`state`: `pending` проверяется · `active` работает · `invalid` учётные данные
отклонены, нужен владелец · `revoked` доступ отозван.

## POST /connections/{id}/verify

Проверяет учётные данные прямо сейчас. Всегда `200`; результат — в теле:
`{ "ok": true, "state": "active" }` либо `{ "ok": false, "state": "invalid",
"detail": "..." }`.

## DELETE /connections/{id}

Отзывает доступ. Учётные данные **удаляются физически**, а не помечаются флагом,
кэш клиента сбрасывается, опрос прекращается. Загруженные документы остаются.

## GET /connections/{id}/audit

Что делалось от имени компании: операция, время, длительность, результат.
Компания вправе это видеть, поэтому журнал отдаётся наружу, а не остаётся
внутренним.

## GET /inbox

Входящие фактуры. Фильтры: компания, поставщик, состояние решения.

```json
{
  "id": 12,
  "seria": "EBB",
  "number": "000000871",
  "supplierIdno": "1000000000024",
  "supplierName": "BETA DEMO SRL",
  "buyerIdno": "1000000000015",
  "issuedAt": "2026-08-21T10:15:00.000Z",
  "total": 4820.00,
  "totalVat": 803.33,
  "invoiceStatus": 7,
  "invoiceStatusName": "sent_to_buyer",
  "decision": "none",
  "source": "sfs",
  "hasXml": true
}
```

`source` — `sfs` или `platform`. Документ, пришедший обоими путями, остаётся
одной записью: ключ склейки — IDNO поставщика, серия и номер.

## GET /inbox/{id}/pdf · /xml · /qr

Печатная форма, оригинальный XML с подписями, QR-код. `409`, если содержимое
ещё не загружено или связка отозвана.

## POST /inbox/{id}/accept · /reject

Решение покупателя. `reject` требует непустой `comment` — его увидит поставщик,
и исправить потом нельзя.

```json
{ "comment": "Расхождение по количеству" }
```

| Код | Когда |
|---|---|
| `202` | решение поставлено в очередь; уйдёт в SFS следующим циклом |
| `409` | решение по этому документу уже принято или отправляется |
| `422` | отклонение без комментария |

Решение **ставится в очередь, а не отправляется синхронно** — так оно переживает
оборванный запрос, и так же работает офлайн-действие из приложения.

## POST /inbox/tick

Прогоняет цикл входящих немедленно: опрос связок, загрузка новых документов,
обновление статусов, отправка решений.

```json
{ "connections": 3, "ingested": 5, "decisions": 1 }
```

---

## Ошибки

Любая необработанная ошибка — `500` с `{ "error": "<сообщение>" }`. Секреты в
логи и в ответы не попадают: логгер вырезает всё, что похоже на пароль, токен
или ключ (`src/util/logger.ts`).
