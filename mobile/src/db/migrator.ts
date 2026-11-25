/**
 * Config-driven migrations.
 *
 * Server-owned tables are disposable caches: when their configured shape
 * changes the table is rebuilt and its sync cursor reset, which makes the next
 * sync re-download the entity. Locally created rows that have not reached the
 * server yet live in `_outbox`, which is never dropped, so nothing a user
 * typed is lost by a schema change.
 */
import type { EntitiesConfig, EntityConfig } from '../config/types';
import type { SqlDriver } from './driver';
import { selectOne } from './driver';
import {
  INTERNAL_TABLES,
  createIndexStatements,
  createTableSql,
  dropTableSql,
  entityFingerprint,
} from './schema';

export interface MigrationReport {
  created: string[];
  rebuilt: string[];
  unchanged: string[];
  removed: string[];
}

const FINGERPRINT_KEY = (table: string): string => `schema:${table}`;
const KNOWN_TABLES_KEY = 'schema:tables';

interface KnownTable {
  name: string;
  table: string;
}

export async function getKv(driver: SqlDriver, key: string): Promise<string | null> {
  const row = await selectOne<{ value: string | null }>(driver, 'SELECT value FROM _kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setKv(driver: SqlDriver, key: string, value: string): Promise<void> {
  await driver.execute(
    'INSERT INTO _kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

async function createEntity(driver: SqlDriver, entity: EntityConfig): Promise<void> {
  await driver.execute(createTableSql(entity));
  for (const statement of createIndexStatements(entity)) {
    await driver.execute(statement);
  }
  await setKv(driver, FINGERPRINT_KEY(entity.table), entityFingerprint(entity));
  await driver.execute(
    'INSERT INTO _sync_state (entity, cursor, last_sync_at, record_count) VALUES (?, NULL, NULL, 0) ' +
      'ON CONFLICT(entity) DO NOTHING',
    [entity.name],
  );
}

export async function migrate(driver: SqlDriver, config: EntitiesConfig): Promise<MigrationReport> {
  const report: MigrationReport = { created: [], rebuilt: [], unchanged: [], removed: [] };

  for (const statement of INTERNAL_TABLES) {
    await driver.execute(statement);
  }

  const previous = JSON.parse((await getKv(driver, KNOWN_TABLES_KEY)) ?? '[]') as KnownTable[];

  await driver.transaction(async () => {
    for (const entity of config.entities) {
      const stored = await getKv(driver, FINGERPRINT_KEY(entity.table));
      const current = entityFingerprint(entity);

      if (stored === null) {
        await createEntity(driver, entity);
        report.created.push(entity.table);
        continue;
      }
      if (stored === current) {
        report.unchanged.push(entity.table);
        continue;
      }

      await driver.execute(dropTableSql(entity));
      await createEntity(driver, entity);
      // The cached copy is gone: force a full re-pull on the next sync.
      await driver.execute(
        'UPDATE _sync_state SET cursor = NULL, last_sync_at = NULL, last_full_sync_at = NULL, record_count = 0 WHERE entity = ?',
        [entity.name],
      );
      report.rebuilt.push(entity.table);
    }

    // Tables of entities that a new configuration no longer declares.
    const current: KnownTable[] = config.entities.map((entity) => ({ name: entity.name, table: entity.table }));
    const currentTables = current.map((item) => item.table);
    for (const item of previous) {
      if (currentTables.includes(item.table)) continue;
      await driver.execute(`DROP TABLE IF EXISTS ${item.table}`);
      await driver.execute('DELETE FROM _kv WHERE key = ?', [FINGERPRINT_KEY(item.table)]);
      await driver.execute('DELETE FROM _sync_state WHERE entity = ?', [item.name]);
      await driver.execute('DELETE FROM _outbox WHERE entity = ?', [item.name]);
      report.removed.push(item.table);
    }
    await setKv(driver, KNOWN_TABLES_KEY, JSON.stringify(current));
  });

  return report;
}
