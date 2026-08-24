import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadTemplateDir } from '@seo/playbook-engine';
import { buildApp } from '../app.js';
import type { Db, QueryResult } from '../db.js';
import { MockUnaGateway, type MockGatewayOptions } from '../una/mock-gateway.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../..');
const MIGRATIONS = join(ROOT, 'db/postgres/migrations');
const TEMPLATES = join(ROOT, 'packages/playbook-engine/templates');

/** PGlite — настоящий Postgres в WASM: тесты гоняют продовый SQL, а не мок базы. */
class PgliteDb implements Db {
  constructor(private readonly pg: PGlite) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pg.query<T>(sql, params as never[]);
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return new PgliteDb(pg);
}

export const templates = loadTemplateDir(TEMPLATES);

export async function createTestApp(gatewayOptions: MockGatewayOptions = {}) {
  const db = await createTestDb();
  const una = new MockUnaGateway(gatewayOptions);
  const app = buildApp({ db, una, templates, now: () => new Date('2026-09-01T08:00:00.000Z') });
  await app.ready();
  return { app, db, una };
}

export const UNA_SITE = {
  domain: 'una.md',
  name: 'UNA.md',
  locales: ['ru-MD', 'ro-MD'],
  geo: ['MD'],
  niche: 'ERP для НКО',
  description: 'молдавская учётная система для НКО и бизнеса',
  audience: 'главные бухгалтеры НКО',
  tone_of_voice: 'экспертный, с примерами из практики РМ',
  banned_claims: ['полностью бесплатно'],
  competitors: ['1c.md'],
  una_div: 'UNA',
};

export const ARTICLE_PARAMS = {
  cluster_name: 'программа для бухгалтерии НКО',
  primary_keyword: 'программа бухгалтерия НКО Молдова',
  keywords: [{ phrase: 'программа бухгалтерия НКО Молдова', volume: 320, position: 18, intent: 'commercial' }],
  knowledge_pack_id: 'kp-una-v7',
  target_locale: 'ru-MD',
  words_min: 1800,
  words_max: 2500,
};
