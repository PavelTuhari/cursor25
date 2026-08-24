---
code: 60-campaign-launch
version: 1.0.0
title: Запуск рекламной кампании или акции
autonomy: L2
cadence: по акции
defaults:
  run_mode: execute
  budget: { max_tokens: 300000, max_minutes: 60, max_external_calls: 80 }
  tools_allowed: [mcp-una, mcp-site, mcp-social, mcp-local-md, mcp-serp, mcp-lang]
  network_allowlist: [una-gw.internal, graph.facebook.com, api.linkedin.com, point.md, 999.md]
  approval_required: true
  approval_stage: before_publish
  outputs: [artifacts/creatives, artifacts/mediaplan.json, artifacts/utm-map.csv, report.json]
params_schema:
  campaign_code:
    type: string
    required: true
    description: Код кампании, он же utm_campaign и аналитика DTSTRSC в проводках UNA
  campaign_name:
    type: string
    required: true
    description: Название акции
  una_campaign_doc:
    type: string
    required: true
    description: Номер утверждённого документа «Акция» в UNA, например WSEO02/2026/0041
  period_start:
    type: string
    required: true
    description: Дата начала периода
  period_end:
    type: string
    required: true
    description: Дата окончания периода
  budget_articles:
    type: string[]
    required: true
    description: Коды статей маркетингового бюджета, из которых финансируется кампания
  channels:
    type: string[]
    required: true
    description: Каналы размещения
---

# Задача: запуск акции «{{params.campaign_name}}» на {{site.domain}}

## 1. Контекст сайта и акции
{{site.name}} — {{site.description}}
Аудитория: {{site.audience}}. Tone of voice: {{site.tone_of_voice}}.

Кампания `{{params.campaign_code}}`, период {{params.period_start}} — {{params.period_end}}.
Документ акции в UNA: **{{params.una_campaign_doc}}** (должен быть в статусе «Утверждён»).
Подразделение затрат (DIV): {{site.una_div}}.

## 2. Что нужно сделать

### Шаг 1 — Считать акцию из UNA
`PK_SEO_DOC.GET_DOC('{{params.una_campaign_doc}}')` — получить период, тип промо, размер скидки,
область действия, плановый бюджет, KPI, правила акции.
Если статус документа не «Утверждён» — остановиться и сообщить.

### Шаг 2 — Проверить бюджет
`PK_SEO_BUDGET.CHECK_LIMIT` по статьям: {{params.budget_articles}}.
Если доступный остаток по статье не положителен — не планировать по ней размещения и отметить это в отчёте.

### Шаг 3 — Сверить область действия с сайтом
Через `mcp-site` проверить, что категории и товары существуют, в наличии, цены актуальны.
Расхождения вынести в `open_questions`, не додумывать.

### Шаг 4 — Медиаплан
Составить план размещений в пределах доступного остатка по каналам: {{params.channels}}.
Для каждой строки: канал, площадка, формат, период, единица закупки, тариф, количество, сумма, валюта.
Тарифы сверить с прайс-листами `TPR2D_PRLIST`; отклонение свыше 15% обосновать.
Создать черновик документа D3 «Медиаплан» через `PK_SEO_DOC.CREATE_DOC` со статусом «Черновик».

### Шаг 5 — Креативы
Под каждый канал свой формат, для всех локалей {{site.locales}}.
Все цены только из `mcp-site`, все условия только из документа акции.

### Шаг 6 — UTM-разметка
Единая схема: `utm_campaign={{params.campaign_code}}`, `utm_source` — канал,
`utm_medium` — тип, `utm_content` — креатив. Выгрузить `artifacts/utm-map.csv`.
Без корректных UTM отчёт по ROI не сойдётся.

### Шаг 7 — В Approval Inbox
Всё подготовленное отправить на утверждение человеку. Ничего не публиковать.

## 3. Ограничения (финансовый контур)
- НЕ проводить документы. AI создаёт только черновики со статусом «Черновик».
- НЕ изменять уже утверждённые или проведённые документы.
- НЕ создавать платёжные документы (D9) — только человек.
- НЕ трогать справочники UNA (контрагенты, план счетов) — только чтение.
- ОБЯЗАТЕЛЬНО вызвать `PK_SEO_BUDGET.CHECK_LIMIT` перед любым действием, влекущим расход.
- ОБЯЗАТЕЛЬНО передавать `p_ext_id` для идемпотентности — повторный запуск не создаёт дублей.
- При расхождении сумм свыше 1% остановиться и вынести на решение человеку.
- Секреты подключения к Oracle не передаются в плейбук, только `secret_ref`.

## 4. Ограничения (контент)
- Условия акции — дословно из документа UNA, ничего не додумывать.
- Для конкурсной механики обязательна ссылка на правила.
- Цены и наличие — с указанием даты актуальности.
- Соблюдать лимиты частоты постинга и правила площадок.

## 5. Критерии приёмки
- [ ] Документ акции прочитан, статус подтверждён как «Утверждён»
- [ ] Бюджет проверен, медиаплан укладывается в доступный остаток по каждой статье
- [ ] Медиаплан создан в UNA как черновик D3 со ссылкой на `run_id`
- [ ] Креативы готовы для всех запланированных каналов и локалей
- [ ] UTM-карта полная и консистентная
- [ ] Ни одной публикации и ни одного проведения без Approve
- [ ] Заполнен `report.json`

## 6. Формат отчёта (`report.json`)
```json
{
  "playbook_id": "60-campaign-launch",
  "run_id": "<uuid>",
  "status": "awaiting_approval",
  "campaign": {"code": "{{params.campaign_code}}", "una_doc": "{{params.una_campaign_doc}}"},
  "budget": [{"article": "...", "available": 0, "planned": 0, "currency": "MDL"}],
  "una_docs_created": [{"type": "WSEO03", "cod": 0, "status": "draft", "ext_id": "<run_id>"}],
  "creatives": [{"channel": "...", "locale": "...", "path": "artifacts/creatives/..."}],
  "open_questions": ["..."],
  "next_actions": [{"playbook_id": "61-campaign-close", "when": "{{params.period_end}}"}],
  "cost": {"tokens_in": 0, "tokens_out": 0, "external_calls": 0}
}
```

## 7. Следующий шаг
После Approve — публикация и регистрация каждого факта через `PK_SEO_POST.REGISTER_PUBLICATION`.
По завершении периода запускается `61-campaign-close`.
