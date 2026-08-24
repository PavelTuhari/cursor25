---
code: 00-onboarding-audit
version: 1.0.0
title: Стартовый аудит сайта
autonomy: L0
cadence: один раз при подключении сайта
defaults:
  run_mode: dry-run
  budget: { max_tokens: 600000, max_minutes: 90, max_external_calls: 200 }
  tools_allowed: [mcp-crawler, mcp-serp, mcp-gsc, mcp-ga4, mcp-backlinks, mcp-site]
  network_allowlist: [google.com, search.google.com]
  approval_required: false
  outputs: [artifacts/audit-tech.md, artifacts/audit-content.md, artifacts/audit-links.md, artifacts/competitors.json, report.json]
params_schema:
  base_queries:
    type: string[]
    required: true
    description: Базовые запросы для съёма выдачи и поиска конкурентов
  max_urls:
    type: number
    required: false
    description: Лимит URL при краулe (по умолчанию 5000)
---

# Задача: стартовый аудит {{site.domain}}

## 1. Контекст сайта
{{site.name}} — {{site.description}}
Ниша: {{site.niche}}. Гео: {{site.geo}}. Языки: {{site.locales}}.
Аудитория: {{site.audience}}.

Это **первый** запуск по сайту — базовая точка отсчёта для всех дальнейших плейбуков.

## 2. Что нужно сделать

### 2.1 Технический аудит (`mcp-crawler`)
1. Полный краул сайта{{#if params.max_urls}} (до {{params.max_urls}} URL){{/if}}: коды ответа, редиректы, canonical, title/description, H1, глубина вложенности, orphan-страницы.
2. Проверить `robots.txt`, `sitemap.xml`, наличие `llms.txt`.
3. Core Web Vitals: полевые (CrUX) и лабораторные (Lighthouse) для 10 ключевых шаблонов страниц.
4. Валидировать структурированные данные.
5. Проверить hreflang между языковыми версиями ({{site.locales}}), найти отсутствующие зеркала.

### 2.2 Индексация и запросы (`mcp-gsc`, `mcp-ga4`)
1. Выгрузить запросы за 16 месяцев: показы, клики, CTR, средняя позиция.
2. Найти страницы с высокими показами и CTR ниже медианы.
3. Найти запросы на позициях 11–20.
4. Сверить количество страниц в sitemap и в индексе, перечислить причины исключения.
5. GA4: органические сессии, конверсии, топ-страницы входа.

### 2.3 Контентный аудит
1. Инвентаризация контентных страниц: тема, интент, объём, дата обновления, целевой ключ.
2. Найти каннибализацию.
3. Найти устаревшее (не обновлялось более 18 месяцев и теряет трафик).
4. Оценить E-E-A-T: авторы, экспертиза, источники, страницы About/Контакты/реквизиты.

### 2.4 Конкурентный анализ (`mcp-serp`)
Снять ТОП-10 по базовым запросам для каждого языка и типа устройства:
{{#each params.base_queries}}
- {{this}}
{{/each}}

Известные конкуренты для сверки: {{site.competitors}}.
Отметить наличие AI Overviews и кто в них цитируется. Собрать People Also Ask.

### 2.5 Ссылочный профиль (`mcp-backlinks`)
Ссылающиеся домены и динамика за 12 месяцев, анкор-лист, разрыв с конкурентами,
потенциально токсичные ссылки, незалинкованные упоминания бренда.

## 3. Ограничения
- Режим `dry-run`: никаких изменений на сайте и внешних площадках, только чтение.
- Краул не чаще 2 запросов в секунду, уважать `robots.txt`.
- Не делать выводов о продукте, не подтверждённых содержимым сайта.
- Не оценивать сложность продвижения голословно — только с указанием источника данных.

## 4. Критерии приёмки
- [ ] Покрыты все пять блоков аудита
- [ ] Каждая проблема имеет описание, затронутые URL, severity, решение и оценку трудоёмкости
- [ ] Проблемы отсортированы по отношению «влияние / трудоёмкость»
- [ ] Конкуренты выгружены в `competitors.json`
- [ ] Сформирован список из 10 быстрых побед на ближайшие 30 дней
- [ ] Заполнен `report.json`

## 5. Формат отчёта (`report.json`)
```json
{
  "playbook_id": "00-onboarding-audit",
  "run_id": "<uuid>",
  "status": "success",
  "baseline": {
    "indexed_pages": 0, "organic_sessions_30d": 0,
    "referring_domains": 0, "keywords_top10": 0, "cwv_good_share": 0.0
  },
  "issues": [
    {"id": "T-001", "area": "tech", "severity": "critical", "title": "...", "urls": ["..."], "fix": "...", "effort": "S"}
  ],
  "quick_wins": [{"title": "...", "expected_impact": "...", "playbook_id": "..."}],
  "next_actions": [{"playbook_id": "10-keyword-harvest", "reason": "..."}],
  "cost": {"tokens_in": 0, "tokens_out": 0, "external_calls": 0}
}
```

## 6. Следующий шаг
Платформа поставит в очередь `01-knowledge-extraction`, `02-competitor-map`, `10-keyword-harvest`.
