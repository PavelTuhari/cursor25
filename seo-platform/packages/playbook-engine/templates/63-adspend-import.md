---
code: 63-adspend-import
version: 1.0.0
title: Импорт расходов из рекламных кабинетов в UNA
autonomy: L3
cadence: ежедневно
defaults:
  run_mode: execute
  budget: { max_tokens: 120000, max_minutes: 30, max_external_calls: 120 }
  tools_allowed: [mcp-una, mcp-ads]
  network_allowlist: [una-gw.internal, googleads.googleapis.com, graph.facebook.com, api.linkedin.com]
  approval_required: false
  outputs: [artifacts/adspend.json, report.json]
params_schema:
  period_start:
    type: string
    required: true
    description: Начало импортируемого периода
  period_end:
    type: string
    required: true
    description: Конец импортируемого периода
  accounts:
    type: object[]
    required: true
    description: Рекламные кабинеты - канал, идентификатор кабинета, валюта
---

# Задача: импорт расходов на рекламу за {{params.period_start}} — {{params.period_end}}

## 1. Контекст сайта
{{site.name}} ({{site.domain}}). Подразделение затрат в UNA (DIV): {{site.una_div}}.
Расходы разносятся по каналам и кампаниям и попадают в отчёт по ROI.
Некорректный импорт искажает всю экономику продвижения — точность здесь важнее полноты.

Кабинеты:
{{#each params.accounts}}
- канал `{{this.channel}}`, кабинет `{{this.account_id}}`, валюта {{this.currency}}
{{/each}}

## 2. Что нужно сделать
1. По каждому кабинету выгрузить расход за период с разбивкой по дню и кампании:
   показы, клики, конверсии, сумма в валюте кабинета.
2. Сопоставить кампанию кабинета с кодом кампании платформы по `utm_campaign`.
   Несопоставленные строки НЕ отбрасывать — вынести в `unmatched` отчёта.
3. Получить курс НБМ на дату каждой операции и рассчитать сумму в MDL.
4. Загрузить данные через `PK_SEO_SPEND.IMPORT_ADSPEND`, передавая
   `p_ext_id` вида `<канал>:<кабинет>:<дата>:<кампания>` — это ключ идемпотентности.
5. Сверить итог загруженного с итогом кабинета. Расхождение свыше 1% — остановиться.
6. Сравнить сумму за период с полученными инвойсами провайдера, расхождения указать в отчёте.

## 3. Ограничения (финансовый контур)
- НЕ проводить документы. Загруженный расход остаётся черновиком D8 до проверки бухгалтером.
- НЕ изменять уже проведённые документы прошлых периодов.
- НЕ создавать платёжные документы (D9) — только человек.
- НЕ трогать справочники UNA (контрагенты, план счетов) — только чтение.
- ОБЯЗАТЕЛЬНО передавать `p_ext_id`: повторный запуск за тот же период не должен создавать дубли.
- ОБЯЗАТЕЛЬНО вызвать `PK_SEO_BUDGET.CHECK_LIMIT` и, при перерасходе, пометить документ `OVERBUDGET`
  и создать алерт вместо молчаливой загрузки.
- Курс валюты берётся только из справочника UNA, не из внешних источников.
- Секреты подключения не попадают в плейбук, только `secret_ref`.

## 4. Критерии приёмки
- [ ] Загружены все кабинеты за весь период
- [ ] Повторный запуск за тот же период не создал ни одной новой строки
- [ ] Итоги сошлись с кабинетами с точностью до 1%
- [ ] Все суммы пересчитаны в MDL по курсу на дату операции
- [ ] Несопоставленные кампании перечислены явно
- [ ] Заполнен `report.json`

## 5. Формат отчёта (`report.json`)
```json
{
  "playbook_id": "63-adspend-import",
  "run_id": "<uuid>",
  "status": "success",
  "period": {"from": "{{params.period_start}}", "to": "{{params.period_end}}"},
  "imported": [{"channel": "...", "account_id": "...", "rows": 0, "sum_original": 0, "currency": "USD", "sum_mdl": 0}],
  "duplicates_skipped": 0,
  "unmatched": [{"account_campaign": "...", "sum": 0, "reason": "нет utm_campaign"}],
  "overbudget": [{"article": "...", "planned": 0, "actual": 0}],
  "una_docs_created": [{"type": "WSEO08", "cod": 0, "status": "draft"}],
  "cost": {"tokens_in": 0, "tokens_out": 0, "external_calls": 0}
}
```

## 6. Следующий шаг
Бухгалтер проверяет и проводит документы D8. Ежемесячно запускается `65-contractor-review`.
