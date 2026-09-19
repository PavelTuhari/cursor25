import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTemplateDir } from '@seo/playbook-engine';
import { buildApp } from './app.js';
import { PgDb, PgliteDb, type Db } from './db.js';
import { MockUnaGateway } from './una/mock-gateway.js';
import { OracleUnaGateway } from './una/oracle-gateway.js';
import type { UnaGateway } from './una/gateway.js';
import { ClaudeRunner } from './runner/claude-runner.js';
import { RunWorker } from './runner/worker.js';
import { buildRegistry, registryConfigFromEnv } from './runner/registry.js';
import { Scheduler } from './scheduler.js';
import { ConfigStore } from './config/store.js';
import { EnvSecretResolver } from './config/secrets.js';
import { PublishingService } from './publishing.js';

const here = dirname(fileURLToPath(import.meta.url));

function resolveTemplatesDir(): string {
  return process.env['TEMPLATES_DIR'] ?? join(here, '../../../packages/playbook-engine/templates');
}

function resolveGateway(): UnaGateway {
  const mode = process.env['UNA_MODE'] ?? 'mock';
  if (mode === 'oracle') {
    const connectString = process.env['UNA_ORACLE_DSN'];
    const user = process.env['UNA_ORACLE_USER'];
    const password = process.env['UNA_ORACLE_PASSWORD'];
    if (!connectString || !user || !password) {
      throw new Error('UNA_MODE=oracle требует UNA_ORACLE_DSN, UNA_ORACLE_USER и UNA_ORACLE_PASSWORD');
    }
    return new OracleUnaGateway({ connectString, user, password });
  }
  // Мок повторяет инварианты пакетов PK_SEO_*, но не является учётной системой:
  // в проде должен стоять UNA_MODE=oracle.
  console.warn('[una] режим mock: документы никуда не уходят, используйте только для разработки');
  return new MockUnaGateway();
}

/**
 * DATABASE_URL=pglite (или pglite:/путь) поднимает встроенный Postgres и сам
 * накатывает миграции — платформа стартует без внешней инфраструктуры.
 * Любая другая строка подключения идёт в обычный драйвер pg.
 */
async function openDb(connectionString: string): Promise<Db> {
  if (!connectionString.startsWith('pglite')) {
    return PgDb.connect(connectionString);
  }
  const dataDir = connectionString.slice('pglite'.length).replace(/^:/, '') || undefined;
  const db = await PgliteDb.create(dataDir);
  const applied = await db.migrate(join(here, '../../../db/postgres/migrations'));
  console.warn(
    `[db] встроенный PGlite${dataDir ? ` (${dataDir})` : ' в памяти'}, миграций применено: ${applied.length}. ` +
      'Режим разработки: для продакшна укажите настоящий DATABASE_URL',
  );
  return db;
}

/**
 * Запускает раннер сессий, если он включён.
 *
 * По умолчанию выключен: исполнение плейбука тратит деньги, поэтому включаться
 * оно должно осознанно, а не потому что сервис поднялся.
 */
async function startWorker(db: Db, config: ConfigStore): Promise<AbortController | null> {
  if (!(await config.get<boolean>('runner.enabled'))) {
    console.warn('[runner] выключен: запуски будут копиться в очереди');
    return null;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const registry = buildRegistry(registryConfigFromEnv());
  const connectors = ['mcp-serp', 'mcp-gsc'].filter((id) => registry.has(id));
  console.log(
    `[runner] коннекторы: ${connectors.length > 0 ? connectors.join(', ') : 'только локальные (mcp-site, mcp-lang)'}`,
  );
  const runner = new ClaudeRunner({ client: new Anthropic(), registry });
  const worker = new RunWorker({
    db,
    runner,
    allowMissingTools: await config.get<boolean>('runner.allow_missing_tools'),
  });
  const controller = new AbortController();
  void worker.loop(controller.signal);
  console.log('[runner] claude запущен, очередь обрабатывается');
  return controller;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('Не задан DATABASE_URL');

  const db = await openDb(connectionString);
  const templates = loadTemplateDir(resolveTemplatesDir());
  const config = new ConfigStore(db);
  const secrets = new EnvSecretResolver();
  const publishing = new PublishingService({ db, config, secrets });
  const app = buildApp({ db, una: resolveGateway(), templates, config, secrets, publishing });

  const worker = await startWorker(db, config);

  let scheduler: AbortController | null = null;
  if (await config.get<boolean>('scheduler.enabled')) {
    scheduler = new AbortController();
    void new Scheduler(db, templates).loop(scheduler.signal);
    console.log('[scheduler] включён, проверка расписаний раз в минуту');
  } else {
    console.warn('[scheduler] выключен: расписания не срабатывают');
  }

  console.log(
    `[publishing] ${(await config.get<boolean>('publishing.enabled')) ? 'включена' : 'выключена'}, ` +
      `утверждение человеком: ${(await config.get<boolean>('publishing.require_approval')) ? 'обязательно' : 'ОТКЛЮЧЕНО'}`,
  );

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[api] слушает :${port}, шаблонов загружено: ${templates.size}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      worker?.abort();
      scheduler?.abort();
      void app.close().then(() => db.close()).then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error('[api] не удалось запуститься:', error);
  process.exit(1);
});
