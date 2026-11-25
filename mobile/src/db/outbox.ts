/**
 * Offline write queue.
 *
 * Everything the user changes while offline (shopping list, favourites) is
 * stored locally and queued here; the sync engine drains the queue with
 * exponential backoff and gives up on a job after `maxAttempts`.
 */
import type { OutboxConfig } from '../config/types';
import type { SqlDriver } from './driver';

export type OutboxOperation = 'upsert' | 'delete';

export interface OutboxJobInput {
  entity: string;
  op: OutboxOperation;
  recordId: string;
  payload: unknown;
  now?: Date;
}

export interface OutboxJob {
  id: number;
  entity: string;
  op: OutboxOperation;
  record_id: string;
  payload: string | null;
  attempts: number;
  created_at: string;
  next_attempt_at: string;
  last_error: string | null;
}

export async function enqueueOutbox(driver: SqlDriver, job: OutboxJobInput): Promise<void> {
  const now = (job.now ?? new Date()).toISOString();
  // A newer change for the same record supersedes the queued one.
  await driver.execute('DELETE FROM _outbox WHERE entity = ? AND record_id = ?', [job.entity, job.recordId]);
  await driver.execute(
    `INSERT INTO _outbox (entity, op, record_id, payload, attempts, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [job.entity, job.op, job.recordId, job.payload === null ? null : JSON.stringify(job.payload), now, now],
  );
}

export async function readyJobs(
  driver: SqlDriver,
  entity: string | null,
  now: Date,
  limit = 100,
): Promise<OutboxJob[]> {
  const iso = now.toISOString();
  return entity
    ? driver.select<OutboxJob>(
        'SELECT * FROM _outbox WHERE entity = ? AND next_attempt_at <= ? ORDER BY id LIMIT ?',
        [entity, iso, limit],
      )
    : driver.select<OutboxJob>('SELECT * FROM _outbox WHERE next_attempt_at <= ? ORDER BY id LIMIT ?', [iso, limit]);
}

export async function completeJob(driver: SqlDriver, id: number): Promise<void> {
  await driver.execute('DELETE FROM _outbox WHERE id = ?', [id]);
}

export function backoffDelayMs(attempts: number, config: OutboxConfig): number {
  const delay = config.backoffMs * Math.pow(config.factor, Math.max(0, attempts - 1));
  return Math.min(delay, config.maxBackoffMs ?? delay);
}

/**
 * Records a failed attempt. Returns `true` when the job was dropped because it
 * exhausted its attempts — the caller surfaces that as a sync error.
 */
export async function failJob(
  driver: SqlDriver,
  job: OutboxJob,
  error: string,
  config: OutboxConfig,
  now: Date,
): Promise<boolean> {
  const attempts = job.attempts + 1;
  if (attempts >= config.maxAttempts) {
    await driver.execute('DELETE FROM _outbox WHERE id = ?', [job.id]);
    return true;
  }
  const nextAttempt = new Date(now.getTime() + backoffDelayMs(attempts, config)).toISOString();
  await driver.execute(
    'UPDATE _outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
    [attempts, nextAttempt, error.slice(0, 500), job.id],
  );
  return false;
}

export async function pendingCount(driver: SqlDriver): Promise<number> {
  const rows = await driver.select<{ count: number }>('SELECT COUNT(*) AS count FROM _outbox');
  return rows[0]?.count ?? 0;
}
