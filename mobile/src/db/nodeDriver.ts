/**
 * node:sqlite driver — used by the test suite and by the CLI tooling
 * (`tools/`), never by the application bundle.
 */
import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver, SqlValue } from './driver';

export class NodeSqlDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
    const statement = this.db.prepare(sql);
    const result = statement.run(...params);
    return { changes: Number(result.changes ?? 0) };
  }

  async select<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    return statement.all(...params) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // SQLite has no nested transactions; the outermost call owns the boundary.
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return await fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.depth = 1;
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
