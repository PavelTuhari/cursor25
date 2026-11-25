# una-efactura — автономный микросервис интеграции с SIA «e-Factura» (SFS.md)

Отправляет фискальные фактуры в систему Государственной налоговой службы
Молдовы, следит за их статусом и отдаёт наружу простой REST. Ставится
**отдельно у клиента**, на сервер сети или в OCI — одинаково, из одного образа.

Три решения определяют всё остальное:

1. **Сервис не пишет в учётную систему.** Он читает документы через три
   read-only вьюшки (`sql/002_erp_views.sql`) и хранит своё состояние в
   собственной схеме. Обновление ERP не может его сломать, а удаление схемы
   полностью убирает интеграцию.
2. **node-oracledb в thin-режиме.** Чистый JavaScript: не нужен Instant Client,
   `LD_LIBRARY_PATH` и совпадение архитектур. Установка у клиента — `npm ci`.
   Работает с Oracle 12.1+ и с Autonomous Database в OCI без изменений.
3. **Всё, что специфично для клиента, — в конфигурации.** Один образ, разные
   переменные окружения: свой tenant, свои реквизиты SFS, свой сертификат.

## Что реализовано

| Возможность | Где |
|---|---|
| Клиент SOAP-API e-Factura, все 19 операций WSDL | `src/sfs/` |
| Формирование XML фактуры по структуре гайда CTIF | `src/invoice/xml.ts` |
| Проверка документа до отправки (арифметика строк, IDNO, НДС) | `src/invoice/validate.ts` |
| Цифровая подпись XMLDSig: локальный PKCS#12 или STISC PKI-Server | `src/sign/` |
| Outbox с повторами, резерв серий/номеров, опрос статусов | `src/queue/` |
| REST для UNA и мобильного приложения | `src/http/server.ts` |
| **Входящие фактуры**: связки компаний, опрос SFS, приём и отклонение | `src/queue/inbox.ts` |
| **Шифрование чужих учётных данных** AES-256-GCM | `src/crypto/secretBox.ts` |
| Локальный mock SFS (тот же контракт) для разработки и тестов | `mock/sfs-mock.ts` |
| 89 тестов, включая e2e против mock и проверку реальной RSA-подписи | `__tests__/` |

## Быстрый старт без Oracle и без доступа к SFS

```bash
npm install
npm run start:mock-sfs        # эмулятор SFS на 127.0.0.1:4010
```

Во втором терминале:

```bash
EFACT__ORACLE__CONNECTSTRING=memory \
EFACT__SFS__ENDPOINT=http://127.0.0.1:4010/Service.svc \
EFACT__SFS__USERNAME=supplier EFACT__SFS__PASSWORD=supplier \
npm run dev
```

Отправить фактуру:

```bash
curl -s -X POST http://127.0.0.1:8090/efactura/v1/invoices \
  -H 'Content-Type: application/json' -d @docs/example-invoice.json
curl -s -X POST http://127.0.0.1:8090/efactura/v1/tick
curl -s http://127.0.0.1:8090/efactura/v1/invoices/DOC-1001
```

## Установка у клиента

```bash
npm ci --omit=dev
npm run build
cp .env.example /etc/una-efactura/efactura.env   # заполнить
npm run validate-config
npm run migrate                                  # создаст схему сервиса
```

Дальше — systemd (`deploy/systemd/`), Windows-служба
(`deploy/windows/install-service.ps1`), Docker (`deploy/Dockerfile`) или OCI
(`deploy/oci/README.md`). Подробно — [docs/DEPLOY.md](docs/DEPLOY.md).

## Конфигурация

`config/service.config.json` — весь набор параметров; любой ключ
переопределяется переменной окружения `EFACT__СЕКЦИЯ__КЛЮЧ`. Секреты живут
только в окружении. Опечатка в имени переменной не игнорируется молча — сервис
пишет `config.env.unknown` в лог при старте.

| Ключ | Смысл |
|---|---|
| `sfs.endpoint` | `https://efactura-api.sfs.md/Service.svc` (прод) |
| `sfs.username` / `sfs.password` | **API-пользователь**, созданный директором компании в кабинете e-Factura (Настройки → Пользователи компании → «Înregistrează un utilizator API»). Это не логин директора |
| `sfs.actorRole` | 1 поставщик, 2 покупатель, 3 перевозчик |
| `oracle.*` | подключение; `memory` вместо connectString — работа без БД |
| `erp.views.*` | имена вьюшек учётной системы |
| `signing.mode` | `none` (подпись в кабинете) / `pkcs12` / `pkiserver` |
| `worker.*` | интервалы, размер пачки, порог пополнения серий |

## REST

Базовый путь `/efactura/v1`. Все методы кроме `/health` требуют
`Authorization: Bearer <service.apiToken>`.

| Метод | Назначение |
|---|---|
| `GET /health`, `GET /ready` | проба для оркестратора; `/ready` проверяет БД |
| `POST /invoices` | принять документ в очередь (идемпотентно по `externalId`) |
| `GET /invoices` | последние документы |
| `GET /invoices/{externalId}` | состояние и статус в e-Factura |
| `GET /invoices/{externalId}/pdf` | печатная форма (base64) |
| `GET /invoices/{externalId}/qr` | QR-код и ссылка на фактуру |
| `GET /invoices/{externalId}/xml` | отправленный XML, с подписями |
| `GET /taxpayers/{idno}` | данные контрагента из реестра SFS |
| `POST /tick` | прогнать очередь вручную |

Контракт целиком — [docs/API.md](docs/API.md).

## Жизненный цикл документа

```
pending -> reserved -> built -> [signed] -> posted -> confirmed
                                              |
                                              +-> canceled   (отозван/отклонён)
   любой шаг при неустранимой ошибке          -> failed
```

Каждый шаг фиксируется в БД до начала следующего: после падения сервис
продолжает с места остановки, а не отправляет фактуру повторно. Дубликат
фискальной фактуры — проблема для бухгалтерии, задержка — нет.

## Проверки

```bash
npm run check     # typecheck + валидация конфигурации + 89 тестов
```

## Что нужно уточнить до продакшена

Один момент в гайде CTIF описан неполно: **какие именно байты попадают в
`<hash>`** перед подписанием. Гайд показывает результат, но не вход. Реализация
хеширует exclusive-C14N форму `<SupplierInfo>` — единственное прочтение,
согласующееся с примерами, — и это изолировано в одной функции
`hashInput()` в `src/sign/xmldsig.ts`. Перед боем это нужно подтвердить на
тестовой среде SFS: неверный хеш `PostInvoices` примет, а проверка подписи
отклонит позже.

Остальное — endpoint, порядок полей, коды статусов, SOAPAction — взято из
живого WSDL и проверено тестами.

Подробнее об интеграции с SFS — [docs/SFS.md](docs/SFS.md).
