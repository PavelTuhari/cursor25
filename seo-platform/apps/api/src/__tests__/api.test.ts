import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { ARTICLE_PARAMS, UNA_SITE, createTestApp } from './helpers.js';

let app: FastifyInstance;
let db: Db;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
});

afterEach(async () => {
  await app.close();
  await db.close();
});

async function createSite() {
  const res = await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE });
  return res.json() as { id: string };
}

async function generateArticle(siteId: string) {
  return app.inject({
    method: 'POST',
    url: '/playbooks/generate',
    payload: { site_id: siteId, template_code: '31-article-draft', params: ARTICLE_PARAMS },
  });
}

describe('здоровье и справочники', () => {
  it('health отвечает и видит библиотеку шаблонов', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toBeGreaterThanOrEqual(4);
  });

  it('список шаблонов отдаёт фазу, автономию и параметры', async () => {
    const items = (await app.inject({ method: 'GET', url: '/templates' })).json().items;
    const campaign = items.find((t: { code: string }) => t.code === '60-campaign-launch');
    expect(campaign.phase).toBe(6);
    expect(campaign.autonomy).toBe('L2');
    expect(campaign.params.map((p: { name: string }) => p.name)).toContain('campaign_code');
  });
});

describe('сайты', () => {
  it('создаёт сайт и возвращает его в списке', async () => {
    const created = await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE });
    expect(created.statusCode).toBe(201);
    const list = (await app.inject({ method: 'GET', url: '/sites' })).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].locales).toEqual(['ru-MD', 'ro-MD']);
  });

  it('не заводит один домен дважды', async () => {
    await createSite();
    const second = await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE });
    expect(second.statusCode).toBe(409);
  });

  it('отклоняет сайт без локалей', async () => {
    const res = await app.inject({ method: 'POST', url: '/sites', payload: { ...UNA_SITE, locales: [] } });
    expect(res.statusCode).toBe(400);
  });
});

describe('генерация плейбуков', () => {
  it('генерирует, валидирует и сохраняет плейбук', async () => {
    const site = await createSite();
    const res = await generateArticle(site.id);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.file_path).toBe('playbooks/una.md/2026-09/31-article-draft--draft.md');
    expect(body.content).toContain('kp-una-v7');
    expect(body.front_matter.approval_required).toBe(true);

    const stored = await db.query<{ content: string }>(`SELECT content FROM playbooks`);
    expect(stored.rows).toHaveLength(1);
  });

  it('отклоняет генерацию с неполными параметрами и ничего не сохраняет', async () => {
    const site = await createSite();
    const res = await app.inject({
      method: 'POST',
      url: '/playbooks/generate',
      payload: { site_id: site.id, template_code: '31-article-draft', params: { cluster_name: 'x' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/primary_keyword|knowledge_pack_id/);
    const stored = await db.query(`SELECT id FROM playbooks`);
    expect(stored.rows).toHaveLength(0);
  });

  it('не даёт сгенерировать плейбук фазы 6 без привязки к UNA', async () => {
    const site = await createSite();
    const res = await app.inject({
      method: 'POST',
      url: '/playbooks/generate',
      payload: {
        site_id: site.id,
        template_code: '60-campaign-launch',
        params: {
          campaign_code: 'CAMP-2026-09-SCHOOL', campaign_name: 'Back to Office',
          una_campaign_doc: 'WSEO02/2026/0041', period_start: '2026-09-01', period_end: '2026-09-30',
          budget_articles: ['CONTEXT'], channels: ['google-ads'],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/учётному контуру/);
  });

  it('отклоняет секрет вместо ссылки на Vault', async () => {
    const site = await createSite();
    const res = await app.inject({
      method: 'POST',
      url: '/playbooks/generate',
      payload: {
        site_id: site.id, template_code: '31-article-draft', params: ARTICLE_PARAMS,
        una: { tech_user: 'SEO_AI_BOT', secret_ref: 'Passw0rd' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('валидатор доступен отдельным маршрутом', async () => {
    const res = await app.inject({
      method: 'POST', url: '/playbooks/validate', payload: { content: '# без front-matter' },
    });
    expect(res.json().ok).toBe(false);
    expect(res.json().issues[0].code).toBe('FM_PARSE');
  });
});

describe('запуски и артефакты', () => {
  async function startRun() {
    const site = await createSite();
    const playbook = (await generateArticle(site.id)).json();
    const run = await app.inject({ method: 'POST', url: '/runs', payload: { playbook_id: playbook.id } });
    return run.json() as { id: string };
  }

  it('запускает сессию и принимает отчёт с артефактами', async () => {
    const run = await startRun();
    const res = await app.inject({
      method: 'POST',
      url: `/runs/${run.id}/report`,
      payload: {
        status: 'awaiting_approval',
        report: { metrics: { words: 2100 } },
        cost: { tokens_in: 120_000, tokens_out: 8_000, external_calls: 12, amount: 1.42, currency: 'USD' },
        artifacts: [{ type: 'article', path: 'artifacts/article-draft.md' }],
      },
    });
    expect(res.statusCode).toBe(200);

    const detail = (await app.inject({ method: 'GET', url: `/runs/${run.id}` })).json();
    expect(detail.status).toBe('awaiting_approval');
    expect(detail.artifacts).toHaveLength(1);
    expect(Number(detail.cost_amount)).toBeCloseTo(1.42);
  });

  it('не принимает второй отчёт по тому же запуску', async () => {
    const run = await startRun();
    const payload = { status: 'success', report: {}, artifacts: [] };
    await app.inject({ method: 'POST', url: `/runs/${run.id}/report`, payload });
    const second = await app.inject({ method: 'POST', url: `/runs/${run.id}/report`, payload });
    expect(second.statusCode).toBe(409);
  });
});

describe('очередь утверждения', () => {
  async function pendingArtifact() {
    const site = await createSite();
    const playbook = (await generateArticle(site.id)).json();
    const run = (await app.inject({ method: 'POST', url: '/runs', payload: { playbook_id: playbook.id } })).json();
    await app.inject({
      method: 'POST',
      url: `/runs/${run.id}/report`,
      payload: {
        status: 'awaiting_approval', report: {},
        artifacts: [{ type: 'article', path: 'artifacts/article-draft.md' }],
      },
    });
    const queue = (await app.inject({ method: 'GET', url: '/approvals' })).json();
    return queue.items[0] as { id: string };
  }

  it('показывает неутверждённые артефакты', async () => {
    const artifact = await pendingArtifact();
    expect(artifact.id).toBeTruthy();
  });

  it('человек утверждает артефакт', async () => {
    const artifact = await pendingArtifact();
    const res = await app.inject({
      method: 'POST', url: `/artifacts/${artifact.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    const queue = (await app.inject({ method: 'GET', url: '/approvals' })).json();
    expect(queue.items).toHaveLength(0);
  });

  it('AI-сессия утвердить не может', async () => {
    const artifact = await pendingArtifact();
    const res = await app.inject({
      method: 'POST', url: `/artifacts/${artifact.id}/approve`,
      payload: { actor: 'SEO_AI_BOT', decision: 'approve' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/AI-сессия/);
  });

  it('отклонение требует причины', async () => {
    const artifact = await pendingArtifact();
    const res = await app.inject({
      method: 'POST', url: `/artifacts/${artifact.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'reject' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('повторное утверждение отклоняется', async () => {
    const artifact = await pendingArtifact();
    const payload = { actor: 'p.tuhari', decision: 'approve' };
    await app.inject({ method: 'POST', url: `/artifacts/${artifact.id}/approve`, payload });
    const second = await app.inject({ method: 'POST', url: `/artifacts/${artifact.id}/approve`, payload });
    expect(second.statusCode).toBe(409);
  });
});
