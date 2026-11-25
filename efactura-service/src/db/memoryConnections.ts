/**
 * In-memory connections and inbox, mirroring the Oracle implementations.
 *
 * These carry sealed credentials in process memory, exactly as the database
 * carries them on disk: still encrypted, still opened only by the client
 * factory. The store being volatile is not a licence to hold plaintext.
 */
import type {
  Connection,
  ConnectionState,
  InboxDecision,
  InboxRow,
  InboxUpsert,
} from '../connections/types.js';
import type {
  ConnectionPatch,
  ConnectionRepository,
  CreateConnectionInput,
  InboxFilter,
  InboxPatch,
  InboxRepository,
} from './connectionRepo.js';

interface StoredConnection extends Connection {
  sealedSecret: Buffer | null;
}

export class MemoryConnectionRepository implements ConnectionRepository {
  private readonly rows = new Map<number, StoredConnection>();
  private nextId = 1;

  async create(input: CreateConnectionInput): Promise<Connection> {
    const existing = [...this.rows.values()].find(
      (row) =>
        row.tenantId === input.tenantId &&
        row.idno === input.idno &&
        row.actorRole === input.actorRole,
    );

    if (existing) {
      existing.sfsUsername = input.sfsUsername;
      existing.sealedSecret = input.sealedSecret;
      existing.title = input.title ?? existing.title;
      existing.state = 'pending';
      existing.consentAt = input.consentAt;
      existing.consentVersion = input.consentVersion;
      existing.lastError = null;
      existing.updatedAt = new Date();
      return this.strip(existing);
    }

    const now = new Date();
    const row: StoredConnection = {
      id: this.nextId++,
      tenantId: input.tenantId,
      idno: input.idno,
      title: input.title ?? null,
      actorRole: input.actorRole,
      sfsUsername: input.sfsUsername,
      sealedSecret: input.sealedSecret,
      state: 'pending',
      consentAt: input.consentAt,
      consentVersion: input.consentVersion,
      lastPollAt: null,
      lastSeenAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return this.strip(row);
  }

  /** Copies without the sealed credential, so callers cannot reach it by accident. */
  private strip(row: StoredConnection): Connection {
    const { sealedSecret: _sealed, ...rest } = row;
    return { ...rest };
  }

  async findById(tenantId: string, id: number): Promise<Connection | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? this.strip(row) : null;
  }

  async findByIdno(tenantId: string, idno: string, actorRole: number): Promise<Connection | null> {
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && row.idno === idno && row.actorRole === actorRole) {
        return this.strip(row);
      }
    }
    return null;
  }

  async list(tenantId: string): Promise<Connection[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => a.id - b.id)
      .map((row) => this.strip(row));
  }

  async secretOf(id: number): Promise<Buffer | null> {
    return this.rows.get(id)?.sealedSecret ?? null;
  }

  async update(id: number, patch: ConnectionPatch): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    Object.assign(row, patch, { updatedAt: new Date() });
  }

  async revoke(id: number): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.state = 'revoked';
    row.sealedSecret = null;
    row.sfsUsername = null;
    row.lastError = null;
    row.updatedAt = new Date();
  }

  async duePolling(
    tenantId: string,
    actorRole: number,
    intervalMs: number,
    now: Date,
    limit: number,
  ): Promise<Connection[]> {
    const threshold = now.getTime() - intervalMs;
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.actorRole === actorRole &&
          (row.state === 'active' || row.state === 'pending') &&
          (row.lastPollAt === null || row.lastPollAt.getTime() <= threshold),
      )
      .sort((a, b) => (a.lastPollAt?.getTime() ?? 0) - (b.lastPollAt?.getTime() ?? 0) || a.id - b.id)
      .slice(0, limit)
      .map((row) => this.strip(row));
  }
}

export class MemoryInboxRepository implements InboxRepository {
  private readonly rows = new Map<number, InboxRow>();
  private nextId = 1;

  private key(tenantId: string, supplierIdno: string, seria: string, number: string): string {
    return `${tenantId}|${supplierIdno}|${seria}|${number}`;
  }

  async upsert(document: InboxUpsert): Promise<InboxRow> {
    const existing = await this.findByKey(
      document.tenantId,
      document.supplierIdno,
      document.seria,
      document.number,
    );

    if (existing) {
      const row = this.rows.get(existing.id)!;
      // Refresh what the source knows; never touch our own decision.
      if (document.invoiceStatus !== undefined && document.invoiceStatus !== null) {
        row.invoiceStatus = document.invoiceStatus;
      }
      if (document.xml) row.xml = document.xml;
      if (document.qrText) row.qrText = document.qrText;
      if (document.supplierName) row.supplierName = document.supplierName;
      if (document.total !== undefined && document.total !== null) row.total = document.total;
      if (document.totalVat !== undefined && document.totalVat !== null) {
        row.totalVat = document.totalVat;
      }
      if (document.issuedAt) row.issuedAt = document.issuedAt;
      row.updatedAt = new Date();
      return { ...row };
    }

    const now = new Date();
    const row: InboxRow = {
      id: this.nextId++,
      tenantId: document.tenantId,
      connectionId: document.connectionId,
      seria: document.seria,
      number: document.number,
      supplierIdno: document.supplierIdno,
      supplierName: document.supplierName ?? null,
      buyerIdno: document.buyerIdno,
      issuedAt: document.issuedAt ?? null,
      total: document.total ?? null,
      totalVat: document.totalVat ?? null,
      invoiceStatus: document.invoiceStatus ?? null,
      decision: 'none',
      decisionNote: null,
      decisionAt: null,
      attempts: 0,
      lastError: null,
      xml: document.xml ?? null,
      qrText: document.qrText ?? null,
      source: document.source,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(tenantId: string, id: number): Promise<InboxRow | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? { ...row } : null;
  }

  async findByKey(
    tenantId: string,
    supplierIdno: string,
    seria: string,
    number: string,
  ): Promise<InboxRow | null> {
    const wanted = this.key(tenantId, supplierIdno, seria, number);
    for (const row of this.rows.values()) {
      if (this.key(row.tenantId, row.supplierIdno, row.seria, row.number) === wanted) {
        return { ...row };
      }
    }
    return null;
  }

  async hasDocument(
    tenantId: string,
    connectionId: number,
    seria: string,
    number: string,
  ): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (
        row.tenantId === tenantId &&
        row.connectionId === connectionId &&
        row.seria === seria &&
        row.number === number &&
        row.xml
      ) {
        return true;
      }
    }
    return false;
  }

  async list(tenantId: string, filter: InboxFilter): Promise<InboxRow[]> {
    return [...this.rows.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter.connectionId !== undefined && row.connectionId !== filter.connectionId) return false;
        if (filter.buyerIdno && row.buyerIdno !== filter.buyerIdno) return false;
        if (filter.supplierIdno && row.supplierIdno !== filter.supplierIdno) return false;
        if (filter.decision && row.decision !== filter.decision) return false;
        return true;
      })
      .sort(
        (a, b) =>
          (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0) || b.id - a.id,
      )
      .slice(0, filter.limit)
      .map((row) => ({ ...row }));
  }

  async update(id: number, patch: InboxPatch): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    Object.assign(row, patch, { updatedAt: new Date() });
  }

  async claimPendingDecisions(tenantId: string, limit: number): Promise<InboxRow[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          (row.decision === 'accepting' || row.decision === 'rejecting'),
      )
      .sort((a, b) => (a.decisionAt?.getTime() ?? 0) - (b.decisionAt?.getTime() ?? 0) || a.id - b.id)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async claimForStatusRefresh(
    tenantId: string,
    connectionId: number,
    limit: number,
  ): Promise<InboxRow[]> {
    const terminal = new Set([2, 3, 5, 8, 10]);
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.connectionId === connectionId &&
          (row.invoiceStatus === null || !terminal.has(row.invoiceStatus)),
      )
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async countByDecision(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of this.rows.values()) {
      if (row.tenantId !== tenantId) continue;
      counts[row.decision] = (counts[row.decision] ?? 0) + 1;
    }
    return counts;
  }
}

export type { ConnectionState, InboxDecision };
