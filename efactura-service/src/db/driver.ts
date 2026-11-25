/**
 * The narrow database surface the rest of the service uses.
 *
 * Keeping it to four methods is what lets the whole pipeline run against an
 * in-memory store in tests and on a laptop, and against Oracle in production,
 * without a second code path.
 */

export type SqlValue = string | number | Date | Buffer | null;

export interface SqlDriver {
  query<T = Record<string, unknown>>(sql: string, binds?: Record<string, SqlValue>): Promise<T[]>;
  execute(sql: string, binds?: Record<string, SqlValue>): Promise<{ rowsAffected: number }>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
