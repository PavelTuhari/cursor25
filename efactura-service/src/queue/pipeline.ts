/**
 * The outbox pipeline: pending -> reserved -> built -> signed -> posted -> confirmed.
 *
 * Each step commits its result before the next one starts, so a crash resumes
 * from where it stopped rather than re-sending an invoice. That matters more
 * than throughput here: a duplicate fiscal invoice is a problem for the
 * accountant, a delayed one is not.
 */
import type { AppConfig } from '../config/types.js';
import type { InvoiceDocument, OutboxRow } from '../invoice/types.js';
import { assertValidDocument, InvoiceValidationError } from '../invoice/validate.js';
import { parseDocument } from '../invoice/serialize.js';
import { buildDocumentsXml } from '../invoice/xml.js';
import { EFacturaApiError, type EFacturaClient } from '../sfs/client.js';
import { SoapFaultError, SoapTransportError } from '../sfs/soap.js';
import { INVOICE_STATUS, type InvoiceIdentifier } from '../sfs/types.js';
import type { Signer } from '../sign/index.js';
import type { Logger } from '../util/logger.js';
import type {
  AuditRepository,
  OutboxRepository,
  SeriesRepository,
} from '../db/repositories.js';

export interface PipelineDeps {
  config: AppConfig;
  outbox: OutboxRepository;
  series: SeriesRepository;
  audit: AuditRepository;
  client: EFacturaClient;
  signer: Signer;
  logger: Logger;
  now?: () => Date;
}

/** Statuses that mean the document has reached its destination. */
const TERMINAL_STATUSES = new Set<number>([
  INVOICE_STATUS.acceptedByBuyer,
  INVOICE_STATUS.signedByBuyer,
  INVOICE_STATUS.delivered,
]);

export class Pipeline {
  private readonly tenantId: string;

  constructor(private readonly deps: PipelineDeps) {
    this.tenantId = deps.config.service.tenantId;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Exponential backoff, capped so a stuck document is still retried hourly. */
  private backoffMs(attempts: number): number {
    return Math.min(60 * 60_000, this.deps.config.worker.pollIntervalMs * 2 ** attempts);
  }

  private async fail(row: OutboxRow, error: Error, permanent: boolean): Promise<void> {
    const attempts = row.attempts + 1;
    const exhausted = permanent || attempts >= this.deps.config.worker.maxAttempts;

    await this.deps.outbox.update(row.id, {
      attempts,
      lastError: `${error.name}: ${error.message}`,
      state: exhausted ? 'failed' : row.state,
      nextAttemptAt: exhausted ? null : new Date(this.now().getTime() + this.backoffMs(attempts)),
    });

    await this.deps.audit.record({
      tenantId: this.tenantId,
      outboxId: row.id,
      operation: `pipeline.${row.state}`,
      error: `${error.name}: ${error.message}`,
    });

    this.deps.logger[exhausted ? 'error' : 'warn']('pipeline.step.failed', {
      outboxId: row.id,
      externalId: row.externalId,
      state: row.state,
      attempts,
      permanent: exhausted,
      error: error.message,
    });
  }

  /**
   * Keeps enough series/number pairs in reserve that a burst of invoices does
   * not have to wait for a round trip to SFS.
   */
  async topUpSeries(): Promise<number> {
    const { worker, sfs } = this.deps.config;
    const free = await this.deps.series.countFree(this.tenantId, sfs.invoiceType);
    if (free >= worker.seriesLowWaterMark) return 0;

    const started = Date.now();
    const response = await this.deps.client.reserveSeriesAndNumbers(worker.seriesReserveCount);
    const pairs = (response.Results ?? []).map((item) => ({
      seria: item.Seria,
      number: item.Number,
    }));
    const added = await this.deps.series.addMany(this.tenantId, sfs.invoiceType, pairs);

    await this.deps.audit.record({
      tenantId: this.tenantId,
      operation: 'GetSeriaAndNumbers',
      requestId: response.RequestId,
      status: response.Status,
      durationMs: Date.now() - started,
    });
    this.deps.logger.info('pipeline.series.reserved', { free, requested: worker.seriesReserveCount, added });
    return added;
  }

  /** Assigns a series/number pair unless the accounting system supplied one. */
  private async assignSeries(row: OutboxRow, document: InvoiceDocument): Promise<InvoiceDocument> {
    if (row.seria && row.number) return { ...document, seria: row.seria, number: row.number };
    if (document.seria && document.number) {
      await this.deps.outbox.update(row.id, { seria: document.seria, number: document.number });
      return document;
    }

    const pair = await this.deps.series.take(
      this.tenantId,
      this.deps.config.sfs.invoiceType,
      row.id,
    );
    if (!pair) {
      // Not an error: the next tick tops the pool up and picks the row again.
      throw new SoapTransportError('no free series/number pair in reserve', null, true);
    }
    await this.deps.outbox.update(row.id, { seria: pair.seria, number: pair.number });
    return { ...document, seria: pair.seria, number: pair.number };
  }

  /** Builds the XML, signs it if a signer is configured, and posts the batch. */
  async processOne(row: OutboxRow): Promise<void> {
    try {
      const document = parseDocument(row.payload);
      assertValidDocument(document);

      const withSeries = await this.assignSeries(row, document);
      await this.deps.outbox.update(row.id, { state: 'reserved' });

      const xml = buildDocumentsXml([withSeries]);
      await this.deps.outbox.update(row.id, { state: 'built', xml });

      let payload = xml;
      let signed = false;
      if (this.deps.signer.isAvailable()) {
        payload = await this.deps.signer.signDocument(xml);
        signed = true;
        await this.deps.outbox.update(row.id, { state: 'signed', signedXml: payload });
      }

      const started = Date.now();
      const response = await this.deps.client.postInvoices(payload, { signed });

      await this.deps.audit.record({
        tenantId: this.tenantId,
        outboxId: row.id,
        operation: 'PostInvoices',
        requestId: response.RequestId,
        status: response.Status,
        durationMs: Date.now() - started,
        error: response.ErrorMessage ?? null,
      });

      if (response.TotalInvoicesPosted < 1) {
        // The service reports "1 - XML incorect" or "2 - eroare la procesare";
        // a rejected XML will be rejected again, so do not spend retries on it.
        const message = response.ErrorMessage ?? 'no invoices were accepted';
        const permanent = /^\s*1\b/.test(message) || /incorect/i.test(message);
        await this.fail(row, new Error(`PostInvoices: ${message}`), permanent);
        return;
      }

      await this.deps.outbox.update(row.id, {
        state: 'posted',
        lastError: null,
        attempts: 0,
        nextAttemptAt: new Date(
          this.now().getTime() + this.deps.config.worker.statusPollIntervalMs,
        ),
      });
      this.deps.logger.info('pipeline.posted', {
        outboxId: row.id,
        externalId: row.externalId,
        seria: withSeries.seria,
        number: withSeries.number,
        signed,
      });
    } catch (error) {
      const err = error as Error;
      // A malformed document and a rejected credential will never fix
      // themselves; a timeout or a 503 will.
      const permanent =
        err instanceof InvoiceValidationError ||
        err instanceof SoapFaultError ||
        err instanceof EFacturaApiError;
      await this.fail(row, err, permanent);
    }
  }

  /** Refreshes the e-Factura status of everything already posted. */
  async refreshStatuses(rows: OutboxRow[]): Promise<void> {
    const identifiers: InvoiceIdentifier[] = rows
      .filter((row) => row.seria && row.number)
      .map((row) => ({ Seria: row.seria!, Number: row.number! }));
    if (identifiers.length === 0) return;

    const started = Date.now();
    try {
      const response = await this.deps.client.checkInvoicesStatus(identifiers);
      await this.deps.audit.record({
        tenantId: this.tenantId,
        operation: 'CheckInvoicesStatus',
        requestId: response.RequestId,
        status: response.Status,
        durationMs: Date.now() - started,
      });

      const byKey = new Map(
        (response.Results ?? []).map((invoice) => [`${invoice.Seria}/${invoice.Number}`, invoice]),
      );

      for (const row of rows) {
        const invoice = byKey.get(`${row.seria}/${row.number}`);
        if (!invoice) continue;

        const status = Number(invoice.InvoiceStatus);
        const settled = TERMINAL_STATUSES.has(status);
        const canceled =
          status === INVOICE_STATUS.canceledBySupplier || status === INVOICE_STATUS.rejectedByBuyer;

        await this.deps.outbox.update(row.id, {
          invoiceStatus: status,
          state: settled ? 'confirmed' : canceled ? 'canceled' : 'posted',
          nextAttemptAt:
            settled || canceled
              ? null
              : new Date(this.now().getTime() + this.deps.config.worker.statusPollIntervalMs),
        });

        if (settled || canceled) {
          this.deps.logger.info('pipeline.settled', {
            outboxId: row.id,
            externalId: row.externalId,
            invoiceStatus: status,
          });
        }
      }
    } catch (error) {
      const err = error as Error;
      this.deps.logger.warn('pipeline.status.failed', { error: err.message, count: rows.length });
      const retryAt = new Date(this.now().getTime() + this.deps.config.worker.statusPollIntervalMs);
      for (const row of rows) await this.deps.outbox.update(row.id, { nextAttemptAt: retryAt });
    }
  }

  /** One full cycle. Returns how many rows it touched. */
  async tick(): Promise<{ posted: number; refreshed: number }> {
    const { worker } = this.deps.config;
    const now = this.now();

    try {
      await this.topUpSeries();
    } catch (error) {
      this.deps.logger.warn('pipeline.series.failed', { error: (error as Error).message });
    }

    const outgoing = await this.deps.outbox.claimDue(
      this.tenantId,
      ['pending', 'reserved', 'built', 'signed'],
      worker.batchSize,
      now,
    );
    for (const row of outgoing) await this.processOne(row);

    const posted = await this.deps.outbox.claimDue(this.tenantId, ['posted'], worker.batchSize, now);
    await this.refreshStatuses(posted);

    return { posted: outgoing.length, refreshed: posted.length };
  }
}
