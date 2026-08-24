import Fastify, { type FastifyInstance } from 'fastify';
import { generatePlaybook, validatePlaybook, type PlaybookTemplate, type SiteProfile } from '@seo/playbook-engine';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { ApiError } from './errors.js';
import type { UnaGateway } from './una/gateway.js';
import {
  approvalInput, budgetCheckInput, generateInput, reportInput, runInput, siteInput, unaDocInput,
} from './schemas.js';

export interface AppDeps {
  db: Db;
  una: UnaGateway;
  templates: Map<string, PlaybookTemplate>;
  /** Источник времени; вынесен ради воспроизводимых тестов. */
  now?: () => Date;
}

interface SiteRow {
  id: string;
  domain: string;
  name: string;
  locales: string[];
  geo: string[];
  niche: string;
  description: string;
  audience: string;
  tone_of_voice: string;
  banned_claims: string[];
  competitors: string[];
  una_div: string | null;
}

function toProfile(row: SiteRow): SiteProfile {
  return {
    domain: row.domain,
    name: row.name,
    locales: row.locales,
    geo: row.geo,
    niche: row.niche,
    description: row.description,
    audience: row.audience,
    tone_of_voice: row.tone_of_voice,
    banned_claims: row.banned_claims,
    competitors: row.competitors,
    una_div: row.una_div ?? undefined,
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, una, templates } = deps;
  const now = deps.now ?? (() => new Date());

  async function audit(entry: {
    actor: string;
    actor_kind: 'user' | 'ai_session' | 'system';
    action: string;
    target: string;
    run_id?: string | null;
    payload?: unknown;
  }): Promise<void> {
    await db.query(
      `INSERT INTO audit_log (actor, actor_kind, action, target, run_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.actor, entry.actor_kind, entry.action, entry.target, entry.run_id ?? null,
       JSON.stringify(entry.payload ?? {})],
    );
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Некорректный запрос', details: error.issues });
    }
    const fastifyError = error as { statusCode?: number; message?: string };
    if (fastifyError.statusCode === 400) {
      return reply.status(400).send({ error: fastifyError.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', templates: templates.size };
  });

  // ---------------------------------------------------------------- сайты
  app.get('/sites', async () => {
    const { rows } = await db.query<SiteRow>(
      `SELECT * FROM sites WHERE is_active ORDER BY domain`,
    );
    return { items: rows };
  });

  app.post('/sites', async (request, reply) => {
    const input = siteInput.parse(request.body);
    const existing = await db.query(`SELECT id FROM sites WHERE domain = $1`, [input.domain]);
    if (existing.rows.length > 0) {
      throw ApiError.conflict(`Сайт ${input.domain} уже заведён`);
    }
    const { rows } = await db.query<SiteRow>(
      `INSERT INTO sites (domain, name, locales, geo, niche, description, audience,
                          tone_of_voice, banned_claims, competitors, una_div)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [input.domain, input.name, input.locales, input.geo, input.niche, input.description,
       input.audience, input.tone_of_voice, input.banned_claims, input.competitors,
       input.una_div ?? null],
    );
    await audit({ actor: 'system', actor_kind: 'system', action: 'site.create', target: input.domain });
    return reply.status(201).send(rows[0]);
  });

  // ------------------------------------------------------------- шаблоны
  app.get('/templates', async () => ({
    items: [...templates.values()]
      .map((t) => ({
        code: t.code, version: t.version, title: t.title,
        phase: t.phase, autonomy: t.autonomy, cadence: t.cadence,
        params: Object.entries(t.params_schema).map(([name, spec]) => ({ name, ...spec })),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  }));

  // ----------------------------------------------------------- плейбуки
  app.post('/playbooks/generate', async (request, reply) => {
    const input = generateInput.parse(request.body);
    const template = templates.get(input.template_code);
    if (!template) throw ApiError.notFound(`Шаблон ${input.template_code}`);

    const site = await db.query<SiteRow>(`SELECT * FROM sites WHERE id = $1`, [input.site_id]);
    const row = site.rows[0];
    if (!row) throw ApiError.notFound('Сайт');

    // Плейбук фазы 6 работает с деньгами и без привязки к UNA бессмыслен.
    if (template.phase === 6 && !input.una) {
      throw ApiError.badRequest(
        `Шаблон ${template.code} относится к учётному контуру: нужен блок una (tech_user, secret_ref)`,
      );
    }

    const generatedAt = now().toISOString();
    let rendered;
    try {
      rendered = generatePlaybook(template, {
        site: toProfile(row),
        params: input.params,
        generated_at: generatedAt,
        run_mode: input.run_mode,
        model_hint: input.model_hint,
        una: input.una,
        budget: input.budget,
      });
    } catch (error) {
      throw ApiError.badRequest((error as Error).message);
    }

    // Невалидный плейбук не сохраняем: иначе он рано или поздно уедет в сессию.
    const verdict = validatePlaybook(rendered.content);
    if (!verdict.ok) {
      throw ApiError.badRequest('Сгенерированный плейбук не прошёл валидацию', verdict.issues);
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO playbooks (site_id, template_code, template_version, params, front_matter,
                              body, content, file_path, generated_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [input.site_id, template.code, template.version, JSON.stringify(input.params),
       JSON.stringify(rendered.front_matter), rendered.body, rendered.content,
       rendered.suggested_path, generatedAt, input.created_by],
    );
    await audit({
      actor: input.created_by, actor_kind: 'system', action: 'playbook.generate',
      target: `${template.code}@${row.domain}`, payload: { params: input.params },
    });

    return reply.status(201).send({
      id: rows[0]!.id,
      file_path: rendered.suggested_path,
      front_matter: rendered.front_matter,
      content: rendered.content,
      warnings: verdict.issues,
    });
  });

  app.post('/playbooks/validate', async (request) => {
    const body = request.body as { content?: string };
    if (typeof body?.content !== 'string') throw ApiError.badRequest('Ожидалось поле content');
    return validatePlaybook(body.content);
  });

  app.get('/playbooks/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`SELECT * FROM playbooks WHERE id = $1`, [id]);
    if (rows.length === 0) throw ApiError.notFound('Плейбук');
    return rows[0];
  });

  // --------------------------------------------------------------- запуски
  app.post('/runs', async (request, reply) => {
    const input = runInput.parse(request.body);
    const { rows } = await db.query<{ id: string; site_id: string; front_matter: Record<string, unknown> }>(
      `SELECT id, site_id, front_matter FROM playbooks WHERE id = $1`,
      [input.playbook_id],
    );
    const playbook = rows[0];
    if (!playbook) throw ApiError.notFound('Плейбук');

    const fm = playbook.front_matter as { run_mode?: string };
    const run = await db.query<{ id: string }>(
      `INSERT INTO task_runs (playbook_id, site_id, status, run_mode, trigger, started_at)
       VALUES ($1,$2,'running',$3,$4,now()) RETURNING id`,
      [playbook.id, playbook.site_id, fm.run_mode ?? 'dry-run', input.trigger],
    );
    await audit({
      actor: 'system', actor_kind: 'system', action: 'run.start',
      target: playbook.id, run_id: run.rows[0]!.id,
    });
    return reply.status(201).send({ id: run.rows[0]!.id, status: 'running' });
  });

  app.post('/runs/:id/report', async (request) => {
    const { id } = request.params as { id: string };
    const input = reportInput.parse(request.body);
    const existing = await db.query<{ status: string }>(`SELECT status FROM task_runs WHERE id = $1`, [id]);
    if (existing.rows.length === 0) throw ApiError.notFound('Запуск');
    if (existing.rows[0]!.status !== 'running') {
      throw ApiError.conflict(`Запуск уже завершён со статусом "${existing.rows[0]!.status}"`);
    }

    await db.query(
      `UPDATE task_runs
          SET status = $2, report = $3, error = $4, finished_at = now(),
              cost_tokens_in = $5, cost_tokens_out = $6, cost_external_calls = $7,
              cost_amount = $8, cost_currency = $9
        WHERE id = $1`,
      [id, input.status, JSON.stringify(input.report), input.error ?? null,
       input.cost.tokens_in, input.cost.tokens_out, input.cost.external_calls,
       input.cost.amount, input.cost.currency],
    );

    for (const artifact of input.artifacts) {
      await db.query(
        `INSERT INTO artifacts (run_id, type, path, checksum) VALUES ($1,$2,$3,$4)`,
        [id, artifact.type, artifact.path, artifact.checksum ?? null],
      );
    }
    await audit({
      actor: 'ai_session', actor_kind: 'ai_session', action: 'run.finish',
      target: id, run_id: id, payload: { status: input.status },
    });
    return { id, status: input.status, artifacts: input.artifacts.length };
  });

  app.get('/runs/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`SELECT * FROM task_runs WHERE id = $1`, [id]);
    if (rows.length === 0) throw ApiError.notFound('Запуск');
    const artifacts = await db.query(`SELECT * FROM artifacts WHERE run_id = $1 ORDER BY created_at`, [id]);
    return { ...rows[0], artifacts: artifacts.rows };
  });

  // ------------------------------------------------------- очередь approve
  app.get('/approvals', async () => {
    const { rows } = await db.query(
      `SELECT a.*, r.site_id, r.playbook_id
         FROM artifacts a
         JOIN task_runs r ON r.id = a.run_id
        WHERE a.approved_at IS NULL AND a.rejected_reason IS NULL
        ORDER BY a.created_at`,
    );
    return { items: rows };
  });

  app.post('/artifacts/:id/approve', async (request) => {
    const { id } = request.params as { id: string };
    const input = approvalInput.parse(request.body);

    // Утверждать может только человек. Это же правило продублировано в UNA
    // на уровне пакета: приложение не должно быть единственной защитой.
    if (/(^|_)(ai|bot)(_|$)/i.test(input.actor) || input.actor.toUpperCase().endsWith('_BOT')) {
      throw ApiError.forbidden('AI-сессия не может утверждать артефакты');
    }

    const { rows } = await db.query<{ id: string; approved_at: string | null; rejected_reason: string | null }>(
      `SELECT id, approved_at, rejected_reason FROM artifacts WHERE id = $1`,
      [id],
    );
    const artifact = rows[0];
    if (!artifact) throw ApiError.notFound('Артефакт');
    if (artifact.approved_at) throw ApiError.conflict('Артефакт уже утверждён');
    if (artifact.rejected_reason) throw ApiError.conflict('Артефакт уже отклонён');

    if (input.decision === 'approve') {
      await db.query(`UPDATE artifacts SET approved_by = $2, approved_at = now() WHERE id = $1`,
        [id, input.actor]);
    } else {
      if (!input.reason) throw ApiError.badRequest('При отклонении нужна причина');
      await db.query(`UPDATE artifacts SET rejected_reason = $2 WHERE id = $1`, [id, input.reason]);
    }
    await audit({
      actor: input.actor, actor_kind: 'user', action: `artifact.${input.decision}`,
      target: id, payload: { reason: input.reason },
    });
    return { id, decision: input.decision };
  });

  // ------------------------------------------------------------------ UNA
  app.post('/una/budget/check', async (request) => {
    const input = budgetCheckInput.parse(request.body);
    return una.checkBudget(input);
  });

  app.post('/una/documents', async (request, reply) => {
    const input = unaDocInput.parse(request.body);
    const doc = await una.createDocument(input);

    // Зеркалим документ у себя: панели нужен список без похода в Oracle.
    await db.query(
      `INSERT INTO una_documents (una_cod, doc_type, doc_no, doc_date, site_id, una_div,
                                  campaign_code, amount, status, run_id, playbook_sha, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (doc_type, una_cod) DO UPDATE
          SET status = EXCLUDED.status, synced_at = now()`,
      [doc.una_cod, doc.sysfid, doc.doc_no, input.doc_date, input.site_id ?? null, input.div,
       input.campaign_code ?? null, input.amount ?? null, doc.status, input.run_id ?? null,
       input.playbook_sha ?? null, JSON.stringify({ note: input.note ?? null })],
    );
    await db.query(
      `INSERT INTO una_xref (ext_system, ext_id, una_table, una_cod, content_hash, direction)
       VALUES ($1,$2,'TMDB_DOCS',$3,$4,'I')
       ON CONFLICT (ext_system, ext_id) DO NOTHING`,
      [input.ext_system, input.ext_id, doc.una_cod, doc.doc_no],
    );
    await audit({
      actor: input.run_id ? 'ai_session' : 'system',
      actor_kind: input.run_id ? 'ai_session' : 'system',
      action: doc.created ? 'una.document.create' : 'una.document.reuse',
      target: doc.doc_no, run_id: input.run_id ?? null,
    });
    return reply.status(doc.created ? 201 : 200).send(doc);
  });

  app.post('/una/documents/:cod/approve', async (request) => {
    const { cod } = request.params as { cod: string };
    const input = approvalInput.parse(request.body);
    if (input.decision !== 'approve') throw ApiError.badRequest('Через этот маршрут только утверждение');
    const doc = await una.approveDocument(Number(cod), input.actor, input.reason);
    await db.query(`UPDATE una_documents SET status = $2, synced_at = now() WHERE una_cod = $1`,
      [doc.una_cod, doc.status]);
    await audit({ actor: input.actor, actor_kind: 'user', action: 'una.document.approve', target: doc.doc_no });
    return doc;
  });

  app.post('/una/documents/:cod/submit', async (request) => {
    const { cod } = request.params as { cod: string };
    const body = request.body as { actor?: string; comment?: string };
    if (!body?.actor) throw ApiError.badRequest('Ожидалось поле actor');
    const doc = await una.submitDocument(Number(cod), body.actor, body.comment);
    await db.query(`UPDATE una_documents SET status = $2, synced_at = now() WHERE una_cod = $1`,
      [doc.una_cod, doc.status]);
    return doc;
  });

  return app;
}
