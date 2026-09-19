import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadTemplateDir } from '@seo/playbook-engine';
import { buildApp } from './app.js';
import { PgDb, PgliteDb, type Db } from './db.js';
import { MockUnaGateway } from './una/mock-gateway.js';
import { OracleUnaGateway } from './una/oracle-gateway.js';
import type { UnaGateway } from './una/gateway.js';

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

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('Не задан DATABASE_URL');

  const db = await openDb(connectionString);
  const templates = loadTemplateDir(resolveTemplatesDir());
  const app = buildApp({ db, una: resolveGateway(), templates });

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[api] слушает :${port}, шаблонов загружено: ${templates.size}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app.close().then(() => db.close()).then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error('[api] не удалось запуститься:', error);
  process.exit(1);
});
