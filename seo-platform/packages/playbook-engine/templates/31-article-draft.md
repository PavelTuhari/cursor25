---
code: 31-article-draft
version: 1.0.0
title: Черновик статьи по кластеру
autonomy: L1
cadence: по контент-плану
defaults:
  run_mode: execute
  budget: { max_tokens: 400000, max_minutes: 45, max_external_calls: 60 }
  tools_allowed: [mcp-site, mcp-serp, mcp-gsc, mcp-lang]
  network_allowlist: [google.com, search.google.com]
  approval_required: true
  approval_stage: before_publish
  outputs: [artifacts/article-draft.md, artifacts/meta.json, report.json]
params_schema:
  cluster_name:
    type: string
    required: true
    description: Название кластера запросов
  primary_keyword:
    type: string
    required: true
    description: Главный ключ, под который пишется материал
  keywords:
    type: object[]
    required: true
    description: Ключи кластера с частотой, текущей позицией и интентом
  knowledge_pack_id:
    type: string
    required: true
    description: Идентификатор версии базы знаний по продукту
  target_locale:
    type: string
    required: true
    description: Локаль материала, например ru-MD
  words_min:
    type: number
    required: true
    description: Минимальный объём в словах
  words_max:
    type: number
    required: true
    description: Максимальный объём в словах
---

# Задача: черновик статьи по кластеру «{{params.cluster_name}}»

## 1. Контекст сайта
{{site.name}} — {{site.description}}
Целевая аудитория: {{site.audience}}.
Tone of voice: {{site.tone_of_voice}}.

Запретные утверждения:
{{#each site.banned_claims}}
- {{this}}
{{/each}}

## 2. Входные данные

### 2.1 Кластер
Главный ключ: **{{params.primary_keyword}}**. Локаль материала: {{params.target_locale}}.

| Ключ | Частота/мес | Текущая позиция | Интент |
|---|---|---|---|
{{#each params.keywords}}
| {{this.phrase}} | {{this.volume}} | {{this.position}} | {{this.intent}} |
{{/each}}

### 2.2 Факты о продукте
Источник: Knowledge Pack `{{params.knowledge_pack_id}}`.

> ЛЮБОЙ факт о продукте берётся ТОЛЬКО оттуда. Если факта нет — пометь `[TODO: уточнить у заказчика]`.
> Выдумывать цифры, кейсы, отзывы и названия клиентов запрещено.

## 3. Что нужно сделать
1. Проверить актуальную выдачу по главному ключу (`mcp-serp`) для локали {{params.target_locale}}.
2. Составить структуру, перекрывающую интент лучше ТОП-3.
3. Написать черновик объёмом {{params.words_min}}–{{params.words_max}} слов.
4. Подготовить мета-теги: title до 60 символов, description до 155.
5. Предложить разметку FAQPage из 5 вопросов People Also Ask.
6. Предложить 3 внутренние ссылки на существующие страницы, проверив их наличие через `mcp-site`.

## 4. Ограничения
- НЕ публиковать. Только черновик в `artifacts/`.
- НЕ выдумывать факты, цифры, кейсы, отзывы, имена клиентов.
- НЕ копировать текст конкурентов: уникальность не ниже 92%.
- НЕ использовать клише вида «в современном мире», «динамично развивающийся».
- Плотность ключей не выше 2.5%.
- Для румынской локали диакритика обязательна (проверка через `mcp-lang`).
- Нормативные утверждения — только со ссылкой на конкретный нормативный акт.

## 5. Критерии приёмки
- [ ] Структура покрывает все ключи кластера без переспама
- [ ] Каждое утверждение о продукте прослеживается до Knowledge Pack `{{params.knowledge_pack_id}}`
- [ ] Есть минимум два практических примера или сценария
- [ ] Title и Description в пределах лимитов и содержат главный ключ
- [ ] Указаны источники для нормативных утверждений
- [ ] Заполнен `report.json`

## 6. Формат отчёта (`report.json`)
```json
{
  "playbook_id": "31-article-draft",
  "run_id": "<uuid>",
  "status": "awaiting_approval",
  "artifacts": [{"path": "artifacts/article-draft.md", "type": "article"}],
  "metrics": {"words": 0, "uniqueness": 0.0, "keywords_covered": 0},
  "open_questions": ["..."],
  "next_actions": [{"playbook_id": "40-social-repurpose", "reason": "..."}],
  "cost": {"tokens_in": 0, "tokens_out": 0, "external_calls": 0}
}
```

## 7. Следующий шаг
После утверждения человеком платформа поставит в очередь `32-localize-ro` и `40-social-repurpose`.
