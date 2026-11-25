/**
 * Oracle driver, node-oracledb in thin mode.
 *
 * Thin mode is deliberate: it is pure JavaScript, so installing the service at a
 * client site is `npm ci` and nothing else - no Instant Client, no
 * LD_LIBRARY_PATH, no matching architecture. It speaks to Oracle Database 12.1
 * and newer, which covers every supported release, and it works unchanged
 * against Autonomous Database in OCI.
 */
import oracledb from 'oracledb';

import type { OracleConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';
import type { SqlDriver, SqlValue } from './driver.js';

// Rows as plain objects, CLOBs as strings: the service reads whole documents,
// never streams them, and the largest is a few hundred kilobytes of XML.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

export class OracleDriver implements SqlDriver {
  private constructor(
    private readonly pool: oracledb.Pool,
    private readonly logger: Logger,
    /** Set while a transaction is open, so nested calls share one connection. */
    private connection: oracledb.Connection | null = null,
  ) {}

  static async connect(config: OracleConfig, logger: Logger): Promise<OracleDriver> {
    const pool = await oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: config.poolMin,
      poolMax: config.poolMax,
      poolIncrement: config.poolIncrement,
      queueTimeout: config.queueTimeoutMs,
    });
    logger.info('oracle.pool.created', {
      connectString: config.connectString,
      user: config.user,
      poolMin: config.poolMin,
      poolMax: config.poolMax,
    });
    return new OracleDriver(pool, logger);
  }

  private async withConnection<T>(fn: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
    if (this.connection) return fn(this.connection);
    const conn = await this.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    binds: Record<string, SqlValue> = {},
  ): Promise<T[]> {
    return this.withConnection(async (conn) => {
      const result = await conn.execute<T>(sql, binds);
      return result.rows ?? [];
    });
  }

  async execute(
    sql: string,
    binds: Record<string, SqlValue> = {},
  ): Promise<{ rowsAffected: number }> {
    return this.withConnection(async (conn) => {
      const result = await conn.execute(sql, binds, {
        // Inside a transaction the outer commit decides; on its own each
        // statement stands alone.
        autoCommit: this.connection === null,
      });
      return { rowsAffected: result.rowsAffected ?? 0 };
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.connection) return fn();

    const conn = await this.pool.getConnection();
    this.connection = conn;
    try {
      const result = await fn();
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback().catch((rollbackError: Error) => {
        this.logger.error('oracle.rollback.failed', { error: rollbackError.message });
      });
      throw error;
    } finally {
      this.connection = null;
      await conn.close();
    }
  }

  async close(): Promise<void> {
    await this.pool.close(10);
    this.logger.info('oracle.pool.closed');
  }

  /** Cheap liveness probe for the health endpoint. */
  async ping(): Promise<boolean> {
    const rows = await this.query<{ OK: number }>('SELECT 1 AS OK FROM DUAL');
    return rows[0]?.OK === 1;
  }
}
