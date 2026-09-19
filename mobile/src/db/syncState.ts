/** Per-entity sync bookkeeping: delta cursor, timestamps and last error. */
import type { SqlDriver } from './driver';
import { selectOne } from './driver';

export interface SyncState {
  entity: string;
  cursor: string | null;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  last_error: string | null;
  record_count: number;
}

export async function getSyncState(driver: SqlDriver, entity: string): Promise<SyncState | null> {
  return selectOne<SyncState>(driver, 'SELECT * FROM _sync_state WHERE entity = ?', [entity]);
}

export async function listSyncState(driver: SqlDriver): Promise<SyncState[]> {
  return driver.select<SyncState>('SELECT * FROM _sync_state ORDER BY entity');
}

export async function saveSyncSuccess(
  driver: SqlDriver,
  entity: string,
  cursor: string | null,
  recordCount: number,
  now: Date,
  fullSync: boolean,
): Promise<void> {
  const iso = now.toISOString();
  await driver.execute(
    `INSERT INTO _sync_state (entity, cursor, last_sync_at, last_full_sync_at, last_error, record_count)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(entity) DO UPDATE SET
       cursor = excluded.cursor,
       last_sync_at = excluded.last_sync_at,
       last_full_sync_at = COALESCE(excluded.last_full_sync_at, _sync_state.last_full_sync_at),
       last_error = NULL,
       record_count = excluded.record_count`,
    [entity, cursor, iso, fullSync ? iso : null, recordCount],
  );
}

export async function saveSyncError(driver: SqlDriver, entity: string, error: string): Promise<void> {
  await driver.execute(
    `INSERT INTO _sync_state (entity, cursor, last_error) VALUES (?, NULL, ?)
     ON CONFLICT(entity) DO UPDATE SET last_error = excluded.last_error`,
    [entity, error.slice(0, 500)],
  );
}

export async function resetSyncState(driver: SqlDriver, entity: string): Promise<void> {
  await driver.execute(
    'UPDATE _sync_state SET cursor = NULL, last_sync_at = NULL, last_full_sync_at = NULL, record_count = 0 WHERE entity = ?',
    [entity],
  );
}
