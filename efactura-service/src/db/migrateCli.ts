/**
 * `npm run migrate` - applies the numbered files in `sql/` that the target
 * schema has not seen yet, recording each in EFACT_SCHEMA_VERSION.
 *
 * `002_erp_views.sql` is skipped by default: those views belong to the ERP owner
 * and are almost always adapted per client. Pass `--with-views` to apply them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../config/load.js';
import { createLogger } from '../util/logger.js';
import { OracleDriver } from './oracle.js';

const SQL_DIR = resolve(process.cwd(), 'sql');
const VIEWS_FILE = '002_erp_views.sql';

/** Oracle rejects a batch, so each statement goes over on its own. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function main(): Promise<void> {
  const withViews = process.argv.includes('--with-views');
  const { config } = loadConfig();
  const logger = createLogger(config.service.logLevel, { component: 'migrate' });

  if (config.oracle.connectString === 'memory') {
    logger.warn('migrate.skipped', { reason: 'in-memory store needs no schema' });
    return;
  }

  const driver = await OracleDriver.connect(config.oracle, logger);
  try {
    await driver.execute(`
      DECLARE
        missing EXCEPTION;
        PRAGMA EXCEPTION_INIT(missing, -942);
      BEGIN
        EXECUTE IMMEDIATE 'SELECT 1 FROM EFACT_SCHEMA_VERSION WHERE ROWNUM = 1';
      EXCEPTION WHEN missing THEN
        EXECUTE IMMEDIATE 'CREATE TABLE EFACT_SCHEMA_VERSION (
          VERSION NUMBER(5) PRIMARY KEY,
          NAME VARCHAR2(128) NOT NULL,
          APPLIED_AT TIMESTAMP(6) DEFAULT SYSTIMESTAMP NOT NULL)';
      END;`);

    const applied = new Set(
      (await driver.query<{ VERSION: number }>('SELECT VERSION FROM EFACT_SCHEMA_VERSION')).map(
        (row) => Number(row.VERSION),
      ),
    );

    const files = readdirSync(SQL_DIR)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .filter((name) => withViews || name !== VIEWS_FILE)
      .sort();

    for (const name of files) {
      const version = Number(name.split('_')[0]);
      if (applied.has(version)) {
        logger.debug('migrate.skip', { name, version });
        continue;
      }

      logger.info('migrate.apply', { name, version });
      await driver.transaction(async () => {
        for (const statement of statements(readFileSync(resolve(SQL_DIR, name), 'utf8'))) {
          await driver.execute(statement);
        }
        await driver.execute(
          'INSERT INTO EFACT_SCHEMA_VERSION (VERSION, NAME) VALUES (:version, :name)',
          { version, name },
        );
      });
    }

    logger.info('migrate.done', { applied: files.length });
  } finally {
    await driver.close();
  }
}

main().catch((error: Error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
