/**
 * The REST face of the service.
 *
 * UNA (or any other caller) hands over a document and asks about it later; it
 * never speaks SOAP, never holds a certificate and never needs to know an
 * invoice status code. Built on node:http so the service has no web framework
 * to keep patched at a client site.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '../config/types.js';
import { documentFromJson, serializeDocument } from '../invoice/serialize.js';
import { validateDocument } from '../invoice/validate.js';
import type { OutboxRow } from '../invoice/types.js';
import type { OutboxRepository } from '../db/repositories.js';
import type { EFacturaClient } from '../sfs/client.js';
import { INVOICE_STATUS_NAME } from '../sfs/types.js';
import type { Pipeline } from '../queue/pipeline.js';
import type { ConnectionRoutes } from './routes/connections.js';
import type { Logger } from '../util/logger.js';

export interface HttpDeps {
  config: AppConfig;
  outbox: OutboxRepository;
  client: EFacturaClient;
  pipeline: Pipeline;
  logger: Logger;
  /** Connections and inbox. Absent when the service only issues invoices. */
  connectionRoutes?: ConnectionRoutes;
  /** Reports database reachability for /ready. */
  ping?: () => Promise<boolean>;
}

interface Handled {
  status: number;
  body: unknown;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function publicView(row: OutboxRow) {
  return {
    externalId: row.externalId,
    state: row.state,
    seria: row.seria,
    number: row.number,
    invoiceStatus: row.invoiceStatus,
    invoiceStatusName:
      row.invoiceStatus === null ? null : (INVOICE_STATUS_NAME[row.invoiceStatus] ?? 'unknown'),
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A runaway upload must not become a heap problem.
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class HttpApi {
  private server: Server | null = null;

  constructor(private readonly deps: HttpDeps) {}

  private authorised(request: IncomingMessage): boolean {
    const expected = this.deps.config.service.apiToken;
    if (!expected) return true;
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    return provided !== '' && tokenMatches(expected, provided);
  }

  private async route(
    method: string,
    path: string,
    request: IncomingMessage,
  ): Promise<Handled> {
    const tenantId = this.deps.config.service.tenantId;

    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true, service: this.deps.config.service.name } };
    }

    if (method === 'GET' && path === '/ready') {
      const database = this.deps.ping ? await this.deps.ping().catch(() => false) : true;
      return {
        status: database ? 200 : 503,
        body: { ok: database, database, signing: this.deps.config.signing.mode },
      };
    }

    if (method === 'GET' && path === '/stats') {
      const outgoing = await this.deps.outbox.countByState(tenantId);
      const incoming = this.deps.connectionRoutes
        ? await this.deps.connectionRoutes.stats()
        : undefined;
      return { status: 200, body: incoming ? { outgoing, incoming } : outgoing };
    }

    if (this.deps.connectionRoutes) {
      // Body errors here are the caller's, same as on POST /invoices, so the
      // read is wrapped rather than left to bubble up as a 500.
      let handled;
      try {
        handled = await this.deps.connectionRoutes.handle(method, path, () => readBody(request));
      } catch (error) {
        if (error instanceof SyntaxError || /body is too large/.test((error as Error).message)) {
          return { status: 400, body: { error: (error as Error).message } };
        }
        throw error;
      }
      if (handled) return handled;
    }

    if (method === 'POST' && path === '/invoices') {
      let document;
      try {
        // Reading and parsing share the handler: a truncated upload and a
        // malformed body are both the caller's problem, not a server error.
        document = documentFromJson(await readBody(request));
      } catch (error) {
        return { status: 400, body: { error: (error as Error).message } };
      }

      const errors = validateDocument(document);
      if (errors.length > 0) {
        // Rejecting here rather than in the worker means the caller learns about
        // a bad document while it still has the context to fix it.
        return { status: 422, body: { error: 'invalid document', details: errors } };
      }

      const row = await this.deps.outbox.enqueue({
        tenantId,
        externalId: document.externalId,
        payload: serializeDocument(document),
        seria: document.seria ?? null,
        number: document.number ?? null,
      });
      return { status: 202, body: publicView(row) };
    }

    if (method === 'GET' && path === '/invoices') {
      const rows = await this.deps.outbox.list(tenantId, { limit: 100 });
      return { status: 200, body: rows.map(publicView) };
    }

    const invoiceMatch = /^\/invoices\/([^/]+)(?:\/(pdf|qr|xml))?$/.exec(path);
    if (method === 'GET' && invoiceMatch) {
      const externalId = decodeURIComponent(invoiceMatch[1]!);
      const row = await this.deps.outbox.findByExternalId(tenantId, externalId);
      if (!row) return { status: 404, body: { error: `unknown invoice ${externalId}` } };

      const sub = invoiceMatch[2];
      if (!sub) return { status: 200, body: publicView(row) };

      if (!row.seria || !row.number) {
        return { status: 409, body: { error: 'invoice has no series/number yet', state: row.state } };
      }

      if (sub === 'xml') {
        return { status: 200, body: { xml: row.signedXml ?? row.xml } };
      }

      const identifier = [{ Seria: row.seria, Number: row.number }];
      if (sub === 'qr') {
        const response = await this.deps.client.getInvoicesQRcodes(identifier);
        const qr = response.Results?.[0];
        return {
          status: qr ? 200 : 404,
          body: qr ? { text: qr.QRCodeText, pngBase64: qr.QRCode } : { error: 'no QR code yet' },
        };
      }

      const response = await this.deps.client.getInvoicesContentForPrint(identifier);
      const content = response.Result;
      return {
        status: content?.Content ? 200 : 404,
        body: content?.Content
          ? { format: content.Format ?? 'pdf', contentBase64: content.Content }
          : { error: 'no printable content yet' },
      };
    }

    const taxpayerMatch = /^\/taxpayers\/(\d{13})$/.exec(path);
    if (method === 'GET' && taxpayerMatch) {
      const response = await this.deps.client.getTaxpayersInfo([taxpayerMatch[1]!]);
      const taxpayer = response.Results?.[0];
      return {
        status: taxpayer ? 200 : 404,
        body: taxpayer ?? { error: `unknown taxpayer ${taxpayerMatch[1]}` },
      };
    }

    if (method === 'POST' && path === '/tick') {
      return { status: 200, body: await this.deps.pipeline.tick() };
    }

    return { status: 404, body: { error: `no route for ${method} ${path}` } };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const basePath = this.deps.config.service.http.basePath.replace(/\/$/, '');
    const path = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname;

    let result: Handled;
    try {
      // /health stays open so an orchestrator can probe it without a token.
      if (path !== '/health' && !this.authorised(request)) {
        result = { status: 401, body: { error: 'missing or invalid bearer token' } };
      } else {
        result = await this.route(request.method ?? 'GET', path, request);
      }
    } catch (error) {
      const err = error as Error;
      this.deps.logger.error('http.error', { path, error: err.message });
      result = { status: 500, body: { error: err.message } };
    }

    const payload = JSON.stringify(result.body ?? null);
    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    response.end(payload);

    this.deps.logger.debug('http.request', {
      method: request.method,
      path,
      status: result.status,
      ms: Date.now() - started,
    });
  }

  async listen(): Promise<void> {
    const { host, port } = this.deps.config.service.http;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    this.deps.logger.info('http.listening', {
      host,
      port,
      basePath: this.deps.config.service.http.basePath,
      authenticated: this.deps.config.service.apiToken !== '',
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
