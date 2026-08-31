/**
 * Generic repository over a configured entity: every table gets the same API,
 * built from `entities.config.json` alone.
 */
import type { DataQuery, EntityConfig } from '../config/types';
import type { SqlDriver, SqlValue } from './driver';
import { buildCount, buildSelect, type QueryContext } from './queryBuilder';
import { buildUpsert, decodeRows, type EntityRecord, type UpsertOptions } from './records';
import { enqueueOutbox } from './outbox';

export class Repository<T extends EntityRecord = EntityRecord> {
  constructor(
    private readonly driver: SqlDriver,
    readonly entity: EntityConfig,
  ) {}

  async query(query: DataQuery, ctx: QueryContext): Promise<T[]> {
    const compiled = buildSelect(this.entity, { ...query, entity: this.entity.name }, ctx);
    const rows = await this.driver.select<Record<string, SqlValue>>(compiled.sql, compiled.params);
    return decodeRows<T>(this.entity, rows);
  }

  async count(query: DataQuery, ctx: QueryContext): Promise<number> {
    const compiled = buildCount(this.entity, { ...query, entity: this.entity.name }, ctx);
    const rows = await this.driver.select<{ count: number }>(compiled.sql, compiled.params);
    return rows[0]?.count ?? 0;
  }

  async findById(id: string, ctx: QueryContext): Promise<T | null> {
    const rows = await this.query(
      { entity: this.entity.name, where: [{ field: this.entity.primaryKey, op: '=', value: id }], limit: 1 },
      ctx,
    );
    return rows[0] ?? null;
  }

  async all(ctx: QueryContext, limit = 1000): Promise<T[]> {
    return this.query({ entity: this.entity.name, limit }, ctx);
  }

  /** Writes a record received from the server; never marks it dirty. */
  async upsertFromServer(record: EntityRecord, syncedAt: string): Promise<void> {
    const { sql, params } = buildUpsert(this.entity, record, { dirty: false, syncedAt });
    await this.driver.execute(sql, params);
  }

  async upsertManyFromServer(records: EntityRecord[], syncedAt: string): Promise<number> {
    if (records.length === 0) return 0;
    await this.driver.transaction(async () => {
      for (const record of records) {
        await this.upsertFromServer(record, syncedAt);
      }
    });
    return records.length;
  }

  /**
   * Writes a record created or edited on the device: the row is marked dirty
   * and an outbox job is queued so the change reaches the API on next sync.
   */
  async saveLocal(record: EntityRecord, options: UpsertOptions = {}): Promise<void> {
    const id = record[this.entity.primaryKey];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`local record for "${this.entity.name}" needs a string primary key`);
    }
    await this.driver.transaction(async () => {
      const { sql, params } = buildUpsert(this.entity, record, { ...options, dirty: true });
      await this.driver.execute(sql, params);
      if (this.entity.direction !== 'pull') {
        await enqueueOutbox(this.driver, {
          entity: this.entity.name,
          op: 'upsert',
          recordId: id,
          payload: record,
        });
      }
    });
  }

  async deleteLocal(id: string): Promise<void> {
    await this.driver.transaction(async () => {
      await this.driver.execute(`DELETE FROM ${this.entity.table} WHERE ${this.entity.primaryKey} = ?`, [id]);
      if (this.entity.direction !== 'pull') {
        await enqueueOutbox(this.driver, {
          entity: this.entity.name,
          op: 'delete',
          recordId: id,
          payload: null,
        });
      }
    });
  }

  /** Applies a server-side deletion; local pending changes are not touched. */
  async deleteFromServer(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.driver.execute(
      `DELETE FROM ${this.entity.table} WHERE ${this.entity.primaryKey} IN (${placeholders}) AND _dirty = 0`,
      ids,
    );
    return result.changes;
  }

  async clear(): Promise<void> {
    await this.driver.execute(`DELETE FROM ${this.entity.table}`);
  }

  async markSynced(ids: string[], syncedAt: string): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.driver.execute(
      `UPDATE ${this.entity.table} SET _dirty = 0, _synced_at = ? WHERE ${this.entity.primaryKey} IN (${placeholders})`,
      [syncedAt, ...ids],
    );
  }

  async dirtyCount(): Promise<number> {
    const rows = await this.driver.select<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${this.entity.table} WHERE _dirty = 1`,
    );
    return rows[0]?.count ?? 0;
  }
}
