# Эксплуатация

[← к оглавлению](INDEX.md)

Установка описана в [DEPLOY.md](../efactura-service/docs/DEPLOY.md). Здесь — что
делать после того, как всё запущено.

## Пробы

| Запрос | Что проверяет |
|---|---|
| `GET /efactura/v1/health` | процесс жив; без токена, для оркестратора |
| `GET /efactura/v1/ready` | соединение с Oracle; `503`, если базы нет |
| `GET /efactura/v1/taxpayers/1000000000033` | сеть, TLS, учётные данные SFS и разбор ответа разом |

Третий — самая полезная проба после установки и после смены пароля.

## Что мониторить

| Сигнал | Где | Что значит |
|---|---|---|
| `GET /stats` → `failed > 0` | REST | документы, исчерпавшие попытки — требуют разбора |
| `GET /stats` → растущий `pending` | REST | очередь не разгребается: SFS недоступна или кончились серии |
| `sign.certificate.expiring` | лог | сертификат истекает менее чем через 30 дней |
| `sign.certificate.expired` | лог | истёк — **каждая** фактура будет падать |
| `config.env.unknown` | лог при старте | опечатка в имени переменной окружения |
| `pipeline.series.failed` | лог | не удаётся зарезервировать серии в SFS |
| `pipeline.step.failed` с `permanent: true` | лог | документ отправлен в `failed` |
| `sfs.retry` | лог | SFS отвечает медленно или отдаёт 5xx |
| `/ready` → 503 | REST | потеряна база |

Логи — JSON по строке на событие, прямо в stdout. Systemd, Docker и OCI Logging
принимают их без дополнительной настройки. Секреты в лог не попадают: логгер
вырезает всё, что похоже на пароль, токен, ключ или заголовок авторизации.

## Разбор инцидентов

### Фактура застряла в `pending`

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:8090/efactura/v1/stats
journalctl -u una-efactura --since "1 hour ago" | grep pipeline
```

Частые причины, по убыванию вероятности:

1. **Кончились серии.** В логе `pipeline.series.failed`. Проверьте, что
   API-пользователь имеет право резервировать номера, и что `GetSeriaAndNumbers`
   не отклоняется.
2. **SFS недоступна.** В логе `sfs.retry`. Сервис сам продолжит с backoff,
   максимум час между попытками.
3. **Воркер выключен.** `worker.enabled: false` в конфигурации. В логе при
   старте будет `worker.disabled`.

Прогнать очередь немедленно, не дожидаясь таймера:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:8090/efactura/v1/tick
```

### Фактура в `failed`

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:8090/efactura/v1/invoices/DOC-1001
```

`lastError` содержит причину. Типичные:

| Ошибка | Что делать |
|---|---|
| `InvoiceValidationError: ...` | документ кривой в учётной системе — исправить и отправить под **новым** `externalId` |
| `PostInvoices: 1 - XML incorect` | структура XML не принята; сравните с `GET /invoices/{id}/xml` и разделом 5 гайда CTIF |
| `SoapFaultError: AuthenticationFailedException` | неверные учётные данные или API-пользователь отключён |
| `EFacturaApiError: ... status 3` | SFS отклонила операцию; ищите в `EFACT_AUDIT` и сверяйте с `GetLogs` |

### Сверка с журналом SFS

У SFS есть собственный журнал вызовов. Сервис пишет свой в `EFACT_AUDIT`, с тем
же `RequestId` — по нему две картины сходятся:

```sql
SELECT OPERATION, REQUEST_ID, STATUS, DURATION_MS, ERROR, CREATED_AT
  FROM EFACT_AUDIT
 WHERE TENANT_ID = 'una-md'
   AND CREATED_AT > SYSTIMESTAMP - INTERVAL '1' DAY
 ORDER BY CREATED_AT DESC;
```

### Что именно ушло в SFS

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  localhost:8090/efactura/v1/invoices/DOC-1001/xml
```

Возвращает отправленный XML вместе с блоком `<Signatures>`. Это первое, что
нужно при разборе претензии: показывает ровно то, что получила налоговая, а не
то, что мы думаем, что отправили.

## Регулярные операции

### Смена сертификата

1. Положить новый `.p12` на место старого.
2. Перезапустить службу.
3. Проверить в логе строку `sign.certificate` — субъект и дата окончания должны
   быть от нового сертификата.

Сервис предупреждает за 30 дней (`sign.certificate.expiring`) и кричит после
истечения (`sign.certificate.expired`). Не игнорируйте первое: после истечения
встанет весь поток.

### Смена пароля API-пользователя SFS

Меняется в кабинете e-Factura директором компании. После смены обновить
`EFACT__SFS__PASSWORD` и перезапустить, затем проверить
`GET /taxpayers/{idno}`.

### Обновление сервиса

```bash
sudo systemctl stop una-efactura
# развернуть новую версию
sudo -u efactura npm ci --omit=dev && sudo -u efactura npm run build
sudo -u efactura npm run migrate
sudo systemctl start una-efactura
```

`TimeoutStopSec=45` в юните даёт незавершённому циклу дописать результат, чтобы
отправленная фактура не осталась записанной как неотправленная.

## Масштабирование

Штатно достаточно одного экземпляра: узкое место — SFS, а не мы.

Если понадобится больше, несколько процессов на одной базе безопасны: очередь
выбирается с `FOR UPDATE SKIP LOCKED`, поэтому один документ не достанется двум
воркерам. Никакой дополнительной координации не нужно.

## Резервное копирование

Схема `EFACTURA` содержит очередь, зарезервированные серии, отправленные XML с
подписями и аудит. Отправленные фактуры живут в SFS и восстановимы оттуда, но
**подписанный XML и аудит — нет**: включите схему в обычный бэкап базы.

Незанятые серии из `EFACT_SERIES` при потере базы не пропадают безвозвратно, но
будут числиться выданными на стороне SFS — после восстановления сверьтесь через
`SearchInvoices`.

## Смотри также

* [DEPLOY.md](../efactura-service/docs/DEPLOY.md) — установка
* [API.md](../efactura-service/docs/API.md) — коды ответов
* [SFS.md](../efactura-service/docs/SFS.md) — коды статусов и ошибок SFS
* [SECURITY.md](SECURITY.md) — обращение с секретами
