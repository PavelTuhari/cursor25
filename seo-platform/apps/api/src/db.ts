/**
 * Тонкая абстракция над Postgres.
 *
 * Приложение работает с интерфейсом Db, а не с драйвером: в проде это pg,
 * в тестах — PGlite (настоящий Postgres, собранный в WASM). Так тесты гоняют
 * ровно тот SQL, который поедет в продакшн, без моков базы.
 */

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export class PgDb implements Db {
  private constructor(private readonly pool: import('pg').Pool) {}

  static async connect(connectionString: string): Promise<PgDb> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString });
    await pool.query('SELECT 1');
    return new PgDb(pool);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as T[] };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
