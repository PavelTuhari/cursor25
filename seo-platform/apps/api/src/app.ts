import Fastify, { type FastifyInstance } from 'fastify';
import { validatePlaybook, type PlaybookTemplate } from '@seo/playbook-engine';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { ApiError } from './errors.js';
import type { UnaGateway } from './una/gateway.js';
import { createPlaybook, type SiteRow } from './playbooks.js';
import { isValidCron, nextRunAt } from './cron.js';
import { Scheduler } from './scheduler.js';
import { ConfigStore } from './config/store.js';
import { EnvSecretResolver, type SecretResolver } from './config/secrets.js';
import { PublishingService } from './publishing.js';
import { isPublishableChannel } from './runner/connectors/social/index.js';
import {
  approvalInput, budgetCheckInput, channelAccountInput, generateInput, publicationInput,
  reportInput, runInput, scheduleInput, settingInput, siteInput, unaDocInput,
} from './schemas.js';

export interface AppDeps {
  db: Db;
  una: UnaGateway;
  templates: Map<string, PlaybookTemplate>;
  /** Источник времени; вынесен ради воспроизводимых тестов. */
  now?: () => Date;
  config?: ConfigStore;
  secrets?: SecretResolver;
  publishing?: PublishingService;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { db, una, templates } = deps;
  const now = deps.now ?? (() => new Date());
  const config = deps.config ?? new ConfigStore(db);
  const secrets = deps.secrets ?? new EnvSecretResolver();
  const publishing = deps.publishing ?? new PublishingService({ db, config, secrets });

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
    const created = await createPlaybook(db, templates, input, now().toISOString());
    await audit({
      actor: input.created_by, actor_kind: 'system', action: 'playbook.generate',
      target: `${input.template_code}@${input.site_id}`, payload: { params: input.params },
    });
    return reply.status(201).send(created);
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
    const isExternal = input.execution === 'external';
    const run = await db.query<{ id: string }>(
      `INSERT INTO task_runs (playbook_id, site_id, status, run_mode, trigger, started_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        playbook.id,
        playbook.site_id,
        isExternal ? 'running' : 'queued',
        fm.run_mode ?? 'dry-run',
        input.trigger,
        isExternal ? new Date().toISOString() : null,
      ],
    );
    await audit({
      actor: 'system', actor_kind: 'system', action: 'run.start',
      target: playbook.id, run_id: run.rows[0]!.id, payload: { execution: input.execution },
    });
    return reply
      .status(201)
      .send({ id: run.rows[0]!.id, status: isExternal ? 'running' : 'queued' });
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

  app.get('/runs', async (request) => {
    const query = request.query as { site_id?: string; status?: string; limit?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`site_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }
    // Потолок на выдачу: панель показывает последние запуски, а не всю историю.
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    params.push(limit);
    const { rows } = await db.query(
      `SELECT * FROM task_runs
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return { items: rows };
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

  // ------------------------------------------------------------ настройки
  app.get('/settings', async (request) => {
    const { site_id } = request.query as { site_id?: string };
    return { items: await config.describe(site_id) };
  });

  app.put('/settings', async (request) => {
    const input = settingInput.parse(request.body);
    try {
      await config.set(input.key, input.value, input.actor, input.site_id);
    } catch (error) {
      throw ApiError.badRequest((error as Error).message);
    }
    await audit({
      actor: input.actor, actor_kind: 'user', action: 'setting.update',
      target: input.key, payload: { value: input.value, site_id: input.site_id ?? null },
    });
    return { key: input.key, value: input.value };
  });

  // --------------------------------------------------- подключения каналов
  app.get('/channel-accounts', async (request) => {
    const { site_id } = request.query as { site_id?: string };
    const { rows } = await db.query(
      `SELECT a.id, a.site_id, a.channel_id, a.external_id, a.display_name, a.credentials_ref,
              a.config, a.sandbox, a.enabled, a.rate_limit_per_day, a.last_checked_at,
              a.last_check_status, a.last_check_error, s.domain,
              COALESCE(u.published, 0) AS published_today
         FROM channel_accounts a
         JOIN sites s ON s.id = a.site_id
         LEFT JOIN channel_usage u ON u.account_id = a.id AND u.usage_date = CURRENT_DATE
        WHERE ($1::uuid IS NULL OR a.site_id = $1)
        ORDER BY s.domain, a.channel_id`,
      [site_id ?? null],
    );
    // Наружу отдаём только имя секрета: значение не покидает сервер.
    return { items: rows };
  });

  app.post('/channel-accounts', async (request, reply) => {
    const input = channelAccountInput.parse(request.body);
    if (!isPublishableChannel(input.channel_id)) {
      throw ApiError.badRequest(
        `Для канала "${input.channel_id}" публикация не реализована. ` +
          'Доступны: facebook, instagram, linkedin, telegram',
      );
    }
    const site = await db.query(`SELECT id FROM sites WHERE id = $1`, [input.site_id]);
    if (site.rows.length === 0) throw ApiError.notFound('Сайт');

    // Секрет должен существовать до сохранения подключения: иначе проблема
    // всплывёт в момент публикации, когда исправлять поздно.
    if (!(await secrets.has(input.credentials_ref))) {
      throw ApiError.badRequest(
        `Секрет по ссылке "${input.credentials_ref}" недоступен. ` +
          'Задайте переменную окружения с этим именем и повторите.',
      );
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO channel_accounts (site_id, channel_id, external_id, display_name,
                                     credentials_ref, config, sandbox, enabled, rate_limit_per_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (site_id, channel_id, external_id) DO NOTHING
       RETURNING id`,
      [input.site_id, input.channel_id, input.external_id, input.display_name,
       input.credentials_ref, JSON.stringify(input.config), input.sandbox, input.enabled,
       input.rate_limit_per_day ?? null],
    );
    if (rows.length === 0) throw ApiError.conflict('Такое подключение уже заведено');
    await audit({
      actor: 'panel', actor_kind: 'user', action: 'channel.connect',
      target: `${input.channel_id}:${input.external_id}`, payload: { sandbox: input.sandbox },
    });
    return reply.status(201).send({ id: rows[0]!.id });
  });

  app.post('/channel-accounts/:id/verify', async (request) => {
    const { id } = request.params as { id: string };
    return publishing.verify(id);
  });

  app.delete('/channel-accounts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`DELETE FROM channel_accounts WHERE id = $1 RETURNING id`, [id]);
    if (rows.length === 0) throw ApiError.notFound('Подключение канала');
    return { id, deleted: true };
  });

  // ------------------------------------------------------------ публикации
  app.post('/publications', async (request, reply) => {
    const input = publicationInput.parse(request.body);
    const account = await db.query<{ channel_id: string }>(
      `SELECT channel_id FROM channel_accounts WHERE id = $1 AND site_id = $2`,
      [input.account_id, input.site_id],
    );
    if (account.rows.length === 0) {
      throw ApiError.badRequest('Подключение не найдено или принадлежит другому сайту');
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO publications (site_id, channel_id, account_id, artifact_id, campaign_code,
                                 locale, format, title, body, external_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft') RETURNING id`,
      [input.site_id, account.rows[0]!.channel_id, input.account_id, input.artifact_id ?? null,
       input.campaign_code ?? null, input.locale, input.format, input.title, input.body,
       input.link ?? null],
    );
    return reply.status(201).send({ id: rows[0]!.id, status: 'draft' });
  });

  app.get('/publications', async (request) => {
    const { site_id, status } = request.query as { site_id?: string; status?: string };
    const { rows } = await db.query(
      `SELECT p.*, a.display_name AS account_name, a.sandbox
         FROM publications p
         LEFT JOIN channel_accounts a ON a.id = p.account_id
        WHERE ($1::uuid IS NULL OR p.site_id = $1)
          AND ($2::text IS NULL OR p.status = $2)
        ORDER BY p.created_at DESC LIMIT 200`,
      [site_id ?? null, status ?? null],
    );
    return { items: rows };
  });

  app.post('/publications/:id/approve', async (request) => {
    const { id } = request.params as { id: string };
    const input = approvalInput.parse(request.body);
    if (/(^|_)(ai|bot)(_|$)/i.test(input.actor) || input.actor.toUpperCase().endsWith('_BOT')) {
      throw ApiError.forbidden('AI-сессия не может утверждать публикации');
    }
    const status = input.decision === 'approve' ? 'approved' : 'skipped';
    const { rows } = await db.query<{ id: string; status: string }>(
      `UPDATE publications SET status = $2 WHERE id = $1 AND status IN ('draft','failed')
       RETURNING id, status`,
      [id, status],
    );
    if (rows.length === 0) {
      throw ApiError.conflict('Публикация не в том статусе, чтобы её утверждать');
    }
    await audit({
      actor: input.actor, actor_kind: 'user', action: `publication.${input.decision}`, target: id,
    });
    return rows[0];
  });

  app.post('/publications/:id/publish', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { actor?: string; dry_run?: boolean };
    if (!body?.actor) throw ApiError.badRequest('Ожидалось поле actor');
    return publishing.publish(id, body.actor, { dryRun: body.dry_run === true });
  });

  // ----------------------------------------------------------- расписания
  app.get('/schedules', async () => {
    const { rows } = await db.query(
      `SELECT s.*, si.domain
         FROM schedules s
         JOIN sites si ON si.id = s.site_id
        ORDER BY s.next_run_at NULLS FIRST`,
    );
    return { items: rows };
  });

  app.post('/schedules', async (request, reply) => {
    const input = scheduleInput.parse(request.body);
    if (!isValidCron(input.cron)) {
      throw ApiError.badRequest(`Некорректное расписание "${input.cron}": ожидается cron из 5 полей (UTC)`);
    }
    if (!templates.has(input.template_code)) {
      throw ApiError.notFound(`Шаблон ${input.template_code}`);
    }
    const site = await db.query(`SELECT id FROM sites WHERE id = $1`, [input.site_id]);
    if (site.rows.length === 0) throw ApiError.notFound('Сайт');

    // Первое срабатывание считаем сразу: иначе расписание сработает в
    // ближайшем тике, а не тогда, когда указано.
    const next = nextRunAt(input.cron, now());
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO schedules (site_id, template_code, name, cron, params, una, run_mode, enabled, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (site_id, template_code, cron) DO NOTHING
       RETURNING id`,
      [input.site_id, input.template_code, input.name, input.cron,
       JSON.stringify(input.params), input.una ? JSON.stringify(input.una) : null,
       input.run_mode ?? null, input.enabled, next ? next.toISOString() : null],
    );
    if (rows.length === 0) {
      throw ApiError.conflict('Такое расписание для этого сайта и шаблона уже заведено');
    }
    await audit({
      actor: 'system', actor_kind: 'system', action: 'schedule.create',
      target: `${input.template_code}@${input.site_id}`, payload: { cron: input.cron },
    });
    return reply.status(201).send({ id: rows[0]!.id, next_run_at: next });
  });

  app.post('/schedules/:id/toggle', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean };
    if (typeof body?.enabled !== 'boolean') throw ApiError.badRequest('Ожидалось поле enabled');
    const { rows } = await db.query<{ id: string; enabled: boolean }>(
      `UPDATE schedules SET enabled = $2 WHERE id = $1 RETURNING id, enabled`,
      [id, body.enabled],
    );
    if (rows.length === 0) throw ApiError.notFound('Расписание');
    return rows[0];
  });

  app.delete('/schedules/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(`DELETE FROM schedules WHERE id = $1 RETURNING id`, [id]);
    if (rows.length === 0) throw ApiError.notFound('Расписание');
    return { id, deleted: true };
  });

  /** Ручной прогон планировщика: нужен для тестов и для разбора застрявших задач. */
  app.post('/scheduler/tick', async () => {
    const scheduler = new Scheduler(db, templates, now);
    return scheduler.tick();
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
