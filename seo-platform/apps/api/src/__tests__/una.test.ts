import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { UNA_SITE, createTestApp } from './helpers.js';

let app: FastifyInstance;
let db: Db;

const BUDGETS = [
  { div: 'UNA', period: '2026-09', article: 'CONTEXT', plan: 30_000, actual: 12_000, committed: 5_000 },
  { div: 'UNA', period: '2026-09', article: 'CONTENT', plan: 10_000, actual: 9_900 },
];

beforeEach(async () => {
  ({ app, db } = await createTestApp({ budgets: BUDGETS, aiMaxDocAmount: 10_000 }));
});

afterEach(async () => {
  await app.close();
  await db.close();
});

const check = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/una/budget/check', payload });

const createDoc = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/una/documents', payload });

/**
 * Документ, созданный AI-сессией, ссылается на реальный запуск: в una_documents
 * стоит внешний ключ на task_runs, и это правильно — иначе прослеживаемость
 * «плейбук → запуск → документ» держалась бы на честном слове.
 */
async function realRunId(): Promise<string> {
  const site = (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
  const playbook = (
    await app.inject({
      method: 'POST',
      url: '/playbooks/generate',
      payload: {
        site_id: site.id,
        template_code: '31-article-draft',
        params: {
          cluster_name: 'тест', primary_keyword: 'тест',
          keywords: [{ phrase: 'тест', volume: 10, position: 5, intent: 'commercial' }],
          knowledge_pack_id: 'kp-1', target_locale: 'ru-MD', words_min: 100, words_max: 200,
        },
      },
    })
  ).json();
  const run = await app.inject({ method: 'POST', url: '/runs', payload: { playbook_id: playbook.id } });
  return run.json().id as string;
}

const BASE_DOC = {
  ext_system: 'seoplatform',
  ext_id: 'run-42:mediaplan',
  sysfid: 'WSEO03',
  doc_date: '2026-09-01',
  div: 'UNA',
  campaign_code: 'CAMP-2026-09-SCHOOL',
};

describe('контроль бюджета', () => {
  it('разрешает расход в пределах остатка', async () => {
    const res = await check({ div: 'UNA', period: '2026-09', article: 'CONTEXT', amount: 5_000 });
    const body = res.json();
    expect(body.is_allowed).toBe(true);
    expect(body.available).toBe(13_000);
  });

  it('блокирует расход сверх остатка и объясняет причину', async () => {
    const body = (await check({ div: 'UNA', period: '2026-09', article: 'CONTEXT', amount: 20_000 })).json();
    expect(body.is_allowed).toBe(false);
    expect(body.reason).toMatch(/Превышение бюджета/);
  });

  it('блокирует расход по статье без утверждённого бюджета', async () => {
    const body = (await check({ div: 'UNA', period: '2026-09', article: 'PR', amount: 100 })).json();
    expect(body.is_allowed).toBe(false);
    expect(body.reason).toMatch(/не утверждён/);
  });

  it('считает процент освоения для алерта на 80%', async () => {
    const body = (await check({ div: 'UNA', period: '2026-09', article: 'CONTENT', amount: 50 })).json();
    expect(body.used_pct).toBe(99);
  });

  it('отклоняет период в неверном формате', async () => {
    const res = await check({ div: 'UNA', period: 'сентябрь', article: 'CONTEXT', amount: 100 });
    expect(res.statusCode).toBe(400);
  });
});

describe('документы UNA', () => {
  it('создаёт черновик и зеркалит его у себя', async () => {
    const res = await createDoc(BASE_DOC);
    expect(res.statusCode).toBe(201);
    const doc = res.json();
    expect(doc.status).toBe('draft');
    expect(doc.doc_no).toMatch(/^WSEO03\/2026\/\d{4}$/);

    const mirrored = await db.query<{ doc_no: string; status: string }>(
      `SELECT doc_no, status FROM una_documents`,
    );
    expect(mirrored.rows[0]?.doc_no).toBe(doc.doc_no);
  });

  it('повторный вызов с тем же ext_id не создаёт второй документ', async () => {
    const first = (await createDoc(BASE_DOC)).json();
    const second = await createDoc(BASE_DOC);
    expect(second.statusCode).toBe(200);
    expect(second.json().una_cod).toBe(first.una_cod);
    expect(second.json().created).toBe(false);

    const mirrored = await db.query(`SELECT una_cod FROM una_documents`);
    expect(mirrored.rows).toHaveLength(1);
    const xref = await db.query(`SELECT ext_id FROM una_xref`);
    expect(xref.rows).toHaveLength(1);
  });

  it('не даёт AI создать документ на сумму сверх лимита', async () => {
    const res = await createDoc({
      ...BASE_DOC,
      ext_id: 'run-43:big',
      run_id: await realRunId(),
      amount: 25_000,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/свыше 10000/);
  });

  it('пропускает документ AI в пределах лимита', async () => {
    const res = await createDoc({
      ...BASE_DOC,
      ext_id: 'run-44:small',
      run_id: await realRunId(),
      amount: 4_500,
    });
    expect(res.statusCode).toBe(201);
  });

  it('требует тип документа вида WSEO..', async () => {
    const res = await createDoc({ ...BASE_DOC, ext_id: 'x', sysfid: 'INVOICE' });
    expect(res.statusCode).toBe(400);
  });
});

describe('маршрут согласования', () => {
  async function submitted(author = 'p.tuhari') {
    const doc = (await createDoc(BASE_DOC)).json();
    await app.inject({
      method: 'POST', url: `/una/documents/${doc.una_cod}/submit`, payload: { actor: author },
    });
    return doc;
  }

  it('утверждение переводит документ в approved и обновляет зеркало', async () => {
    const doc = await submitted();
    const res = await app.inject({
      method: 'POST', url: `/una/documents/${doc.una_cod}/approve`,
      payload: { actor: 'director', decision: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');

    const mirrored = await db.query<{ status: string }>(`SELECT status FROM una_documents`);
    expect(mirrored.rows[0]?.status).toBe('approved');
  });

  it('AI-сессия не может утвердить документ', async () => {
    const doc = await submitted();
    const res = await app.inject({
      method: 'POST', url: `/una/documents/${doc.una_cod}/approve`,
      payload: { actor: 'SEO_AI_BOT', decision: 'approve' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/не может согласовывать/);
  });

  it('нельзя утвердить документ, который не отправлен на согласование', async () => {
    const doc = (await createDoc(BASE_DOC)).json();
    const res = await app.inject({
      method: 'POST', url: `/una/documents/${doc.una_cod}/approve`,
      payload: { actor: 'director', decision: 'approve' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('несуществующий документ даёт 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/una/documents/9999/approve',
      payload: { actor: 'director', decision: 'approve' },
    });
    expect(res.statusCode).toBe(404);
  });
});
