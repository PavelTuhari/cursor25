/**
 * Routes for connections and the inbox.
 *
 * Kept in their own module because they carry the one thing the rest of the
 * service does not: credentials belonging to other companies. Everything here
 * is written so that a password enters through exactly one function and never
 * comes back out.
 */
import type { AppConfig } from '../../config/types.js';
import { toConnectionView, type InboxRow } from '../../connections/types.js';
import type { AuditRepository } from '../../db/repositories.js';
import type { ConnectionRepository, InboxRepository } from '../../db/connectionRepo.js';
import type { EFacturaClientFactory } from '../../sfs/clientFactory.js';
import { INVOICE_STATUS_NAME } from '../../sfs/types.js';
import { SoapFaultError } from '../../sfs/soap.js';
import type { SecretBox } from '../../crypto/secretBox.js';
import type { InboxPipeline } from '../../queue/inbox.js';
import type { Logger } from '../../util/logger.js';

export interface Handled {
  status: number;
  body: unknown;
}

export interface ConnectionRoutesDeps {
  config: AppConfig;
  connections: ConnectionRepository;
  inbox: InboxRepository;
  audit: AuditRepository;
  clients: EFacturaClientFactory;
  secretBox: SecretBox | null;
  pipeline: InboxPipeline | null;
  logger: Logger;
}

const FISCAL_CODE = /^\d{13}$/;

/** What a document looks like to the app. No XML, no PDF - those have own routes. */
function inboxView(row: InboxRow) {
  return {
    id: row.id,
    seria: row.seria,
    number: row.number,
    supplierIdno: row.supplierIdno,
    supplierName: row.supplierName,
    buyerIdno: row.buyerIdno,
    issuedAt: row.issuedAt,
    total: row.total,
    totalVat: row.totalVat,
    invoiceStatus: row.invoiceStatus,
    invoiceStatusName:
      row.invoiceStatus === null ? null : (INVOICE_STATUS_NAME[row.invoiceStatus] ?? 'unknown'),
    decision: row.decision,
    decisionNote: row.decisionNote,
    lastError: row.lastError,
    source: row.source,
    hasXml: Boolean(row.xml),
    updatedAt: row.updatedAt,
  };
}

export class ConnectionRoutes {
  private readonly tenantId: string;

  constructor(private readonly deps: ConnectionRoutesDeps) {
    this.tenantId = deps.config.service.tenantId;
  }

  /** Counters for the incoming side, folded into `GET /stats`. */
  async stats(): Promise<Record<string, unknown>> {
    const connections = await this.deps.connections.list(this.tenantId);
    const byState: Record<string, number> = {};
    for (const connection of connections) {
      byState[connection.state] = (byState[connection.state] ?? 0) + 1;
    }

    const lastPoll = connections
      .map((connection) => connection.lastPollAt)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      connections: byState,
      documents: await this.deps.inbox.countByDecision(this.tenantId),
      lastPollAt: lastPoll ?? null,
    };
  }

  /** Returns null when the path is not ours, so the caller can keep matching. */
  async handle(
    method: string,
    path: string,
    body: () => Promise<unknown>,
  ): Promise<Handled | null> {
    if (!this.deps.secretBox) {
      // Without a key we cannot seal anything, so refuse rather than store a
      // credential in the clear.
      if (path.startsWith('/connections') || path.startsWith('/inbox')) {
        return {
          status: 503,
          body: { error: 'inbox is disabled: crypto.key is not configured' },
        };
      }
      return null;
    }

    if (method === 'POST' && path === '/connections') return this.create(await body());
    if (method === 'GET' && path === '/connections') return this.list();

    const verify = /^\/connections\/(\d+)\/verify$/.exec(path);
    if (method === 'POST' && verify) return this.verify(Number(verify[1]));

    const audit = /^\/connections\/(\d+)\/audit$/.exec(path);
    if (method === 'GET' && audit) return this.audit(Number(audit[1]));

    const single = /^\/connections\/(\d+)$/.exec(path);
    if (single) {
      const id = Number(single[1]);
      if (method === 'GET') return this.one(id);
      if (method === 'DELETE') return this.revoke(id);
    }

    if (method === 'GET' && path === '/inbox') return this.inboxList();

    const inboxSub = /^\/inbox\/(\d+)(?:\/(pdf|xml|qr|accept|reject))?$/.exec(path);
    if (inboxSub) {
      const id = Number(inboxSub[1]);
      const action = inboxSub[2];
      if (method === 'GET' && !action) return this.inboxOne(id);
      if (method === 'GET' && action) return this.inboxAttachment(id, action);
      if (method === 'POST' && action === 'accept') return this.decide(id, 'accepting', null);
      if (method === 'POST' && action === 'reject') {
        const payload = (await body()) as { comment?: unknown } | undefined;
        const comment = typeof payload?.comment === 'string' ? payload.comment.trim() : '';
        if (comment === '') {
          // The tax service passes the comment on to the supplier; an empty one
          // helps nobody and cannot be corrected afterwards.
          return { status: 422, body: { error: 'a comment is required to reject an invoice' } };
        }
        return this.decide(id, 'rejecting', comment);
      }
    }

    if (method === 'POST' && path === '/inbox/tick') {
      if (!this.deps.pipeline) return { status: 503, body: { error: 'inbox worker is disabled' } };
      return { status: 200, body: await this.deps.pipeline.tick() };
    }

    return null;
  }

  // -------------------------------------------------------------- connections

  private async create(payload: unknown): Promise<Handled> {
    const input = (payload ?? {}) as Record<string, unknown>;
    const idno = String(input['idno'] ?? '').trim();
    const username = String(input['sfsUsername'] ?? '').trim();
    const password = String(input['sfsPassword'] ?? '');
    const actorRole = Number(input['actorRole'] ?? 2);
    const consent = input['consentAccepted'] === true;

    const errors: string[] = [];
    if (!FISCAL_CODE.test(idno)) errors.push('idno must be 13 digits');
    if (username === '') errors.push('sfsUsername is required');
    if (password === '') errors.push('sfsPassword is required');
    if (![1, 2, 3].includes(actorRole)) errors.push('actorRole must be 1, 2 or 3');
    // No consent, no connection - and the password is discarded unread.
    if (!consent) errors.push('consentAccepted must be true');
    if (errors.length > 0) return { status: 422, body: { error: 'invalid connection', details: errors } };

    // Verify before storing: a credential that does not work should never
    // become a row that the poller keeps retrying.
    const probe = this.deps.clients.probe(username, password, actorRole);
    try {
      await probe.test();
    } catch (error) {
      const err = error as Error;
      const rejected = err instanceof SoapFaultError;
      return {
        status: rejected ? 422 : 502,
        body: {
          error: rejected
            ? 'the tax service rejected these credentials'
            : 'could not reach the tax service to verify the credentials',
          detail: err.message,
        },
      };
    }

    let title: string | null = null;
    try {
      const taxpayer = await probe.getTaxpayersInfo([idno]);
      title = taxpayer.Results?.[0]?.Name ?? null;
    } catch {
      // A missing name is cosmetic; the connection is still usable.
    }

    const connection = await this.deps.connections.create({
      tenantId: this.tenantId,
      idno,
      title,
      actorRole,
      sfsUsername: username,
      sealedSecret: this.deps.secretBox!.seal(password),
      consentVersion: this.deps.config.crypto.consentVersion,
      consentAt: new Date(),
    });

    await this.deps.connections.update(connection.id, { state: 'active' });
    this.deps.clients.forget(connection.id);

    await this.deps.audit.record({
      tenantId: this.tenantId,
      connectionId: connection.id,
      operation: 'connection.created',
      status: 2,
    });
    this.deps.logger.info('connection.created', {
      connectionId: connection.id,
      idno,
      actorRole,
    });

    return { status: 201, body: toConnectionView({ ...connection, state: 'active' }) };
  }

  private async list(): Promise<Handled> {
    const rows = await this.deps.connections.list(this.tenantId);
    return { status: 200, body: rows.map(toConnectionView) };
  }

  private async one(id: number): Promise<Handled> {
    const connection = await this.deps.connections.findById(this.tenantId, id);
    if (!connection) return { status: 404, body: { error: `unknown connection ${id}` } };
    return { status: 200, body: toConnectionView(connection) };
  }

  private async verify(id: number): Promise<Handled> {
    const connection = await this.deps.connections.findById(this.tenantId, id);
    if (!connection) return { status: 404, body: { error: `unknown connection ${id}` } };

    try {
      const client = await this.deps.clients.forConnection(connection);
      await client.test();
      await this.deps.connections.update(id, { state: 'active', lastError: null });
      return { status: 200, body: { ok: true, state: 'active' } };
    } catch (error) {
      const err = error as Error;
      await this.deps.connections.update(id, { state: 'invalid', lastError: err.message });
      this.deps.clients.forget(id);
      return { status: 200, body: { ok: false, state: 'invalid', detail: err.message } };
    }
  }

  private async revoke(id: number): Promise<Handled> {
    const connection = await this.deps.connections.findById(this.tenantId, id);
    if (!connection) return { status: 404, body: { error: `unknown connection ${id}` } };

    await this.deps.connections.revoke(id);
    this.deps.clients.forget(id);

    await this.deps.audit.record({
      tenantId: this.tenantId,
      connectionId: id,
      operation: 'connection.revoked',
      status: 2,
    });
    this.deps.logger.info('connection.revoked', { connectionId: id, idno: connection.idno });

    return { status: 200, body: { revoked: true, id } };
  }

  private async audit(id: number): Promise<Handled> {
    const connection = await this.deps.connections.findById(this.tenantId, id);
    if (!connection) return { status: 404, body: { error: `unknown connection ${id}` } };
    const records = await this.deps.audit.listByConnection(this.tenantId, id, 200);
    return { status: 200, body: records };
  }

  // -------------------------------------------------------------------- inbox

  private async inboxList(): Promise<Handled> {
    const rows = await this.deps.inbox.list(this.tenantId, { limit: 200 });
    return { status: 200, body: rows.map(inboxView) };
  }

  private async inboxOne(id: number): Promise<Handled> {
    const row = await this.deps.inbox.findById(this.tenantId, id);
    if (!row) return { status: 404, body: { error: `unknown invoice ${id}` } };
    return { status: 200, body: inboxView(row) };
  }

  private async inboxAttachment(id: number, kind: string): Promise<Handled> {
    const row = await this.deps.inbox.findById(this.tenantId, id);
    if (!row) return { status: 404, body: { error: `unknown invoice ${id}` } };

    if (kind === 'xml') {
      return row.xml
        ? { status: 200, body: { xml: row.xml } }
        : { status: 409, body: { error: 'the document content has not been fetched yet' } };
    }

    const connection = await this.deps.connections.findById(this.tenantId, row.connectionId);
    if (!connection || connection.state === 'revoked') {
      return { status: 409, body: { error: 'the connection for this document is no longer available' } };
    }

    const client = await this.deps.clients.forConnection(connection);
    const identifier = [{ Seria: row.seria, Number: row.number }];

    if (kind === 'qr') {
      const response = await client.getInvoicesQRcodes(identifier);
      const qr = response.Results?.[0];
      return qr
        ? { status: 200, body: { text: qr.QRCodeText, pngBase64: qr.QRCode } }
        : { status: 404, body: { error: 'no QR code for this document' } };
    }

    const response = await client.getInvoicesContentForPrint(identifier, {
      actorRole: connection.actorRole,
    });
    const content = response.Result;
    return content?.Content
      ? { status: 200, body: { format: content.Format ?? 'pdf', contentBase64: content.Content } }
      : { status: 404, body: { error: 'no printable content for this document' } };
  }

  private async decide(
    id: number,
    decision: 'accepting' | 'rejecting',
    comment: string | null,
  ): Promise<Handled> {
    const row = await this.deps.inbox.findById(this.tenantId, id);
    if (!row) return { status: 404, body: { error: `unknown invoice ${id}` } };

    if (row.decision !== 'none' && row.decision !== 'failed') {
      // A decision already on its way or already made is not something to
      // silently overwrite: in the tax service it is a legally meaningful act.
      return {
        status: 409,
        body: { error: `invoice ${id} is already ${row.decision}`, decision: row.decision },
      };
    }

    await this.deps.inbox.update(id, {
      decision,
      decisionNote: comment,
      decisionAt: new Date(),
      attempts: 0,
      lastError: null,
    });

    // Queued, not sent: it reaches the tax service on the next cycle, which is
    // also what makes the action survive a request that dies mid-flight.
    const updated = await this.deps.inbox.findById(this.tenantId, id);
    return { status: 202, body: inboxView(updated!) };
  }
}
