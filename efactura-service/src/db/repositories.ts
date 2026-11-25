/**
 * Repository contracts plus their Oracle implementations.
 *
 * The worker and the HTTP layer depend only on the interfaces, so the whole
 * pipeline can be exercised against the in-memory store in `memory.ts`.
 */
import type { OutboxRow, OutboxState } from '../invoice/types.js';
import type { SqlDriver, SqlValue } from './driver.js';

export interface EnqueueInput {
  tenantId: string;
  externalId: string;
  payload: string;
  seria?: string | null;
  number?: string | null;
}

export interface OutboxUpdate {
  state?: OutboxState;
  seria?: string | null;
  number?: string | null;
  invoiceStatus?: number | null;
  xml?: string | null;
  signedXml?: string | null;
  qrCodeText?: string | null;
  lastError?: string | null;
  attempts?: number;
  nextAttemptAt?: Date | null;
}

export interface OutboxRepository {
  /** Inserts, or returns the existing row when the external id is already known. */
  enqueue(input: EnqueueInput): Promise<OutboxRow>;
  findById(id: number): Promise<OutboxRow | null>;
  findByExternalId(tenantId: string, externalId: string): Promise<OutboxRow | null>;
  findBySeriaNumber(tenantId: string, seria: string, number: string): Promise<OutboxRow | null>;
  /** Rows in the given states whose next attempt is due, oldest first. */
  claimDue(tenantId: string, states: OutboxState[], limit: number, now: Date): Promise<OutboxRow[]>;
  update(id: number, patch: OutboxUpdate): Promise<void>;
  list(tenantId: string, filter: { state?: OutboxState; limit: number }): Promise<OutboxRow[]>;
  countByState(tenantId: string): Promise<Record<string, number>>;
}

export interface SeriesRow {
  id: number;
  seria: string;
  number: string;
}

export interface SeriesRepository {
  addMany(
    tenantId: string,
    invoiceType: number,
    pairs: { seria: string; number: string }[],
  ): Promise<number>;
  countFree(tenantId: string, invoiceType: number): Promise<number>;
  /** Atomically hands one free pair to an outbox row. */
  take(tenantId: string, invoiceType: number, outboxId: number): Promise<SeriesRow | null>;
  markUsed(id: number): Promise<void>;
}

export interface AuditEntry {
  tenantId: string;
  outboxId?: number | null;
  /** Set when the call was made on behalf of a connected company. */
  connectionId?: number | null;
  operation: string;
  requestId?: string | null;
  status?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  createdAt: Date;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  /**
   * What was done on behalf of one company. A connected company is entitled to
   * see this, so it is exposed over the API rather than kept for operators.
   */
  listByConnection(tenantId: string, connectionId: number, limit: number): Promise<AuditRecord[]>;
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

const OUTBOX_COLUMNS = `
  ID, TENANT_ID, EXTERNAL_ID, SERIA, NUMBER_, STATE, INVOICE_STATUS, ATTEMPTS,
  LAST_ERROR, PAYLOAD, XML, SIGNED_XML, QR_CODE_TEXT, CREATED_AT, UPDATED_AT, NEXT_ATTEMPT_AT
`;

function toRow(record: Record<string, unknown>): OutboxRow {
  return {
    id: Number(record['ID']),
    tenantId: String(record['TENANT_ID']),
    externalId: String(record['EXTERNAL_ID']),
    seria: (record['SERIA'] as string | null) ?? null,
    number: (record['NUMBER_'] as string | null) ?? null,
    state: String(record['STATE']) as OutboxState,
    invoiceStatus:
      record['INVOICE_STATUS'] === null || record['INVOICE_STATUS'] === undefined
        ? null
        : Number(record['INVOICE_STATUS']),
    attempts: Number(record['ATTEMPTS'] ?? 0),
    lastError: (record['LAST_ERROR'] as string | null) ?? null,
    payload: String(record['PAYLOAD'] ?? ''),
    xml: (record['XML'] as string | null) ?? null,
    signedXml: (record['SIGNED_XML'] as string | null) ?? null,
    createdAt: record['CREATED_AT'] as Date,
    updatedAt: record['UPDATED_AT'] as Date,
    nextAttemptAt: (record['NEXT_ATTEMPT_AT'] as Date | null) ?? null,
  };
}

export class OracleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: SqlDriver) {}

  async enqueue(input: EnqueueInput): Promise<OutboxRow> {
    const existing = await this.findByExternalId(input.tenantId, input.externalId);
    if (existing) return existing;

    await this.db.execute(
      `INSERT INTO EFACT_OUTBOX (TENANT_ID, EXTERNAL_ID, SERIA, NUMBER_, STATE, PAYLOAD, NEXT_ATTEMPT_AT)
       VALUES (:tenantId, :externalId, :seria, :number_, 'pending', :payload, SYSTIMESTAMP)`,
      {
        tenantId: input.tenantId,
        externalId: input.externalId,
        seria: input.seria ?? null,
        number_: input.number ?? null,
        payload: input.payload,
      },
    );

    const created = await this.findByExternalId(input.tenantId, input.externalId);
    if (!created) throw new Error(`outbox row for ${input.externalId} vanished after insert`);
    return created;
  }

  async findById(id: number): Promise<OutboxRow | null> {
    const rows = await this.db.query(
      `SELECT ${OUTBOX_COLUMNS} FROM EFACT_OUTBOX WHERE ID = :id`,
      { id },
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findByExternalId(tenantId: string, externalId: string): Promise<OutboxRow | null> {
    const rows = await this.db.query(
      `SELECT ${OUTBOX_COLUMNS} FROM EFACT_OUTBOX
       WHERE TENANT_ID = :tenantId AND EXTERNAL_ID = :externalId`,
      { tenantId, externalId },
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findBySeriaNumber(
    tenantId: string,
    seria: string,
    number: string,
  ): Promise<OutboxRow | null> {
    const rows = await this.db.query(
      `SELECT ${OUTBOX_COLUMNS} FROM EFACT_OUTBOX
       WHERE TENANT_ID = :tenantId AND SERIA = :seria AND NUMBER_ = :number_`,
      { tenantId, seria, number_: number },
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async claimDue(
    tenantId: string,
    states: OutboxState[],
    limit: number,
    now: Date,
  ): Promise<OutboxRow[]> {
    const placeholders = states.map((_, index) => `:s${index}`).join(', ');
    const binds: Record<string, SqlValue> = { tenantId, now, limit };
    states.forEach((state, index) => {
      binds[`s${index}`] = state;
    });

    // SKIP LOCKED lets several service instances share one database without
    // handing the same document to two of them.
    const rows = await this.db.query(
      `SELECT ${OUTBOX_COLUMNS} FROM EFACT_OUTBOX
       WHERE TENANT_ID = :tenantId
         AND STATE IN (${placeholders})
         AND (NEXT_ATTEMPT_AT IS NULL OR NEXT_ATTEMPT_AT <= :now)
       ORDER BY NEXT_ATTEMPT_AT NULLS FIRST, ID
       FETCH FIRST :limit ROWS ONLY
       FOR UPDATE SKIP LOCKED`,
      binds,
    );
    return rows.map(toRow);
  }

  async update(id: number, patch: OutboxUpdate): Promise<void> {
    const sets: string[] = ['UPDATED_AT = SYSTIMESTAMP'];
    const binds: Record<string, SqlValue> = { id };

    const columns: Array<[keyof OutboxUpdate, string]> = [
      ['state', 'STATE'],
      ['seria', 'SERIA'],
      ['number', 'NUMBER_'],
      ['invoiceStatus', 'INVOICE_STATUS'],
      ['xml', 'XML'],
      ['signedXml', 'SIGNED_XML'],
      ['qrCodeText', 'QR_CODE_TEXT'],
      ['lastError', 'LAST_ERROR'],
      ['attempts', 'ATTEMPTS'],
      ['nextAttemptAt', 'NEXT_ATTEMPT_AT'],
    ];

    for (const [key, column] of columns) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = :${String(key)}`);
      binds[String(key)] = patch[key] as SqlValue;
    }

    if (sets.length === 1) return;
    await this.db.execute(`UPDATE EFACT_OUTBOX SET ${sets.join(', ')} WHERE ID = :id`, binds);
  }

  async list(
    tenantId: string,
    filter: { state?: OutboxState; limit: number },
  ): Promise<OutboxRow[]> {
    const where = filter.state ? 'AND STATE = :state' : '';
    const binds: Record<string, SqlValue> = { tenantId, limit: filter.limit };
    if (filter.state) binds['state'] = filter.state;

    const rows = await this.db.query(
      `SELECT ${OUTBOX_COLUMNS} FROM EFACT_OUTBOX
       WHERE TENANT_ID = :tenantId ${where}
       ORDER BY ID DESC
       FETCH FIRST :limit ROWS ONLY`,
      binds,
    );
    return rows.map(toRow);
  }

  async countByState(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ STATE: string; CNT: number }>(
      `SELECT STATE, COUNT(*) AS CNT FROM EFACT_OUTBOX WHERE TENANT_ID = :tenantId GROUP BY STATE`,
      { tenantId },
    );
    return Object.fromEntries(rows.map((row) => [row.STATE, Number(row.CNT)]));
  }
}

export class OracleSeriesRepository implements SeriesRepository {
  constructor(private readonly db: SqlDriver) {}

  async addMany(
    tenantId: string,
    invoiceType: number,
    pairs: { seria: string; number: string }[],
  ): Promise<number> {
    let inserted = 0;
    await this.db.transaction(async () => {
      for (const pair of pairs) {
        // A reservation may be replayed after a crash; skip what is already here.
        const result = await this.db.execute(
          `INSERT INTO EFACT_SERIES (TENANT_ID, SERIA, NUMBER_, INVOICE_TYPE, STATE)
           SELECT :tenantId, :seria, :number_, :invoiceType, 'free' FROM DUAL
           WHERE NOT EXISTS (
             SELECT 1 FROM EFACT_SERIES
             WHERE TENANT_ID = :tenantId AND SERIA = :seria AND NUMBER_ = :number_
           )`,
          { tenantId, seria: pair.seria, number_: pair.number, invoiceType },
        );
        inserted += result.rowsAffected;
      }
    });
    return inserted;
  }

  async countFree(tenantId: string, invoiceType: number): Promise<number> {
    const rows = await this.db.query<{ CNT: number }>(
      `SELECT COUNT(*) AS CNT FROM EFACT_SERIES
       WHERE TENANT_ID = :tenantId AND INVOICE_TYPE = :invoiceType AND STATE = 'free'`,
      { tenantId, invoiceType },
    );
    return Number(rows[0]?.CNT ?? 0);
  }

  async take(tenantId: string, invoiceType: number, outboxId: number): Promise<SeriesRow | null> {
    return this.db.transaction(async () => {
      const rows = await this.db.query<{ ID: number; SERIA: string; NUMBER_: string }>(
        `SELECT ID, SERIA, NUMBER_ FROM EFACT_SERIES
         WHERE TENANT_ID = :tenantId AND INVOICE_TYPE = :invoiceType AND STATE = 'free'
         ORDER BY ID
         FETCH FIRST 1 ROWS ONLY
         FOR UPDATE SKIP LOCKED`,
        { tenantId, invoiceType },
      );
      const row = rows[0];
      if (!row) return null;

      await this.db.execute(
        `UPDATE EFACT_SERIES SET STATE = 'taken', OUTBOX_ID = :outboxId WHERE ID = :id`,
        { id: row.ID, outboxId },
      );
      return { id: Number(row.ID), seria: row.SERIA, number: row.NUMBER_ };
    });
  }

  async markUsed(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE EFACT_SERIES SET STATE = 'used', USED_AT = SYSTIMESTAMP WHERE ID = :id`,
      { id },
    );
  }
}

export class OracleAuditRepository implements AuditRepository {
  constructor(private readonly db: SqlDriver) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO EFACT_AUDIT
         (TENANT_ID, OUTBOX_ID, CONNECTION_ID, OPERATION, REQUEST_ID, STATUS, DURATION_MS, ERROR)
       VALUES (:tenantId, :outboxId, :connectionId, :operation, :requestId, :status, :durationMs, :error)`,
      {
        tenantId: entry.tenantId,
        outboxId: entry.outboxId ?? null,
        connectionId: entry.connectionId ?? null,
        operation: entry.operation,
        requestId: entry.requestId ?? null,
        status: entry.status ?? null,
        durationMs: entry.durationMs ?? null,
        // The column is 4000 bytes; a long stack trace would abort the insert
        // and lose the very failure we are trying to record.
        error: entry.error ? entry.error.slice(0, 3900) : null,
      },
    );
  }

  async listByConnection(
    tenantId: string,
    connectionId: number,
    limit: number,
  ): Promise<AuditRecord[]> {
    const rows = await this.db.query(
      `SELECT ID, TENANT_ID, OUTBOX_ID, CONNECTION_ID, OPERATION, REQUEST_ID,
              STATUS, DURATION_MS, ERROR, CREATED_AT
         FROM EFACT_AUDIT
        WHERE TENANT_ID = :tenantId AND CONNECTION_ID = :connectionId
        ORDER BY CREATED_AT DESC
        FETCH FIRST :limit ROWS ONLY`,
      { tenantId, connectionId, limit },
    );

    return rows.map((row) => ({
      id: Number(row['ID']),
      tenantId: String(row['TENANT_ID']),
      outboxId: row['OUTBOX_ID'] === null ? null : Number(row['OUTBOX_ID']),
      connectionId: Number(row['CONNECTION_ID']),
      operation: String(row['OPERATION']),
      requestId: (row['REQUEST_ID'] as string | null) ?? null,
      status: row['STATUS'] === null ? null : Number(row['STATUS']),
      durationMs: row['DURATION_MS'] === null ? null : Number(row['DURATION_MS']),
      error: (row['ERROR'] as string | null) ?? null,
      createdAt: row['CREATED_AT'] as Date,
    }));
  }
}
