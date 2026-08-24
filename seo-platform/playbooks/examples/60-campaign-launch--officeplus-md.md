---
playbook_id: 60-campaign-launch
version: 1.0.0
site: officeplus.md
site_locale: [ru-MD, ro-MD]
generated_at: 2026-08-24T09:00:00Z
run_mode: execute
model_hint: claude-opus-5
budget: { max_tokens: 300000, max_minutes: 60, max_external_calls: 80 }
tools_allowed: [mcp-una, mcp-site, mcp-social, mcp-local-md, mcp-serp, mcp-lang]
network_allowlist: [officeplus.md, una-gw.internal, point.md, 999.md, graph.facebook.com, api.linkedin.com]
approval_required: true
approval_stage: before_publish
una:
  campaign_doc: WSEO02/2026/0041          # утверждённый документ "Акция" в UNA
  budget_article: "W6:CONTEXT+W6:TARGET"  # статьи бюджета
  tech_user: SEO_AI_BOT                   # без прав проведения и оплаты
  secret_ref: vault://una/seo-ai-bot
outputs: [artifacts/creatives/*.md, artifacts/mediaplan.json, artifacts/utm-map.csv, report.json]
---

# Задача: запуск акции «Back to Office 2026» на officeplus.md

## 1. Контекст
Акция `CAMP-2026-09-SCHOOL`, период 01.09–30.09.2026, сезонный пик закупок для офиса и школы.
Механика: скидка 15% на категории «Канцелярия», «Бумага», «Организация рабочего места»
плюс промокод `OFFICE15` для повторных клиентов.
Документ акции **уже утверждён** в UNA (см. front-matter `una.campaign_doc`).

## 2. Что нужно сделать

### Шаг 1 — Считать акцию из UNA
`PK_SEO_DOC.GET_DOC('WSEO02/2026/0041')` → получить: период, тип промо, размер скидки,
область действия (список категорий/товаров), плановый бюджет, KPI, правила акции.
**Если статус документа ≠ «Утверждён» — остановиться и сообщить.**

### Шаг 2 — Проверить бюджет
`PK_SEO_BUDGET.CHECK_LIMIT(site='officeplus.md', period='2026-09', articles=[...])`
→ получить `AVAILABLE` по каждой статье.
**Если `AVAILABLE` ≤ 0 по любой статье — не планировать по ней размещения, отметить в отчёте.**

### Шаг 3 — Сверить область действия с сайтом
Через `mcp-site` проверить: категории существуют, товары в наличии, цены актуальны.
Расхождения (товар в акции, но нет в наличии) — в `open_questions`, не выдумывать.

### Шаг 4 — Медиаплан
Составить план размещений в пределах `AVAILABLE` по каналам:
Google Ads, Facebook/Instagram, 999.md, point.md, Email, органика (контент).
Для каждой строки: канал, площадка, формат, период, единица закупки (CPC/CPM/Fix),
тариф, количество, сумма, валюта.
Тарифы сверить с прайс-листами `TPR2D_PRLIST`; отклонение > 15% — обосновать в комментарии.
Результат → `artifacts/mediaplan.json` + черновик документа **D3 «Медиаплан»** в UNA
(`PK_SEO_DOC.CREATE_DOC`, статус «Черновик», `p_ext_id` = `run_id`).

### Шаг 5 — Креативы и тексты
Под каждый канал — свой формат, RU и RO (диакритика обязательна, проверка `mcp-lang`):
объявления Google, посты FB/IG (+сторис), объявления 999.md, материал для point.md,
письмо рассылки, посадочная страница акции.
Все цены — только из `mcp-site`, все условия — только из документа акции.

### Шаг 6 — UTM-разметка
Единая схема для всех ссылок: `utm_campaign=CAMP-2026-09-SCHOOL`,
`utm_source`=канал, `utm_medium`=тип, `utm_content`=креатив.
Выгрузить `artifacts/utm-map.csv`. Без корректных UTM отчёт R3 (ROI) не сойдётся.

### Шаг 7 — В Approval Inbox
Всё подготовленное — на утверждение человеку. Ничего не публиковать.

## 3. Ограничения (финансовый контур)
- НЕ проводить документы. Только черновики со статусом «Черновик».
- НЕ изменять утверждённый документ акции и любые проведённые документы.
- НЕ создавать платёжные документы (D9) — только человек.
- НЕ трогать справочники UNA (контрагенты, план счетов) — только чтение.
- ОБЯЗАТЕЛЬНО вызвать `PK_SEO_BUDGET.CHECK_LIMIT` до планирования любого платного размещения.
- ОБЯЗАТЕЛЬНО передавать `p_ext_id` — повторный запуск не должен создавать дубли.
- При расхождении сумм > 1% между медиапланом и бюджетом — остановиться, вынести человеку.
- Секреты подключения к Oracle — только через `secret_ref`, никогда в тексте.

## 4. Ограничения (контент)
- Условия акции — дословно из документа UNA. Ничего не додумывать.
- Для конкурсной механики обязательна ссылка на правила (`LEGAL_TEXT_REF`).
- Цены и наличие — с указанием даты актуальности.
- Соблюдать лимиты частоты постинга по каналам и ToS площадок.

## 5. Критерии приёмки
- [ ] Документ акции прочитан, статус подтверждён как «Утверждён»
- [ ] Бюджет проверен, медиаплан укладывается в `AVAILABLE` по каждой статье
- [ ] Медиаплан создан в UNA как черновик D3 со ссылкой на `run_id`
- [ ] Креативы готовы для всех запланированных каналов, в RU и RO
- [ ] UTM-карта полная и консистентная
- [ ] Ни одной публикации и ни одного проведения без Approve
- [ ] Заполнен `report.json`

## 6. Формат отчёта
```json
{
  "playbook_id": "60-campaign-launch",
  "run_id": "<uuid>",
  "status": "awaiting_approval",
  "campaign": {"code": "CAMP-2026-09-SCHOOL", "una_doc": "WSEO02/2026/0041"},
  "budget": [{"article": "CONTEXT", "available": 0, "planned": 0, "currency": "MDL"}],
  "una_docs_created": [{"type": "WSEO03", "cod": 0, "status": "draft", "ext_id": "<run_id>"}],
  "creatives": [{"channel": "instagram", "locale": "ro-MD", "path": "artifacts/creatives/ig-ro.md"}],
  "open_questions": ["..."],
  "next_actions": [{"playbook_id": "61-campaign-close", "when": "2026-10-01"}],
  "cost": {"tokens_in": 0, "tokens_out": 0, "external_calls": 0}
}
```

## 7. Следующий шаг
После Approve — публикация и регистрация каждого факта через
`PK_SEO_POST.REGISTER_PUBLICATION`. 01.10.2026 автоматически запускается `61-campaign-close`.
