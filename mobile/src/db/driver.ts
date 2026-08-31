/**
 * Thin SQL driver abstraction.
 *
 * The whole data layer speaks this interface, so the same code runs on
 * expo-sqlite inside the app and on node:sqlite in the test suite and in the
 * config/sync tooling.
 */

export type SqlValue = string | number | null;

export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs `fn` inside a transaction; rolls back if it rejects. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function selectOne<T>(
  driver: SqlDriver,
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  const rows = await driver.select<T>(sql, params);
  return rows.length > 0 ? (rows[0] as T) : null;
}
