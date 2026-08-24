import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTemplateDir } from '../template.js';
import { generatePlaybook, GenerationError, suggestPath, validateParams } from '../generate.js';
import { parseFrontMatter } from '../frontmatter.js';
import { validatePlaybook } from '../validate.js';
import type { PlaybookFrontMatter } from '../types.js';
import { OFFICEPLUS, UNA_MD } from './fixtures.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../templates');
const templates = loadTemplateDir(TEMPLATES_DIR);
const GENERATED_AT = '2026-09-01T08:00:00.000Z';

const ARTICLE_PARAMS = {
  cluster_name: 'программа для бухгалтерии НКО',
  primary_keyword: 'программа бухгалтерия НКО Молдова',
  keywords: [
    { phrase: 'программа бухгалтерия НКО Молдова', volume: 320, position: 18, intent: 'commercial' },
    { phrase: 'contabilitate ONG program', volume: 210, position: '—', intent: 'commercial' },
  ],
  knowledge_pack_id: 'kp-una-v7',
  target_locale: 'ru-MD',
  words_min: 1800,
  words_max: 2500,
};

describe('загрузка библиотеки шаблонов', () => {
  it('находит шаблоны и раскладывает по фазам', () => {
    expect(templates.size).toBeGreaterThanOrEqual(4);
    expect(templates.get('00-onboarding-audit')?.phase).toBe(0);
    expect(templates.get('60-campaign-launch')?.phase).toBe(6);
  });

  it('каждый шаблон имеет SemVer-версию и непустое тело', () => {
    for (const [code, tpl] of templates) {
      expect(tpl.version, code).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tpl.body.trim().length, code).toBeGreaterThan(200);
    }
  });
});

describe('validateParams', () => {
  const schema = templates.get('31-article-draft')!.params_schema;

  it('пропускает корректный набор', () => {
    expect(validateParams(schema, ARTICLE_PARAMS)).toEqual([]);
  });

  it('ловит отсутствующий обязательный параметр', () => {
    const { knowledge_pack_id, ...rest } = ARTICLE_PARAMS;
    expect(validateParams(schema, rest).join()).toMatch(/knowledge_pack_id/);
  });

  it('ловит неверный тип', () => {
    expect(validateParams(schema, { ...ARTICLE_PARAMS, words_min: '1800' }).join()).toMatch(/words_min/);
  });
});

describe('generatePlaybook', () => {
  it('собирает валидный плейбук из шаблона статьи', () => {
    const result = generatePlaybook(
      templates.get('31-article-draft')!,
      { site: UNA_MD, params: ARTICLE_PARAMS, generated_at: GENERATED_AT },
      { run_id: 'r-001' },
    );
    expect(result.front_matter.site).toBe('una.md');
    expect(result.front_matter.approval_required).toBe(true);
    expect(result.body).toContain('программа бухгалтерия НКО Молдова');
    expect(result.body).toContain('kp-una-v7');
    expect(result.suggested_path).toBe('playbooks/una.md/2026-09/31-article-draft--r-001.md');
    expect(validatePlaybook(result.content).ok).toBe(true);
  });

  it('добавляет домен сайта в network_allowlist', () => {
    const result = generatePlaybook(
      templates.get('31-article-draft')!,
      { site: UNA_MD, params: ARTICLE_PARAMS, generated_at: GENERATED_AT },
    );
    expect(result.front_matter.network_allowlist).toContain('una.md');
  });

  it('не дублирует домен, если он уже в списке шаблона', () => {
    const result = generatePlaybook(
      templates.get('60-campaign-launch')!,
      {
        site: { ...OFFICEPLUS, domain: 'point.md' },
        params: CAMPAIGN_PARAMS,
        generated_at: GENERATED_AT,
        una: { tech_user: 'SEO_AI_BOT', secret_ref: 'vault://una/seo-ai-bot' },
      },
    );
    const occurrences = result.front_matter.network_allowlist.filter((d) => d === 'point.md');
    expect(occurrences).toHaveLength(1);
  });

  it('отклоняет генерацию при отсутствии обязательного параметра', () => {
    expect(() =>
      generatePlaybook(
        templates.get('31-article-draft')!,
        { site: UNA_MD, params: { cluster_name: 'x' }, generated_at: GENERATED_AT },
      ),
    ).toThrow(GenerationError);
  });

  it('переопределяет бюджет из контекста, не теряя остальные лимиты', () => {
    const result = generatePlaybook(
      templates.get('31-article-draft')!,
      { site: UNA_MD, params: ARTICLE_PARAMS, generated_at: GENERATED_AT, budget: { max_tokens: 50_000 } },
    );
    expect(result.front_matter.budget.max_tokens).toBe(50_000);
    expect(result.front_matter.budget.max_minutes).toBe(45);
  });

  it('генерация детерминирована при одинаковом входе', () => {
    const ctx = { site: UNA_MD, params: ARTICLE_PARAMS, generated_at: GENERATED_AT };
    const a = generatePlaybook(templates.get('31-article-draft')!, ctx, { run_id: 'r-1' });
    const b = generatePlaybook(templates.get('31-article-draft')!, ctx, { run_id: 'r-1' });
    expect(a.content).toBe(b.content);
  });

  it('front-matter переживает round-trip через YAML без потерь', () => {
    const result = generatePlaybook(
      templates.get('00-onboarding-audit')!,
      {
        site: UNA_MD,
        params: { base_queries: ['программа бухгалтерия молдова', 'contabilitate ONG'], max_urls: 5000 },
        generated_at: GENERATED_AT,
      },
    );
    const parsed = parseFrontMatter<PlaybookFrontMatter>(result.content).data;
    expect(parsed.budget).toEqual(result.front_matter.budget);
    expect(parsed.site_locale).toEqual(['ru-MD', 'ro-MD']);
    expect(parsed.run_mode).toBe('dry-run');
  });
});

const CAMPAIGN_PARAMS = {
  campaign_code: 'CAMP-2026-09-SCHOOL',
  campaign_name: 'Back to Office 2026',
  una_campaign_doc: 'WSEO02/2026/0041',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  budget_articles: ['CONTEXT', 'TARGET'],
  channels: ['google-ads', 'facebook', '999.md'],
};

describe('плейбуки финансового контура', () => {
  it('кампания собирается и проходит финансовую валидацию', () => {
    const result = generatePlaybook(
      templates.get('60-campaign-launch')!,
      {
        site: OFFICEPLUS,
        params: CAMPAIGN_PARAMS,
        generated_at: GENERATED_AT,
        una: {
          campaign_doc: 'WSEO02/2026/0041',
          budget_article: 'CONTEXT',
          tech_user: 'SEO_AI_BOT',
          secret_ref: 'vault://una/seo-ai-bot',
        },
      },
      { run_id: 'r-042' },
    );
    const verdict = validatePlaybook(result.content);
    expect(verdict.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.body).toContain('CAMP-2026-09-SCHOOL');
    expect(result.front_matter.una?.tech_user).toBe('SEO_AI_BOT');
  });

  it('импорт расходов не требует Approve, но остаётся черновиком в UNA', () => {
    const result = generatePlaybook(templates.get('63-adspend-import')!, {
      site: OFFICEPLUS,
      generated_at: GENERATED_AT,
      params: {
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        accounts: [{ channel: 'google-ads', account_id: '123-456', currency: 'USD' }],
      },
      una: { tech_user: 'SEO_AI_BOT', secret_ref: 'vault://una/seo-ai-bot' },
    });
    expect(result.front_matter.approval_required).toBe(false);
    expect(result.body).toContain('остаётся черновиком D8');
    expect(validatePlaybook(result.content).ok).toBe(true);
  });
});

describe('suggestPath', () => {
  it('раскладывает по сайту и месяцу генерации', () => {
    expect(suggestPath('una.md', '10-keyword-harvest', '2026-12-31T23:59:59Z', 'abc')).toBe(
      'playbooks/una.md/2026-12/10-keyword-harvest--abc.md',
    );
  });
});
