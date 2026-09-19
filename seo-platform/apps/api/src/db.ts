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

/**
 * PGlite — настоящий Postgres, собранный в WASM, в процессе приложения.
 *
 * Нужен, чтобы поднять платформу локально без внешней базы: тот же SQL и те же
 * миграции, что в проде. Для продакшна не предназначен — данные живут ровно
 * столько, сколько процесс.
 */
export class PgliteDb implements Db {
  private constructor(private readonly pg: { query: Function; exec: Function; close: Function }) {}

  static async create(dataDir?: string): Promise<PgliteDb> {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite(dataDir);
    return new PgliteDb(pg as never);
  }

  /** Применяет миграции по порядку имён файлов. */
  async migrate(dir: string): Promise<string[]> {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await this.pg.exec(readFileSync(join(dir, file), 'utf8'));
      applied.push(file);
    }
    return applied;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pg.query(sql, params);
    return { rows: (result as { rows: T[] }).rows };
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
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
