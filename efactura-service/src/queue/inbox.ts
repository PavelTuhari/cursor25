/**
 * Incoming invoices: the mirror image of the outgoing pipeline.
 *
 * For every active buyer connection the poller asks the tax service what has
 * been issued to that company, fetches anything new in full, refreshes statuses
 * and pushes decisions the user made in the app.
 *
 * Two properties matter more than throughput:
 *
 *   * a document that arrives twice - once from a seller on the platform, once
 *     from the tax service - stays one row (the repository's key does that);
 *   * a rejected credential stops the connection immediately instead of being
 *     retried, because a wrong password does not fix itself.
 */
import type { AppConfig } from '../config/types.js';
import type { Connection, InboxRow } from '../connections/types.js';
import type { AuditRepository } from '../db/repositories.js';
import type { ConnectionRepository, InboxRepository } from '../db/connectionRepo.js';
import { parseInvoiceXml } from '../invoice/parse.js';
import { EFacturaApiError, type EFacturaClient } from '../sfs/client.js';
import { MissingCredentialsError, type EFacturaClientFactory } from '../sfs/clientFactory.js';
import { SoapFaultError } from '../sfs/soap.js';
import { ACTOR_ROLE } from '../config/types.js';
import type { InvoiceIdentifier } from '../sfs/types.js';
import type { Logger } from '../util/logger.js';

export interface InboxDeps {
  config: AppConfig;
  connections: ConnectionRepository;
  inbox: InboxRepository;
  audit: AuditRepository;
  clients: EFacturaClientFactory;
  logger: Logger;
  now?: () => Date;
}

/** A wrong password reads as this; nothing else should stop a connection. */
function isAuthFailure(error: Error): boolean {
  return (
    error instanceof SoapFaultError &&
    /authentication|autorization|authorization/i.test(`${error.message} ${error.faultCode}`)
  );
}

export class InboxPipeline {
  private readonly tenantId: string;

  constructor(private readonly deps: InboxDeps) {
    this.tenantId = deps.config.service.tenantId;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Discovers documents issued to this company since the last successful poll. */
  private async discover(
    client: EFacturaClient,
    connection: Connection,
  ): Promise<InvoiceIdentifier[]> {
    const { inbox } = this.deps.config;
    const found = new Map<string, InvoiceIdentifier>();

    const startDate =
      connection.lastPollAt ??
      new Date(this.now().getTime() - inbox.backfillMonths * 30 * 24 * 3600_000);

    // SearchInvoices requires a status, so we ask for each one we care about
    // rather than trying to express "everything" in a single call.
    for (const status of inbox.trackedStatuses) {
      const response = await client.searchInvoices(
        {
          BuyerIDNO: connection.idno,
          InvoiceStatus: status,
          IssuedOn: { StartDate: startDate },
        },
        ACTOR_ROLE.buyer,
      );

      for (const invoice of response.Results ?? []) {
        if (!invoice.Seria || !invoice.Number) continue;
        found.set(`${invoice.Seria}/${invoice.Number}`, {
          Seria: invoice.Seria,
          Number: invoice.Number,
        });
      }
    }

    return [...found.values()];
  }

  /** Fetches full content for documents we have not stored yet. */
  private async ingest(
    client: EFacturaClient,
    connection: Connection,
    identifiers: InvoiceIdentifier[],
  ): Promise<number> {
    let ingested = 0;

    for (const identifier of identifiers) {
      // The supplier - and therefore the de-duplication key - is unknown until
      // the XML is read, so the "do we have it already" question is asked in
      // terms of what the search did give us.
      const known = await this.deps.inbox.hasDocument(
        this.tenantId,
        connection.id,
        identifier.Seria,
        identifier.Number,
      );
      if (known) continue;

      const response = await client.getInvoicesBySeriaNumber([identifier]);
      const xml = response.Results?.[0]?.Xml;
      if (!xml) continue;

      const parsed = parseInvoiceXml(xml);
      if (!parsed?.supplierIdno) {
        this.deps.logger.warn('inbox.parse.failed', {
          connectionId: connection.id,
          seria: identifier.Seria,
          number: identifier.Number,
        });
        continue;
      }

      // The buyer on the document must be the company we are polling for;
      // anything else means the search returned somebody else's document.
      if (parsed.buyerIdno && parsed.buyerIdno !== connection.idno) {
        this.deps.logger.warn('inbox.buyer.mismatch', {
          connectionId: connection.id,
          expected: connection.idno,
          got: parsed.buyerIdno,
        });
        continue;
      }

      await this.deps.inbox.upsert({
        tenantId: this.tenantId,
        connectionId: connection.id,
        seria: identifier.Seria,
        number: identifier.Number,
        supplierIdno: parsed.supplierIdno,
        supplierName: parsed.supplierName,
        buyerIdno: connection.idno,
        issuedAt: parsed.issuedAt,
        total: parsed.total,
        totalVat: parsed.totalVat,
        invoiceStatus: Number(response.Results?.[0]?.InvoiceStatus ?? 0),
        xml,
        source: 'sfs',
      });
      ingested += 1;
    }

    return ingested;
  }

  /** Refreshes the e-Factura status of documents that are not settled yet. */
  private async refreshStatuses(client: EFacturaClient, connection: Connection): Promise<void> {
    const rows = await this.deps.inbox.claimForStatusRefresh(
      this.tenantId,
      connection.id,
      this.deps.config.inbox.batchSize,
    );
    if (rows.length === 0) return;

    const response = await client.checkInvoicesStatus(
      rows.map((row) => ({ Seria: row.seria, Number: row.number })),
    );
    const byKey = new Map(
      (response.Results ?? []).map((invoice) => [`${invoice.Seria}/${invoice.Number}`, invoice]),
    );

    for (const row of rows) {
      const invoice = byKey.get(`${row.seria}/${row.number}`);
      if (!invoice) continue;
      const status = Number(invoice.InvoiceStatus);
      if (status !== row.invoiceStatus) {
        await this.deps.inbox.update(row.id, { invoiceStatus: status });
      }
    }
  }

  /** One connection, end to end. */
  async pollConnection(connection: Connection): Promise<{ ingested: number }> {
    const started = Date.now();
    let client: EFacturaClient;

    try {
      client = await this.deps.clients.forConnection(connection);
    } catch (error) {
      if (error instanceof MissingCredentialsError) {
        await this.deps.connections.update(connection.id, {
          state: 'invalid',
          lastError: 'credentials are missing or unreadable',
        });
        return { ingested: 0 };
      }
      throw error;
    }

    try {
      const identifiers = await this.discover(client, connection);
      const ingested = await this.ingest(client, connection, identifiers);
      await this.refreshStatuses(client, connection);

      await this.deps.connections.update(connection.id, {
        state: 'active',
        lastPollAt: this.now(),
        lastSeenAt: this.now(),
        lastError: null,
      });

      await this.deps.audit.record({
        tenantId: this.tenantId,
        connectionId: connection.id,
        operation: 'inbox.poll',
        status: 2,
        durationMs: Date.now() - started,
      });

      if (ingested > 0) {
        this.deps.logger.info('inbox.ingested', {
          connectionId: connection.id,
          idno: connection.idno,
          ingested,
        });
      }
      return { ingested };
    } catch (error) {
      const err = error as Error;
      const authFailed = isAuthFailure(err);

      await this.deps.connections.update(connection.id, {
        // A rejected credential is final until its owner re-enters it. Anything
        // else is a blip: keep the connection active and try again next cycle.
        state: authFailed ? 'invalid' : connection.state,
        lastPollAt: this.now(),
        lastError: `${err.name}: ${err.message}`,
      });
      if (authFailed) this.deps.clients.forget(connection.id);

      await this.deps.audit.record({
        tenantId: this.tenantId,
        connectionId: connection.id,
        operation: 'inbox.poll',
        status: 3,
        durationMs: Date.now() - started,
        error: `${err.name}: ${err.message}`,
      });

      this.deps.logger[authFailed ? 'error' : 'warn']('inbox.poll.failed', {
        connectionId: connection.id,
        idno: connection.idno,
        authFailed,
        error: err.message,
      });
      return { ingested: 0 };
    }
  }

  /** Sends decisions the user made in the app up to the tax service. */
  async pushDecisions(): Promise<number> {
    const rows = await this.deps.inbox.claimPendingDecisions(
      this.tenantId,
      this.deps.config.inbox.batchSize,
    );
    let sent = 0;

    for (const row of rows) {
      const connection = await this.deps.connections.findById(this.tenantId, row.connectionId);
      if (!connection || connection.state === 'revoked') {
        await this.deps.inbox.update(row.id, {
          decision: 'failed',
          lastError: 'connection is no longer available',
        });
        continue;
      }

      const started = Date.now();
      try {
        const client = await this.deps.clients.forConnection(connection);
        const identifier = { Seria: row.seria, Number: row.number };

        if (row.decision === 'accepting') {
          await client.postAcceptedInvoices([identifier]);
          await this.deps.inbox.update(row.id, { decision: 'accepted', lastError: null });
        } else {
          await client.postRejectedInvoices([
            { ...identifier, Comment: row.decisionNote ?? '' },
          ]);
          await this.deps.inbox.update(row.id, { decision: 'rejected', lastError: null });
        }

        await this.deps.audit.record({
          tenantId: this.tenantId,
          connectionId: connection.id,
          operation: row.decision === 'accepting' ? 'PostAcceptedInvoices' : 'PostRejectedInvoices',
          status: 2,
          durationMs: Date.now() - started,
        });
        sent += 1;
      } catch (error) {
        await this.failDecision(row, error as Error, connection.id);
      }
    }

    return sent;
  }

  private async failDecision(row: InboxRow, error: Error, connectionId: number): Promise<void> {
    const attempts = row.attempts + 1;
    // A fault or a rejected call will not succeed on retry; a network problem
    // will. Only the latter is worth another attempt.
    const permanent =
      error instanceof SoapFaultError ||
      error instanceof EFacturaApiError ||
      error instanceof MissingCredentialsError ||
      attempts >= this.deps.config.inbox.maxAttempts;

    await this.deps.inbox.update(row.id, {
      attempts,
      lastError: `${error.name}: ${error.message}`,
      decision: permanent ? 'failed' : row.decision,
    });

    await this.deps.audit.record({
      tenantId: this.tenantId,
      connectionId,
      operation: 'inbox.decision',
      status: 3,
      error: `${error.name}: ${error.message}`,
    });

    this.deps.logger[permanent ? 'error' : 'warn']('inbox.decision.failed', {
      inboxId: row.id,
      attempts,
      permanent,
      error: error.message,
    });
  }

  /** One full cycle over every connection that is due. */
  async tick(): Promise<{ connections: number; ingested: number; decisions: number }> {
    const { inbox } = this.deps.config;
    if (!inbox.enabled) return { connections: 0, ingested: 0, decisions: 0 };

    const due = await this.deps.connections.duePolling(
      this.tenantId,
      ACTOR_ROLE.buyer,
      inbox.pollIntervalMs,
      this.now(),
      inbox.connectionsPerTick,
    );

    let ingested = 0;
    for (const connection of due) {
      const result = await this.pollConnection(connection);
      ingested += result.ingested;
    }

    const decisions = await this.pushDecisions();
    return { connections: due.length, ingested, decisions };
  }
}
