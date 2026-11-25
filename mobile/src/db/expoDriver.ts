/**
 * expo-sqlite driver — the implementation used on device.
 */
import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlValue } from './driver';

export class ExpoSqlDriver implements SqlDriver {
  private depth = 0;

  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name = 'una-market.db'): Promise<ExpoSqlDriver> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync('PRAGMA journal_mode = WAL');
    await db.execAsync('PRAGMA foreign_keys = ON');
    return new ExpoSqlDriver(db);
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
    const result = await this.db.runAsync(sql, params);
    return { changes: result.changes };
  }

  async select<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return (await this.db.getAllAsync(sql, params)) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return await fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.depth = 1;
    let result!: T;
    try {
      await this.db.withTransactionAsync(async () => {
        result = await fn();
      });
    } finally {
      this.depth = 0;
    }
    return result;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}
