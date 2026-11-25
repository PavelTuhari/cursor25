# UNA.md — мобильное приложение и интеграция с e-Factura

Две самостоятельные системы для розничной платформы UNA.md.

| | Что это | Документация |
|---|---|---|
| [`mobile/`](mobile/) | **UNA Market** — кросс-платформенное приложение сети (iOS + Android): каталог, акции, лояльность, список покупок, личный кабинет и корпоративный кабинет | [README](mobile/README.md) |
| [`efactura-service/`](efactura-service/) | **una-efactura** — автономный микросервис интеграции с SIA «e-Factura» Государственной налоговой службы Молдовы | [README](efactura-service/README.md) |

**→ [Полная карта документации](docs/INDEX.md)** · **→ [Documentația în română](docs/ro/README.md)**

---

## Быстрый старт

Весь стек поднимается без Oracle, без доступа к SFS и без сертификатов —
эмуляторы реализуют те же контракты, что и настоящие системы.

```bash
cd efactura-service && npm install && npm run start:mock-sfs
```

```bash
cd mobile && npm install && npm run start:mock && npm start
```

Подробно — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Проверки

```bash
cd mobile           && npm run check   # typecheck + валидация конфигурации + 208 тестов
cd efactura-service && npm run check   # typecheck + валидация конфигурации +  89 тестов
```

## Что стоит прочитать первым

| Вопрос | Документ |
|---|---|
| Как всё устроено | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Как работает корпоративная фактура, от кнопки до SFS | [docs/CORPORATE.md](docs/CORPORATE.md) |
| Что известно о контракте SFS и откуда | [efactura-service/docs/SFS.md](efactura-service/docs/SFS.md) |
| Что не сделано и что блокирует продакшен | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Состояние

Обе системы собираются, проходят типизацию и тесты. Работа с настоящей SIA
«e-Factura» **не проверялась**: доступа к тестовой среде нет, а один вопрос по
модели подписи остаётся открытым — см.
[ROADMAP](docs/ROADMAP.md#1-что-именно-хешируется-перед-подписью).

Контракт API взят не из догадок: **живой WSDL продакшена**
`https://efactura-api.sfs.md/Service.svc?singleWsdl` доступен без авторизации, и
транспорт, 19 операций, порядок элементов DataContract и коды статусов сверены
по нему.

---

## Прочие материалы

Относятся к платформе UNA в целом и существовали до этой работы:

* [catalog-procese-business.md](catalog-procese-business.md) — каталог бизнес-процессов
* [UNA-ONG-OnPremises-Migration-Guide.md](UNA-ONG-OnPremises-Migration-Guide.md) — миграция on-premises
* [modul-contabilitate-ong-una-oracle.html](modul-contabilitate-ong-una-oracle.html) — модуль бухгалтерии на Oracle
