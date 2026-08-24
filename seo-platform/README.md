# SEO AI Platform — документация

| Файл | Назначение |
|---|---|
| [`TZ-SEO-AI-Platform.md`](./TZ-SEO-AI-Platform.md) | **ТЗ, часть I** — web-платформа AI-SEO продвижения |
| [`TZ-Documentooborot-UNA.md`](./TZ-Documentooborot-UNA.md) | **ТЗ, часть II** — документооборот и учёт маркетинга на базе UNA.md (Oracle) |
| [`playbooks/examples/`](./playbooks/examples/) | Примеры сгенерированных `.md`-плейбуков для AI-сессий |

## Кратко

Платформа управляет SEO-продвижением произвольного числа собственных сайтов
(пилот: `una.md`, `unisim-soft`, `officeplus.md`). Вся исполнительная работа
делается автономными AI-сессиями, которые получают на вход детерминированные
Markdown-плейбуки, сгенерированные платформой. Весь финансовый и юридически
значимый документооборот (акции, бюджеты, договоры, акты, счета, платежи,
публикации) ведётся в учётной системе **UNA.md** — через интеграцию и/или ручной ввод.

```
Site Profile + данные + шаблон  →  Playbook (.md)  →  AI-сессия  →  Артефакты
                                        ↑                              ↓
                                    Git-история              Approval → Публикация
                                                                       ↓
                                              UNA.md (документы, проводки, бюджет)
                                                                       ↓
                                                              Метрики + ROI → Дашборд
```

## Что уже реализовано

| Компонент | Путь | Состояние |
|---|---|---|
| Движок плейбуков | `packages/playbook-engine` | Рендер, генерация, валидация, 4 шаблона. 39 тестов |
| API платформы | `apps/api` | Сайты, шаблоны, генерация, запуски, Approval Inbox, шлюз UNA. 31 тест |
| Схема Postgres | `db/postgres/migrations` | 3 миграции, проверены прогоном на живом движке |
| Контур UNA (Oracle) | `db/oracle` | Таблицы `YSEO_*`, вьюшки `VSEO_*`, пакеты `PK_SEO_*`, роли |
| ТЗ | `TZ-*.md` | Части I и II |

Не реализовано: web-панель, планировщик и раннеры AI-сессий, коннекторы к
рекламным кабинетам и соцсетям, генерация проводок через `UN$GFC`
(ждёт сверки интерфейса с командой UNA — см. `db/oracle/README.md`).

## Запуск

```bash
npm install
npm run build          # движок собирается до старта API
npm test               # 70 тестов: движок + API на настоящем Postgres в WASM

# API
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, UNA_MODE
psql "$DATABASE_URL" -f db/postgres/migrations/001_core.sql   # и далее по порядку
npm run api:dev
```

`UNA_MODE=mock` поднимает шлюз-заглушку, повторяющий инварианты пакетов
`PK_SEO_*`: AI не согласует, автор не согласует сам себя, повтор по `ext_id`
не создаёт дубль, сумма документа от AI ограничена. Для продакшна нужен
`UNA_MODE=oracle` и установленный `oracledb`.

Источник структуры БД UNA:
<https://bsoft.gitbook.io/wiki/razrabotka/obekty-oracle/struktura-bazy-dannykh>
