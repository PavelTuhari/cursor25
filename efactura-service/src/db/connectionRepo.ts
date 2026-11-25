/**
 * Repositories for connections and the inbox, plus their Oracle implementations.
 *
 * The sealed credential leaves this module only through `secretOf`, which the
 * client factory calls and nothing else. Nothing that reaches the HTTP layer
 * carries it.
 */
import type {
  Connection,
  ConnectionState,
  InboxDecision,
  InboxRow,
  InboxUpsert,
} from '../connections/types.js';
import type { SqlDriver, SqlValue } from './driver.js';

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface CreateConnectionInput {
  tenantId: string;
  idno: string;
  title?: string | null;
  actorRole: number;
  sfsUsername: string;
  sealedSecret: Buffer;
  consentVersion: string;
  consentAt: Date;
}

export interface ConnectionPatch {
  state?: ConnectionState;
  title?: string | null;
  lastPollAt?: Date | null;
  lastSeenAt?: Date | null;
  lastError?: string | null;
  sfsUsername?: string | null;
  sealedSecret?: Buffer | null;
  consentAt?: Date | null;
  consentVersion?: string | null;
}

export interface ConnectionRepository {
  /** Creates, or replaces the credentials of an existing company/role pair. */
  create(input: CreateConnectionInput): Promise<Connection>;
  findById(tenantId: string, id: number): Promise<Connection | null>;
  findByIdno(tenantId: string, idno: string, actorRole: number): Promise<Connection | null>;
  list(tenantId: string): Promise<Connection[]>;
  /** The sealed credential. Called by the client factory, by nothing else. */
  secretOf(id: number): Promise<Buffer | null>;
  update(id: number, patch: ConnectionPatch): Promise<void>;
  /** Clears the credential physically and marks the row revoked (SEC-5). */
  revoke(id: number): Promise<void>;
  /** Active connections in the given role whose poll interval has elapsed. */
  duePolling(
    tenantId: string,
    actorRole: number,
    intervalMs: number,
    now: Date,
    limit: number,
  ): Promise<Connection[]>;
}

export interface InboxFilter {
  connectionId?: number;
  buyerIdno?: string;
  supplierIdno?: string;
  decision?: InboxDecision;
  limit: number;
}

export interface InboxPatch {
  invoiceStatus?: number | null;
  decision?: InboxDecision;
  decisionNote?: string | null;
  decisionAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
  xml?: string | null;
  qrText?: string | null;
}

export interface InboxRepository {
  /** Insert or refresh by (supplier, series, number) - the de-duplication key. */
  upsert(document: InboxUpsert): Promise<InboxRow>;
  findById(tenantId: string, id: number): Promise<InboxRow | null>;
  findByKey(tenantId: string, supplierIdno: string, seria: string, number: string): Promise<InboxRow | null>;
  /**
   * Whether this connection already holds a document with these series and
   * number. Used before fetching content, when the supplier - and therefore the
   * de-duplication key - is still unknown.
   */
  hasDocument(tenantId: string, connectionId: number, seria: string, number: string): Promise<boolean>;
  list(tenantId: string, filter: InboxFilter): Promise<InboxRow[]>;
  update(id: number, patch: InboxPatch): Promise<void>;
  /** Documents whose decision is queued and still has to reach SFS. */
  claimPendingDecisions(tenantId: string, limit: number): Promise<InboxRow[]>;
  /** Documents not yet in a terminal e-Factura status, for status refresh. */
  claimForStatusRefresh(tenantId: string, connectionId: number, limit: number): Promise<InboxRow[]>;
  countByDecision(tenantId: string): Promise<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

const CONNECTION_COLUMNS = `
  ID, TENANT_ID, IDNO, TITLE, ACTOR_ROLE, SFS_USERNAME, STATE,
  CONSENT_AT, CONSENT_VERSION, LAST_POLL_AT, LAST_SEEN_AT, LAST_ERROR,
  CREATED_AT, UPDATED_AT
`;

function toConnection(record: Record<string, unknown>): Connection {
  return {
    id: Number(record['ID']),
    tenantId: String(record['TENANT_ID']),
    idno: String(record['IDNO']),
    title: (record['TITLE'] as string | null) ?? null,
    actorRole: Number(record['ACTOR_ROLE']),
    sfsUsername: (record['SFS_USERNAME'] as string | null) ?? null,
    state: String(record['STATE']) as ConnectionState,
    consentAt: (record['CONSENT_AT'] as Date | null) ?? null,
    consentVersion: (record['CONSENT_VERSION'] as string | null) ?? null,
    lastPollAt: (record['LAST_POLL_AT'] as Date | null) ?? null,
    lastSeenAt: (record['LAST_SEEN_AT'] as Date | null) ?? null,
    lastError: (record['LAST_ERROR'] as string | null) ?? null,
    createdAt: record['CREATED_AT'] as Date,
    updatedAt: record['UPDATED_AT'] as Date,
  };
}

export class OracleConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: SqlDriver) {}

  async create(input: CreateConnectionInput): Promise<Connection> {
    const existing = await this.findByIdno(input.tenantId, input.idno, input.actorRole);

    if (existing) {
      // Re-connecting a company replaces its credentials and clears the previous
      // failure, rather than creating a second row for the same pair.
      await this.db.execute(
        `UPDATE EFACT_CONNECTION
            SET SFS_USERNAME = :username, SFS_SECRET = :secret, TITLE = :title,
                STATE = 'pending', CONSENT_AT = :consentAt,
                CONSENT_VERSION = :consentVersion, LAST_ERROR = NULL,
                UPDATED_AT = SYSTIMESTAMP
          WHERE ID = :id`,
        {
          id: existing.id,
          username: input.sfsUsername,
          secret: input.sealedSecret,
          title: input.title ?? existing.title,
          consentAt: input.consentAt,
          consentVersion: input.consentVersion,
        },
      );
      const updated = await this.findById(input.tenantId, existing.id);
      if (!updated) throw new Error(`connection ${existing.id} vanished after update`);
      return updated;
    }

    await this.db.execute(
      `INSERT INTO EFACT_CONNECTION
         (TENANT_ID, IDNO, TITLE, ACTOR_ROLE, SFS_USERNAME, SFS_SECRET, STATE,
          CONSENT_AT, CONSENT_VERSION)
       VALUES (:tenantId, :idno, :title, :actorRole, :username, :secret, 'pending',
               :consentAt, :consentVersion)`,
      {
        tenantId: input.tenantId,
        idno: input.idno,
        title: input.title ?? null,
        actorRole: input.actorRole,
        username: input.sfsUsername,
        secret: input.sealedSecret,
        consentAt: input.consentAt,
        consentVersion: input.consentVersion,
      },
    );

    const created = await this.findByIdno(input.tenantId, input.idno, input.actorRole);
    if (!created) throw new Error(`connection for ${input.idno} vanished after insert`);
    return created;
  }

  async findById(tenantId: string, id: number): Promise<Connection | null> {
    const rows = await this.db.query(
      `SELECT ${CONNECTION_COLUMNS} FROM EFACT_CONNECTION
        WHERE TENANT_ID = :tenantId AND ID = :id`,
      { tenantId, id },
    );
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async findByIdno(tenantId: string, idno: string, actorRole: number): Promise<Connection | null> {
    const rows = await this.db.query(
      `SELECT ${CONNECTION_COLUMNS} FROM EFACT_CONNECTION
        WHERE TENANT_ID = :tenantId AND IDNO = :idno AND ACTOR_ROLE = :actorRole`,
      { tenantId, idno, actorRole },
    );
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async list(tenantId: string): Promise<Connection[]> {
    const rows = await this.db.query(
      `SELECT ${CONNECTION_COLUMNS} FROM EFACT_CONNECTION
        WHERE TENANT_ID = :tenantId ORDER BY ID`,
      { tenantId },
    );
    return rows.map(toConnection);
  }

  async secretOf(id: number): Promise<Buffer | null> {
    const rows = await this.db.query<{ SFS_SECRET: Buffer | null }>(
      `SELECT SFS_SECRET FROM EFACT_CONNECTION WHERE ID = :id`,
      { id },
    );
    return rows[0]?.SFS_SECRET ?? null;
  }

  async update(id: number, patch: ConnectionPatch): Promise<void> {
    const sets: string[] = ['UPDATED_AT = SYSTIMESTAMP'];
    const binds: Record<string, SqlValue> = { id };

    const columns: Array<[keyof ConnectionPatch, string]> = [
      ['state', 'STATE'],
      ['title', 'TITLE'],
      ['lastPollAt', 'LAST_POLL_AT'],
      ['lastSeenAt', 'LAST_SEEN_AT'],
      ['lastError', 'LAST_ERROR'],
      ['sfsUsername', 'SFS_USERNAME'],
      ['sealedSecret', 'SFS_SECRET'],
      ['consentAt', 'CONSENT_AT'],
      ['consentVersion', 'CONSENT_VERSION'],
    ];

    for (const [key, column] of columns) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = :${String(key)}`);
      binds[String(key)] = patch[key] as SqlValue;
    }

    if (sets.length === 1) return;
    await this.db.execute(`UPDATE EFACT_CONNECTION SET ${sets.join(', ')} WHERE ID = :id`, binds);
  }

  async revoke(id: number): Promise<void> {
    // The credential is erased, not flagged: a revoked connection must leave
    // nothing behind that could still be used.
    await this.db.execute(
      `UPDATE EFACT_CONNECTION
          SET STATE = 'revoked', SFS_SECRET = NULL, SFS_USERNAME = NULL,
              LAST_ERROR = NULL, UPDATED_AT = SYSTIMESTAMP
        WHERE ID = :id`,
      { id },
    );
  }

  async duePolling(
    tenantId: string,
    actorRole: number,
    intervalMs: number,
    now: Date,
    limit: number,
  ): Promise<Connection[]> {
    const threshold = new Date(now.getTime() - intervalMs);
    const rows = await this.db.query(
      `SELECT ${CONNECTION_COLUMNS} FROM EFACT_CONNECTION
        WHERE TENANT_ID = :tenantId
          AND ACTOR_ROLE = :actorRole
          AND STATE IN ('pending','active')
          AND (LAST_POLL_AT IS NULL OR LAST_POLL_AT <= :threshold)
        ORDER BY LAST_POLL_AT NULLS FIRST, ID
        FETCH FIRST :limit ROWS ONLY
        FOR UPDATE SKIP LOCKED`,
      { tenantId, actorRole, threshold, limit },
    );
    return rows.map(toConnection);
  }
}

const INBOX_COLUMNS = `
  ID, TENANT_ID, CONNECTION_ID, SERIA, NUMBER_, SUPPLIER_IDNO, SUPPLIER_NAME,
  BUYER_IDNO, ISSUED_AT, TOTAL, TOTAL_VAT, INVOICE_STATUS, DECISION,
  DECISION_NOTE, DECISION_AT, ATTEMPTS, LAST_ERROR, XML, QR_TEXT, SOURCE,
  CREATED_AT, UPDATED_AT
`;

function toInboxRow(record: Record<string, unknown>): InboxRow {
  const number = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);

  return {
    id: Number(record['ID']),
    tenantId: String(record['TENANT_ID']),
    connectionId: Number(record['CONNECTION_ID']),
    seria: String(record['SERIA']),
    number: String(record['NUMBER_']),
    supplierIdno: String(record['SUPPLIER_IDNO']),
    supplierName: (record['SUPPLIER_NAME'] as string | null) ?? null,
    buyerIdno: String(record['BUYER_IDNO']),
    issuedAt: (record['ISSUED_AT'] as Date | null) ?? null,
    total: number(record['TOTAL']),
    totalVat: number(record['TOTAL_VAT']),
    invoiceStatus: number(record['INVOICE_STATUS']),
    decision: String(record['DECISION'] ?? 'none') as InboxDecision,
    decisionNote: (record['DECISION_NOTE'] as string | null) ?? null,
    decisionAt: (record['DECISION_AT'] as Date | null) ?? null,
    attempts: Number(record['ATTEMPTS'] ?? 0),
    lastError: (record['LAST_ERROR'] as string | null) ?? null,
    xml: (record['XML'] as string | null) ?? null,
    qrText: (record['QR_TEXT'] as string | null) ?? null,
    source: String(record['SOURCE']) as InboxRow['source'],
    createdAt: record['CREATED_AT'] as Date,
    updatedAt: record['UPDATED_AT'] as Date,
  };
}

export class OracleInboxRepository implements InboxRepository {
  constructor(private readonly db: SqlDriver) {}

  async upsert(document: InboxUpsert): Promise<InboxRow> {
    const existing = await this.findByKey(
      document.tenantId,
      document.supplierIdno,
      document.seria,
      document.number,
    );

    if (existing) {
      // The same document arriving a second time - from the tax service after
      // the platform, or on a later poll - refreshes what changed and keeps our
      // own decision untouched.
      await this.db.execute(
        `UPDATE EFACT_INBOX
            SET INVOICE_STATUS = NVL(:invoiceStatus, INVOICE_STATUS),
                XML            = NVL(:xml, XML),
                QR_TEXT        = NVL(:qrText, QR_TEXT),
                SUPPLIER_NAME  = NVL(:supplierName, SUPPLIER_NAME),
                TOTAL          = NVL(:total, TOTAL),
                TOTAL_VAT      = NVL(:totalVat, TOTAL_VAT),
                ISSUED_AT      = NVL(:issuedAt, ISSUED_AT),
                UPDATED_AT     = SYSTIMESTAMP
          WHERE ID = :id`,
        {
          id: existing.id,
          invoiceStatus: document.invoiceStatus ?? null,
          xml: document.xml ?? null,
          qrText: document.qrText ?? null,
          supplierName: document.supplierName ?? null,
          total: document.total ?? null,
          totalVat: document.totalVat ?? null,
          issuedAt: document.issuedAt ?? null,
        },
      );
      const refreshed = await this.findById(document.tenantId, existing.id);
      if (!refreshed) throw new Error(`inbox row ${existing.id} vanished after update`);
      return refreshed;
    }

    await this.db.execute(
      `INSERT INTO EFACT_INBOX
         (TENANT_ID, CONNECTION_ID, SERIA, NUMBER_, SUPPLIER_IDNO, SUPPLIER_NAME,
          BUYER_IDNO, ISSUED_AT, TOTAL, TOTAL_VAT, INVOICE_STATUS, XML, QR_TEXT, SOURCE)
       VALUES (:tenantId, :connectionId, :seria, :number_, :supplierIdno, :supplierName,
               :buyerIdno, :issuedAt, :total, :totalVat, :invoiceStatus, :xml, :qrText, :source)`,
      {
        tenantId: document.tenantId,
        connectionId: document.connectionId,
        seria: document.seria,
        number_: document.number,
        supplierIdno: document.supplierIdno,
        supplierName: document.supplierName ?? null,
        buyerIdno: document.buyerIdno,
        issuedAt: document.issuedAt ?? null,
        total: document.total ?? null,
        totalVat: document.totalVat ?? null,
        invoiceStatus: document.invoiceStatus ?? null,
        xml: document.xml ?? null,
        qrText: document.qrText ?? null,
        source: document.source,
      },
    );

    const created = await this.findByKey(
      document.tenantId,
      document.supplierIdno,
      document.seria,
      document.number,
    );
    if (!created) throw new Error('inbox row vanished after insert');
    return created;
  }

  async findById(tenantId: string, id: number): Promise<InboxRow | null> {
    const rows = await this.db.query(
      `SELECT ${INBOX_COLUMNS} FROM EFACT_INBOX WHERE TENANT_ID = :tenantId AND ID = :id`,
      { tenantId, id },
    );
    return rows[0] ? toInboxRow(rows[0]) : null;
  }

  async findByKey(
    tenantId: string,
    supplierIdno: string,
    seria: string,
    number: string,
  ): Promise<InboxRow | null> {
    const rows = await this.db.query(
      `SELECT ${INBOX_COLUMNS} FROM EFACT_INBOX
        WHERE TENANT_ID = :tenantId AND SUPPLIER_IDNO = :supplierIdno
          AND SERIA = :seria AND NUMBER_ = :number_`,
      { tenantId, supplierIdno, seria, number_: number },
    );
    return rows[0] ? toInboxRow(rows[0]) : null;
  }

  async hasDocument(
    tenantId: string,
    connectionId: number,
    seria: string,
    number: string,
  ): Promise<boolean> {
    const rows = await this.db.query<{ CNT: number }>(
      `SELECT COUNT(*) AS CNT FROM EFACT_INBOX
        WHERE TENANT_ID = :tenantId AND CONNECTION_ID = :connectionId
          AND SERIA = :seria AND NUMBER_ = :number_ AND XML IS NOT NULL`,
      { tenantId, connectionId, seria, number_: number },
    );
    return Number(rows[0]?.CNT ?? 0) > 0;
  }

  async list(tenantId: string, filter: InboxFilter): Promise<InboxRow[]> {
    const where: string[] = ['TENANT_ID = :tenantId'];
    const binds: Record<string, SqlValue> = { tenantId, limit: filter.limit };

    if (filter.connectionId !== undefined) {
      where.push('CONNECTION_ID = :connectionId');
      binds['connectionId'] = filter.connectionId;
    }
    if (filter.buyerIdno) {
      where.push('BUYER_IDNO = :buyerIdno');
      binds['buyerIdno'] = filter.buyerIdno;
    }
    if (filter.supplierIdno) {
      where.push('SUPPLIER_IDNO = :supplierIdno');
      binds['supplierIdno'] = filter.supplierIdno;
    }
    if (filter.decision) {
      where.push('DECISION = :decision');
      binds['decision'] = filter.decision;
    }

    const rows = await this.db.query(
      `SELECT ${INBOX_COLUMNS} FROM EFACT_INBOX
        WHERE ${where.join(' AND ')}
        ORDER BY ISSUED_AT DESC NULLS LAST, ID DESC
        FETCH FIRST :limit ROWS ONLY`,
      binds,
    );
    return rows.map(toInboxRow);
  }

  async update(id: number, patch: InboxPatch): Promise<void> {
    const sets: string[] = ['UPDATED_AT = SYSTIMESTAMP'];
    const binds: Record<string, SqlValue> = { id };

    const columns: Array<[keyof InboxPatch, string]> = [
      ['invoiceStatus', 'INVOICE_STATUS'],
      ['decision', 'DECISION'],
      ['decisionNote', 'DECISION_NOTE'],
      ['decisionAt', 'DECISION_AT'],
      ['attempts', 'ATTEMPTS'],
      ['lastError', 'LAST_ERROR'],
      ['xml', 'XML'],
      ['qrText', 'QR_TEXT'],
    ];

    for (const [key, column] of columns) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = :${String(key)}`);
      binds[String(key)] = patch[key] as SqlValue;
    }

    if (sets.length === 1) return;
    await this.db.execute(`UPDATE EFACT_INBOX SET ${sets.join(', ')} WHERE ID = :id`, binds);
  }

  async claimPendingDecisions(tenantId: string, limit: number): Promise<InboxRow[]> {
    const rows = await this.db.query(
      `SELECT ${INBOX_COLUMNS} FROM EFACT_INBOX
        WHERE TENANT_ID = :tenantId AND DECISION IN ('accepting','rejecting')
        ORDER BY DECISION_AT NULLS FIRST, ID
        FETCH FIRST :limit ROWS ONLY
        FOR UPDATE SKIP LOCKED`,
      { tenantId, limit },
    );
    return rows.map(toInboxRow);
  }

  async claimForStatusRefresh(
    tenantId: string,
    connectionId: number,
    limit: number,
  ): Promise<InboxRow[]> {
    // 3, 8 and 10 are terminal; 2 and 5 mean the document is closed as well.
    const rows = await this.db.query(
      `SELECT ${INBOX_COLUMNS} FROM EFACT_INBOX
        WHERE TENANT_ID = :tenantId AND CONNECTION_ID = :connectionId
          AND (INVOICE_STATUS IS NULL OR INVOICE_STATUS NOT IN (2,3,5,8,10))
        ORDER BY UPDATED_AT
        FETCH FIRST :limit ROWS ONLY`,
      { tenantId, connectionId, limit },
    );
    return rows.map(toInboxRow);
  }

  async countByDecision(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ DECISION: string; CNT: number }>(
      `SELECT DECISION, COUNT(*) AS CNT FROM EFACT_INBOX
        WHERE TENANT_ID = :tenantId GROUP BY DECISION`,
      { tenantId },
    );
    return Object.fromEntries(rows.map((row) => [row.DECISION, Number(row.CNT)]));
  }
}
