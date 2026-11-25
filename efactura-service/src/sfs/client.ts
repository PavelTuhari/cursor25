/**
 * Typed client for the e-Factura API.
 *
 * Every method fills in RequestId and the configured actor role, builds the
 * envelope and returns the already-unwrapped result. A response whose `Status`
 * is 3 (error) is raised as `EFacturaApiError` rather than returned, so callers
 * never have to remember to check it.
 */
import { randomUUID } from 'node:crypto';

import type { SfsConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';
import { buildEnvelope, call } from './soap.js';
import {
  OPERATIONS,
  RESPONSE_STATUS,
  type ActorBaseRequest,
  type ArchivedRequest,
  type BankAccountResponse,
  type BaseResponse,
  type CanceledRequest,
  type DecisionResponse,
  type InvoiceContentResponse,
  type InvoiceIdentifier,
  type InvoicesResponse,
  type InvoicesXmlResponse,
  type LogsResponse,
  type OperationName,
  type PostInvoicesResponse,
  type QRCodesResponse,
  type RejectRequest,
  type SearchParameters,
  type SeriaNumberResponse,
  type TaxpayersResponse,
} from './types.js';

export class EFacturaApiError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly requestId: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EFacturaApiError';
  }
}

export interface EFacturaClientOptions {
  config: SfsConfig;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export class EFacturaClient {
  private readonly config: SfsConfig;
  private readonly logger: Logger;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: EFacturaClientOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl;
  }

  private async invoke<T extends BaseResponse>(
    operation: OperationName,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const requestId = (payload['RequestId'] as string | undefined) ?? randomUUID();
    const body = { ...payload, RequestId: requestId };

    const envelope = buildEnvelope({
      operation,
      requestType: OPERATIONS[operation],
      payload: body,
      username: this.config.username,
      password: this.config.password,
      soapNamespace: this.config.soapNamespace,
      modelNamespace: this.config.modelNamespace,
    });

    const started = Date.now();
    const result = await call<T>({
      endpoint: this.config.endpoint,
      operation,
      soapNamespace: this.config.soapNamespace,
      envelope,
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
      retryBackoffMs: this.config.retryBackoffMs,
      fetchImpl: this.fetchImpl,
      onRetry: (attempt, error) =>
        this.logger.warn('sfs.retry', { operation, requestId, attempt, error: error.message }),
    });

    this.logger.debug('sfs.call', {
      operation,
      requestId,
      ms: Date.now() - started,
      status: result?.Status,
    });

    if (result && Number(result.Status) === RESPONSE_STATUS.error) {
      throw new EFacturaApiError(
        `${operation} returned status 3 (error)`,
        operation,
        requestId,
        Number(result.Status),
      );
    }

    return result;
  }

  /** Company name, address, VAT code and e-Factura membership by IDNO/IDNP. */
  getTaxpayersInfo(fiscalCodes: string[], requestId?: string): Promise<TaxpayersResponse> {
    return this.invoke<TaxpayersResponse>('GetTaxpayersInfo', {
      RequestId: requestId,
      FiscalCodes: fiscalCodes,
    });
  }

  getBankAccountInfo(idno: string, accountNumber?: string): Promise<BankAccountResponse> {
    return this.invoke<BankAccountResponse>('GetBankAccountInfo', {
      IDNO: idno,
      AccountNumber: accountNumber,
    });
  }

  /** Reserves a block of series/number pairs for invoices created locally. */
  reserveSeriesAndNumbers(
    count: number,
    options: { seria?: string; startNumber?: number; invoiceType?: number } = {},
  ): Promise<SeriaNumberResponse> {
    return this.invoke<SeriaNumberResponse>('GetSeriaAndNumbers', {
      Count: count,
      InvoiceType: options.invoiceType ?? this.config.invoiceType,
      Seria: options.seria,
      StartNumber: options.startNumber,
    });
  }

  getInvoicesQRcodes(invoices: InvoiceIdentifier[]): Promise<QRCodesResponse> {
    return this.invoke<QRCodesResponse>('GetInvoicesQRcodes', { SeriaAndNumbers: invoices });
  }

  getInvoicesBySeriaNumber(invoices: InvoiceIdentifier[]): Promise<InvoicesXmlResponse> {
    return this.invoke<InvoicesXmlResponse>('GetInvoicesBySeriaNumber', {
      SeriaAndNumbers: invoices,
    });
  }

  checkInvoicesStatus(invoices: InvoiceIdentifier[]): Promise<InvoicesResponse> {
    return this.invoke<InvoicesResponse>('CheckInvoicesStatus', { SeriaAndNumbers: invoices });
  }

  /** Content to be signed next, for the given position in the signing order. */
  getInvoicesForSigning(order: number, actorRole?: number): Promise<InvoicesXmlResponse> {
    return this.invoke<InvoicesXmlResponse>('GetInvoicesForSigning', {
      ActorRole: actorRole ?? this.config.actorRole,
      Order: order,
    });
  }

  /** Printable form of an invoice; `Format` is normally "pdf". */
  getInvoicesContentForPrint(
    invoices: InvoiceIdentifier[],
    options: { orientation?: number; actorRole?: number } = {},
  ): Promise<InvoiceContentResponse> {
    return this.invoke<InvoiceContentResponse>('GetInvoicesContentForPrint', {
      SeriaAndNumbers: invoices,
      ActorRole: options.actorRole ?? this.config.actorRole,
      Orientation: options.orientation ?? 0,
    });
  }

  getAcceptedInvoices(actorRole?: number): Promise<InvoicesResponse> {
    const payload: Partial<ActorBaseRequest> = {
      ActorRole: actorRole ?? this.config.actorRole,
    };
    return this.invoke<InvoicesResponse>('GetAcceptedInvoices', payload as Record<string, unknown>);
  }

  getRejectedInvoices(actorRole?: number): Promise<InvoicesResponse> {
    const payload: Partial<ActorBaseRequest> = {
      ActorRole: actorRole ?? this.config.actorRole,
    };
    return this.invoke<InvoicesResponse>('GetRejectedInvoices', payload as Record<string, unknown>);
  }

  getArchivedInvoices(
    page: number,
    issuedOn?: { StartDate: Date; EndDate?: Date },
    actorRole?: number,
  ): Promise<InvoicesResponse> {
    const payload: Partial<ArchivedRequest> = {
      ActorRole: actorRole ?? this.config.actorRole,
      IssuedOn: issuedOn,
      Page: page,
    };
    return this.invoke<InvoicesResponse>('GetArchivedInvoices', payload as Record<string, unknown>);
  }

  postRejectedInvoices(comments: RejectRequest['InvoicesComments']): Promise<DecisionResponse> {
    return this.invoke<DecisionResponse>('PostRejectedInvoices', { InvoicesComments: comments });
  }

  postAcceptedInvoices(invoices: InvoiceIdentifier[]): Promise<DecisionResponse> {
    return this.invoke<DecisionResponse>('PostAcceptedInvoices', { SeriaAndNumbers: invoices });
  }

  postCanceledInvoices(comments: CanceledRequest['InvoicesComments']): Promise<DecisionResponse> {
    return this.invoke<DecisionResponse>('PostCanceledInvoices', { InvoicesComments: comments });
  }

  /**
   * Uploads one `<Documents>` batch. `signed` tells the service whether the XML
   * already carries its `<Signatures>` block.
   */
  postInvoices(
    invoicesXml: string,
    options: { signed: boolean; actorRole?: number; attachment?: { FileName: string; FileContent: string } } ,
  ): Promise<PostInvoicesResponse> {
    const operation: OperationName = options.attachment
      ? 'PostInvoicesWithAttachment'
      : 'PostInvoices';
    return this.invoke<PostInvoicesResponse>(operation, {
      ActorRole: options.actorRole ?? this.config.actorRole,
      Attachment: options.attachment,
      InvoicesXml: invoicesXml,
      InvoicesXmlStatus: options.signed ? 1 : 0,
    });
  }

  searchInvoices(parameters: SearchParameters, actorRole?: number): Promise<InvoicesResponse> {
    return this.invoke<InvoicesResponse>('SearchInvoices', {
      ActorRole: actorRole ?? this.config.actorRole,
      Parameters: parameters,
    });
  }

  getLogs(from: Date, to?: Date): Promise<LogsResponse> {
    return this.invoke<LogsResponse>('GetLogs', { From: from, To: to });
  }

  /** Cheap connectivity and credential probe used by the health endpoint. */
  test(): Promise<BaseResponse> {
    return this.invoke<BaseResponse>('Test', {});
  }
}
