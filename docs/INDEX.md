# Документация UNA.md — полная карта

Точка входа во всю документацию репозитория. Каждый документ отвечает на один
вопрос; если вы не знаете, с чего начать — начните с
[«Что и зачем»](#что-и-зачем) ниже.

---

## Что и зачем

Репозиторий содержит две самостоятельные системы и общий слой документации:

| Система | Что делает | Где живёт |
|---|---|---|
| **UNA Market** | мобильное приложение сети (iOS + Android): каталог, акции, лояльность, список покупок, личный кабинет, **корпоративный кабинет** | [`mobile/`](../mobile/) |
| **una-efactura** | автономный микросервис интеграции с SIA «e-Factura» Государственной налоговой службы Молдовы | [`efactura-service/`](../efactura-service/) |

Они связаны одним сценарием: корпоративный покупатель просит фискальную фактуру
в приложении → UNA.md передаёт документ в микросервис → микросервис
формирует, подписывает и отправляет её в SFS → статус возвращается покупателю.
Полностью этот путь описан в [CORPORATE.md](CORPORATE.md).

---

## Обзорные документы

| Документ | О чём |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | как устроена система целиком, границы компонентов, потоки данных |
| [CORPORATE.md](CORPORATE.md) | корпоративная опция от кнопки в приложении до фактуры в SFS |
| [DEVELOPMENT.md](DEVELOPMENT.md) | поднять весь стек локально за пять команд, без Oracle и без доступа к SFS |
| [OPERATIONS.md](OPERATIONS.md) | эксплуатация: что мониторить, как разбирать инциденты |
| [SECURITY.md](SECURITY.md) | секреты, сертификаты, персональные данные, границы доверия |
| [TESTING.md](TESTING.md) | что покрыто тестами, чем проверяется каждый слой |
| [GLOSSARY.md](GLOSSARY.md) | IDNO, TVA, ETI, SFS, CTIF, STISC, MPass и остальные сокращения |
| [ROADMAP.md](ROADMAP.md) | что не сделано, открытые вопросы, порядок работ |

## Следующий этап: кошелёк и входящие НН

| Документ | О чём |
|---|---|
| [TZ-WALLET.md](TZ-WALLET.md) | **полное ТЗ** на универсальное приложение: все НН от всех поставщиков в одном кабинете, кошелёк документов и платежей |
| [TZ-DORABOTKI.md](TZ-DORABOTKI.md) | **ТЗ на доработки** существующего кода: что именно менять в микросервисе и в приложении |
| [TEST-E2E-OFFICEPLUS.md](TEST-E2E-OFFICEPLUS.md) | **сценарий тестирования** полного цикла: officeplus.md → НН → кошелёк → SFS |

---

## Мобильное приложение

| Документ | О чём |
|---|---|
| [mobile/README.md](../mobile/README.md) | обзор, стек, быстрый старт, что меняется без релиза |
| [mobile/docs/architecture.md](../mobile/docs/architecture.md) | внутреннее устройство: конфигурация, SQLite, синхронизация, UI |
| [mobile/docs/configuration.md](../mobile/docs/configuration.md) | справочник по всем `config/*.json` |
| [mobile/docs/api-contract.md](../mobile/docs/api-contract.md) | контракт бэкенда UNA.md, включая корпоративные эндпоинты |

**Ключевые файлы конфигурации** (меняются без релиза в сторах):

* [`config/app.config.json`](../mobile/config/app.config.json) — бренд, API, фич-флаги, секция `corporate`
* [`config/entities.config.json`](../mobile/config/entities.config.json) — модель данных = схема SQLite + правила синхронизации
* [`config/navigation.config.json`](../mobile/config/navigation.config.json) — вкладки
* [`config/screens/`](../mobile/config/screens/) — экраны как списки блоков
* [`config/theme.config.json`](../mobile/config/theme.config.json) — светлая и тёмная темы
* [`config/l10n/`](../mobile/config/l10n/) — переводы `ro` / `ru` / `en`

---

## Микросервис e-Factura

| Документ | О чём |
|---|---|
| [efactura-service/README.md](../efactura-service/README.md) | обзор, три архитектурных решения, быстрый старт |
| [efactura-service/docs/SFS.md](../efactura-service/docs/SFS.md) | **что установлено о контракте SFS**: транспорт, операции, коды, подпись, источники |
| [efactura-service/docs/API.md](../efactura-service/docs/API.md) | REST-контракт сервиса для UNA.md |
| [efactura-service/docs/DEPLOY.md](../efactura-service/docs/DEPLOY.md) | установка: Ubuntu, Windows, Docker, OCI |
| [efactura-service/deploy/oci/README.md](../efactura-service/deploy/oci/README.md) | Container Instances, Autonomous Database, OKE, список egress |

**Ключевые файлы:**

* [`config/service.config.json`](../efactura-service/config/service.config.json) — вся конфигурация
* [`.env.example`](../efactura-service/.env.example) — переменные окружения и секреты
* [`sql/001_schema.sql`](../efactura-service/sql/001_schema.sql) — схема сервиса
* [`sql/002_erp_views.sql`](../efactura-service/sql/002_erp_views.sql) — **контракт с учётной системой**
* [`docs/example-invoice.json`](../efactura-service/docs/example-invoice.json) — пример документа

---

## Материалы по учётной системе UNA

Существовали в репозитории до этой работы и относятся к платформе в целом:

| Документ | О чём |
|---|---|
| [catalog-procese-business.md](../catalog-procese-business.md) | каталог бизнес-процессов |
| [UNA-ONG-OnPremises-Migration-Guide.md](../UNA-ONG-OnPremises-Migration-Guide.md) | миграция on-premises |
| [modul-contabilitate-ong-una-oracle.html](../modul-contabilitate-ong-una-oracle.html) | модуль бухгалтерии на Oracle |

---

## Внешние источники

| Ссылка | Что там |
|---|---|
| [efactura.sfs.md](https://efactura.sfs.md/) | кабинет SIA «e-Factura» |
| [servicii.fisc.md](https://servicii.fisc.md/) | портал электронных фискальных услуг |
| [Ghid de integrare Complet Automatizat (PDF)](https://ctif.gov.md/sites/default/files/inline-files/Ghid%20integrare%20Complet-Automatizat.pdf) | руководство CTIF по API, 44 страницы |
| [Ghid de integrare Semi Automatizat (PDF)](https://efactura.sfs.md/Help/Ghid_integrare_Semi_Automatizata.pdf) | полуавтоматический режим |
| [CTIF об интеграции учётных систем](https://www.ctif.gov.md/ro/integrarea-sistemelor-de-contabilitate-ale-agentilor-economici-cu-noua-versiune-sistemului-e) | два режима интеграции, PKI-Server |
| `https://efactura-api.sfs.md/Service.svc?singleWsdl` | **живой WSDL продакшена**, доступен без авторизации |

Телефоны поддержки: CTIF — **022 822222**, STISC (PKI-Server) — **022 820911**.

---

## Быстрые ответы

**Как поднять всё локально?** → [DEVELOPMENT.md](DEVELOPMENT.md)

**Как добавить поле товара?** → одна запись в
[`entities.config.json`](../mobile/config/entities.config.json), миграция
выполнится сама. См. [configuration.md](../mobile/docs/configuration.md).

**Какие операции SFS доступны?** → таблица из 19 операций в
[SFS.md](../efactura-service/docs/SFS.md#операции).

**Что означает статус фактуры 7?** → «отправлена покупателю»; полная таблица в
[SFS.md](../efactura-service/docs/SFS.md#коды).

**Что нужно подтвердить до продакшена?** → один открытый вопрос по хешированию
перед подписью, см. [ROADMAP.md](ROADMAP.md#открытые-вопросы).

**Куда идут секреты?** → [SECURITY.md](SECURITY.md).
