/**
 * Synchronisation engine.
 *
 * Pull: each entity keeps a cursor (`updated_at` of the newest record it has
 * seen) and asks the API only for what changed since — a delta sync. Entities
 * configured as `full` re-download the whole (small) collection and drop rows
 * the server no longer returns.
 *
 * Push: local writes are queued in `_outbox` and drained here, so the app is
 * fully usable offline; a job that keeps failing is retried with exponential
 * backoff and dropped after `sync.outbox.maxAttempts`.
 */
import { ApiClient, ApiError } from '../api/client';
import type { AppConfig, EntityConfig } from '../config/types';
import type { Database } from '../db/database';
import {
  completeJob,
  failJob,
  pendingCount,
  readyJobs,
  type OutboxJob,
} from '../db/outbox';
import { saveSyncError, saveSyncSuccess, getSyncState } from '../db/syncState';
import type { BatchResponse, EntitySyncResult, PullResponse, SyncReport } from './types';

export interface SyncEngineOptions {
  db: Database;
  api: ApiClient;
  config: AppConfig;
  now?: () => Date;
  isAuthenticated?: () => boolean;
  onProgress?: (result: EntitySyncResult) => void;
}

interface PushResult {
  pushed: number;
  failed: number;
  /** Jobs that exhausted their retries and were discarded. */
  dropped: string[];
}

export interface SyncOptions {
  /** Restrict the run to these entity names. */
  entities?: string[];
  /** Ignore the stored cursor and re-pull everything. */
  force?: boolean;
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(private readonly options: SyncEngineOptions) {}

  /** Applied when a remote configuration changes sync or paging settings. */
  setConfig(config: AppConfig): void {
    this.options.config = config;
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  pendingChanges(): Promise<number> {
    return pendingCount(this.options.db.driver);
  }

  /** Concurrent calls join the run that is already in flight. */
  sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.run(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(options: SyncOptions): Promise<SyncReport> {
    const startedAt = this.now().toISOString();
    const results: EntitySyncResult[] = [];

    const entities = [...this.options.db.entities]
      .filter((entity) => !options.entities || options.entities.includes(entity.name))
      .sort((a, b) => a.order - b.order);

    for (const entity of entities) {
      const result = await this.syncEntity(entity, options);
      results.push(result);
      this.options.onProgress?.(result);
    }

    const errors = results.filter((item) => item.error).map((item) => `${item.entity}: ${item.error}`);
    return {
      startedAt,
      finishedAt: this.now().toISOString(),
      entities: results,
      pulled: results.reduce((sum, item) => sum + item.pulled, 0),
      pushed: results.reduce((sum, item) => sum + item.pushed, 0),
      failed: results.reduce((sum, item) => sum + item.failed, 0),
      errors,
      ok: errors.length === 0,
    };
  }

  async syncEntity(entity: EntityConfig, options: SyncOptions = {}): Promise<EntitySyncResult> {
    const started = this.now().getTime();
    const result: EntitySyncResult = { entity: entity.name, pulled: 0, deleted: 0, pushed: 0, failed: 0, durationMs: 0 };

    const authenticated = this.options.isAuthenticated ? this.options.isAuthenticated() : true;
    if (entity.requiresAuth && !authenticated) {
      result.skipped = 'not_authenticated';
      result.durationMs = this.now().getTime() - started;
      return result;
    }

    try {
      let dropped: string[] = [];
      if (entity.direction !== 'pull') {
        const push = await this.pushEntity(entity);
        result.pushed = push.pushed;
        result.failed = push.failed;
        dropped = push.dropped;
      }
      if (entity.direction !== 'push') {
        const pull = await this.pullEntity(entity, options.force === true);
        result.pulled = pull.pulled;
        result.deleted = pull.deleted;
      }
      if (dropped.length > 0) {
        // Reported after the pull so a successful pull does not clear the notice.
        result.error = dropped.join('; ');
        await saveSyncError(this.options.db.driver, entity.name, result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.error = message;
      await saveSyncError(this.options.db.driver, entity.name, message);
    }

    result.durationMs = this.now().getTime() - started;
    return result;
  }

  /* ------------------------------------------------------------------ pull */

  private async pullEntity(entity: EntityConfig, force: boolean): Promise<{ pulled: number; deleted: number }> {
    const repository = this.options.db.repository(entity.name);
    const state = await getSyncState(this.options.db.driver, entity.name);
    const fullSync = entity.syncMode === 'full' || force || !state?.cursor;
    const runStamp = this.now().toISOString();

    const cursor: string | null = fullSync ? null : state?.cursor ?? null;
    let pageCursor: string | undefined;
    let pulled = 0;
    let deleted = 0;
    let newCursor: string | null = cursor;
    // For a full sync, everything the server did not send this run is stale.
    const seenIds: string[] = [];

    for (let page = 0; page < this.options.config.sync.maxPagesPerEntity; page += 1) {
      const response: PullResponse = await this.options.api.request<PullResponse>(entity.endpoint, {
        query: {
          updated_since: cursor ?? undefined,
          cursor: pageCursor,
          limit: this.options.config.api.pageSize,
        },
      });

      const items = Array.isArray(response.items) ? response.items : [];
      if (items.length > 0) {
        pulled += await repository.upsertManyFromServer(items, runStamp);
        if (entity.syncMode === 'full') {
          for (const item of items) {
            const id = item[entity.primaryKey];
            if (typeof id === 'string' || typeof id === 'number') seenIds.push(String(id));
          }
        }
      }
      if (response.deleted?.length) {
        deleted += await repository.deleteFromServer(response.deleted);
      }

      newCursor = response.cursor ?? this.maxCursor(entity, items, newCursor);
      pageCursor = response.cursor ?? undefined;

      if (!response.has_more) break;
      if (!response.cursor) {
        // Without a cursor another page would repeat the same rows forever.
        throw new Error(`entity "${entity.name}": has_more=true but no cursor was returned`);
      }
    }

    if (entity.syncMode === 'full') {
      deleted += await this.deleteMissing(entity, seenIds);
    }

    const count = await this.options.db.driver.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${entity.table}`,
    );
    await saveSyncSuccess(
      this.options.db.driver,
      entity.name,
      newCursor,
      count[0]?.count ?? 0,
      this.now(),
      fullSync,
    );

    return { pulled, deleted };
  }

  /**
   * Removes rows a full sync did not return. Ids go through a temporary table
   * so a large catalogue never hits SQLite's bound-parameter limit; rows with
   * unpushed local changes are kept.
   */
  private async deleteMissing(entity: EntityConfig, seenIds: string[]): Promise<number> {
    const driver = this.options.db.driver;
    if (seenIds.length === 0) {
      const result = await driver.execute(`DELETE FROM ${entity.table} WHERE _dirty = 0`);
      return result.changes;
    }

    return driver.transaction(async () => {
      await driver.execute('DROP TABLE IF EXISTS _full_sync_ids');
      await driver.execute('CREATE TEMP TABLE _full_sync_ids (id TEXT PRIMARY KEY)');
      for (let i = 0; i < seenIds.length; i += 200) {
        const chunk = seenIds.slice(i, i + 200);
        await driver.execute(
          `INSERT OR IGNORE INTO _full_sync_ids (id) VALUES ${chunk.map(() => '(?)').join(', ')}`,
          chunk,
        );
      }
      const result = await driver.execute(
        `DELETE FROM ${entity.table}
         WHERE ${entity.primaryKey} NOT IN (SELECT id FROM _full_sync_ids) AND _dirty = 0`,
      );
      await driver.execute('DROP TABLE IF EXISTS _full_sync_ids');
      return result.changes;
    });
  }

  /** Falls back to the newest `cursorField` value seen when the API sends no cursor. */
  private maxCursor(entity: EntityConfig, items: Record<string, unknown>[], current: string | null): string | null {
    if (!entity.cursorField) return current;
    let max = current;
    for (const item of items) {
      const value = item[entity.cursorField];
      if (typeof value !== 'string') continue;
      if (max === null || value > max) max = value;
    }
    return max;
  }

  /* ------------------------------------------------------------------ push */

  private async pushEntity(entity: EntityConfig): Promise<PushResult> {
    const now = this.now();
    const jobs = await readyJobs(this.options.db.driver, entity.name, now);
    if (jobs.length === 0) return { pushed: 0, failed: 0, dropped: [] };

    return entity.pushMode === 'batch'
      ? this.pushBatch(entity, jobs, now)
      : this.pushRest(entity, jobs, now);
  }

  private async pushRest(entity: EntityConfig, jobs: OutboxJob[], now: Date): Promise<PushResult> {
    let pushed = 0;
    let failed = 0;
    const dropped: string[] = [];

    for (const job of jobs) {
      try {
        if (job.op === 'delete') {
          await this.options.api.request(`${entity.endpoint}/${encodeURIComponent(job.record_id)}`, {
            method: 'DELETE',
          });
        } else {
          const payload = job.payload ? JSON.parse(job.payload) : {};
          const record = await this.options.api.request<Record<string, unknown> | undefined>(
            `${entity.endpoint}/${encodeURIComponent(job.record_id)}`,
            { method: 'PUT', body: payload },
          );
          await this.applyServerEcho(entity, job.record_id, record, now);
        }
        await completeJob(this.options.db.driver, job.id);
        pushed += 1;
      } catch (error) {
        // A record deleted on the server is already in the state we wanted.
        if (job.op === 'delete' && error instanceof ApiError && error.status === 404) {
          await completeJob(this.options.db.driver, job.id);
          pushed += 1;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const givenUp = await failJob(this.options.db.driver, job, message, this.options.config.sync.outbox, now);
        failed += 1;
        if (givenUp) {
          dropped.push(
            `dropped ${job.op} for ${job.record_id} after ${this.options.config.sync.outbox.maxAttempts} attempts: ${message}`,
          );
        }
        if (error instanceof ApiError && error.retryable) break; // server is unwell: stop hammering it
      }
    }

    return { pushed, failed, dropped };
  }

  private async pushBatch(entity: EntityConfig, jobs: OutboxJob[], now: Date): Promise<PushResult> {
    const operations = jobs.map((job) => ({
      op: job.op,
      id: job.record_id,
      data: job.payload ? JSON.parse(job.payload) : undefined,
    }));

    let response: BatchResponse;
    try {
      response = await this.options.api.request<BatchResponse>(`${entity.endpoint}/batch`, {
        method: 'POST',
        body: { operations },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dropped: string[] = [];
      for (const job of jobs) {
        const givenUp = await failJob(this.options.db.driver, job, message, this.options.config.sync.outbox, now);
        if (givenUp) dropped.push(`dropped ${job.op} for ${job.record_id}: ${message}`);
      }
      return { pushed: 0, failed: jobs.length, dropped };
    }

    const byId = new Map(response.results?.map((item) => [item.id, item]) ?? []);
    const dropped: string[] = [];
    let pushed = 0;
    let failed = 0;

    for (const job of jobs) {
      const result = byId.get(job.record_id);
      if (!result || result.status === 'error') {
        const reason = result?.error ?? 'no result returned for this record';
        const givenUp = await failJob(this.options.db.driver, job, reason, this.options.config.sync.outbox, now);
        if (givenUp) dropped.push(`dropped ${job.op} for ${job.record_id}: ${reason}`);
        failed += 1;
        continue;
      }
      await this.applyServerEcho(entity, job.record_id, result.record, now);
      await completeJob(this.options.db.driver, job.id);
      pushed += 1;
    }

    return { pushed, failed, dropped };
  }

  /**
   * Reconciles the local row with what the server stored. `client_wins` keeps
   * the local values and only clears the dirty flag.
   */
  private async applyServerEcho(
    entity: EntityConfig,
    recordId: string,
    record: Record<string, unknown> | undefined,
    now: Date,
  ): Promise<void> {
    const repository = this.options.db.repository(entity.name);
    const stamp = now.toISOString();
    if (record && entity.conflict !== 'client_wins') {
      await repository.upsertFromServer(record, stamp);
      return;
    }
    await repository.markSynced([recordId], stamp);
  }
}
