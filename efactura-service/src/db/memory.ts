/**
 * In-memory repositories.
 *
 * Used by the tests and by `EFACT__ORACLE__CONNECTSTRING=memory`, which is how
 * the service is demonstrated on a laptop against the SFS mock before anyone
 * has provisioned a database.
 */
import type { OutboxRow, OutboxState } from '../invoice/types.js';
import type {
  AuditEntry,
  AuditRecord,
  AuditRepository,
  EnqueueInput,
  OutboxRepository,
  OutboxUpdate,
  SeriesRepository,
  SeriesRow,
} from './repositories.js';

export class MemoryOutboxRepository implements OutboxRepository {
  private readonly rows = new Map<number, OutboxRow>();
  private nextId = 1;

  async enqueue(input: EnqueueInput): Promise<OutboxRow> {
    const existing = await this.findByExternalId(input.tenantId, input.externalId);
    if (existing) return existing;

    const now = new Date();
    const row: OutboxRow = {
      id: this.nextId++,
      tenantId: input.tenantId,
      externalId: input.externalId,
      seria: input.seria ?? null,
      number: input.number ?? null,
      state: 'pending',
      invoiceStatus: null,
      attempts: 0,
      lastError: null,
      payload: input.payload,
      xml: null,
      signedXml: null,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(id: number): Promise<OutboxRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findByExternalId(tenantId: string, externalId: string): Promise<OutboxRow | null> {
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && row.externalId === externalId) return { ...row };
    }
    return null;
  }

  async findBySeriaNumber(
    tenantId: string,
    seria: string,
    number: string,
  ): Promise<OutboxRow | null> {
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && row.seria === seria && row.number === number) {
        return { ...row };
      }
    }
    return null;
  }

  async claimDue(
    tenantId: string,
    states: OutboxState[],
    limit: number,
    now: Date,
  ): Promise<OutboxRow[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          states.includes(row.state) &&
          (row.nextAttemptAt === null || row.nextAttemptAt.getTime() <= now.getTime()),
      )
      .sort((a, b) => (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0) || a.id - b.id)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async update(id: number, patch: OutboxUpdate): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    Object.assign(row, patch, { updatedAt: new Date() });
  }

  async list(
    tenantId: string,
    filter: { state?: OutboxState; limit: number },
  ): Promise<OutboxRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === tenantId && (!filter.state || row.state === filter.state))
      .sort((a, b) => b.id - a.id)
      .slice(0, filter.limit)
      .map((row) => ({ ...row }));
  }

  async countByState(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of this.rows.values()) {
      if (row.tenantId !== tenantId) continue;
      counts[row.state] = (counts[row.state] ?? 0) + 1;
    }
    return counts;
  }
}

export class MemorySeriesRepository implements SeriesRepository {
  private readonly rows: Array<{
    id: number;
    tenantId: string;
    seria: string;
    number: string;
    invoiceType: number;
    state: 'free' | 'taken' | 'used' | 'void';
    outboxId: number | null;
  }> = [];
  private nextId = 1;

  async addMany(
    tenantId: string,
    invoiceType: number,
    pairs: { seria: string; number: string }[],
  ): Promise<number> {
    let inserted = 0;
    for (const pair of pairs) {
      const duplicate = this.rows.some(
        (row) =>
          row.tenantId === tenantId && row.seria === pair.seria && row.number === pair.number,
      );
      if (duplicate) continue;
      this.rows.push({
        id: this.nextId++,
        tenantId,
        seria: pair.seria,
        number: pair.number,
        invoiceType,
        state: 'free',
        outboxId: null,
      });
      inserted += 1;
    }
    return inserted;
  }

  async countFree(tenantId: string, invoiceType: number): Promise<number> {
    return this.rows.filter(
      (row) => row.tenantId === tenantId && row.invoiceType === invoiceType && row.state === 'free',
    ).length;
  }

  async take(tenantId: string, invoiceType: number, outboxId: number): Promise<SeriesRow | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.tenantId === tenantId &&
        candidate.invoiceType === invoiceType &&
        candidate.state === 'free',
    );
    if (!row) return null;
    row.state = 'taken';
    row.outboxId = outboxId;
    return { id: row.id, seria: row.seria, number: row.number };
  }

  async markUsed(id: number): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) row.state = 'used';
  }
}

export class MemoryAuditRepository implements AuditRepository {
  readonly entries: AuditEntry[] = [];
  private nextId = 1;
  private readonly records: AuditRecord[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    this.records.push({ ...entry, id: this.nextId++, createdAt: new Date() });
  }

  async listByConnection(
    tenantId: string,
    connectionId: number,
    limit: number,
  ): Promise<AuditRecord[]> {
    return this.records
      .filter((entry) => entry.tenantId === tenantId && entry.connectionId === connectionId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }
}
