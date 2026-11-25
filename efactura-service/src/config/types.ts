/**
 * Shape of `config/service.config.json`. Every field can be overridden from the
 * environment (see `load.ts`), so the JSON file stays free of secrets.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Role the configured company plays in a transaction, per the SFS API. */
export const ACTOR_ROLE = { supplier: 1, buyer: 2, transporter: 3 } as const;
export type ActorRole = (typeof ACTOR_ROLE)[keyof typeof ACTOR_ROLE];

/** 0 = Electronic Tax Invoice (factura fiscala), 1 = Electronic Waybill. */
export const INVOICE_TYPE = { eti: 0, waybill: 1 } as const;
export type InvoiceType = (typeof INVOICE_TYPE)[keyof typeof INVOICE_TYPE];

export interface HttpConfig {
  host: string;
  port: number;
  basePath: string;
}

export interface ServiceConfig {
  name: string;
  /** Distinguishes deployments when several clients share one database. */
  tenantId: string;
  http: HttpConfig;
  /** Bearer token callers must present. Empty disables the check - only safe on a private network. */
  apiToken: string;
  logLevel: LogLevel;
}

export interface SfsConfig {
  /** WCF endpoint, e.g. https://efactura-api.sfs.md/Service.svc */
  endpoint: string;
  /** SOAP action / operation namespace. Fixed by the published WSDL. */
  soapNamespace: string;
  /** DataContract namespace of the request and response bodies. */
  modelNamespace: string;
  /** API user created in the e-Factura portal by the company Manager. */
  username: string;
  password: string;
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  actorRole: ActorRole;
  invoiceType: InvoiceType;
}

export interface OracleConfig {
  connectString: string;
  user: string;
  password: string;
  /** Schema owning the service tables; also the default for unqualified names. */
  schema: string;
  poolMin: number;
  poolMax: number;
  poolIncrement: number;
  queueTimeoutMs: number;
}

export interface ErpConfig {
  /** `views` reads the accounting system through read-only views; `none` disables the reader. */
  source: 'views' | 'none';
  views: {
    documents: string;
    lines: string;
    partners: string;
  };
}

export type SigningMode = 'none' | 'pkcs12' | 'pkiserver';

export interface SigningConfig {
  mode: SigningMode;
  pkcs12: {
    file: string;
    passphrase: string;
    /** Digest for the XMLDSig Reference and SignatureMethod. */
    digest: 'sha1' | 'sha256';
  };
  /** STISC PKI-Server, for companies above ~10k invoices a month. */
  pkiServer: {
    url: string;
    apiKey: string;
    keyAlias: string;
    timeoutMs: number;
  };
}

export interface CryptoConfig {
  /**
   * 32 bytes, base64 or hex. Seals the API credentials of other companies.
   * Comes from the environment or a cloud vault - never from this file, never
   * from the database.
   */
  key: string;
  /** Version of the consent text a connection was created under. */
  consentVersion: string;
}

export interface InboxConfig {
  enabled: boolean;
  /** How long before a connection is polled again. Floor is enforced below. */
  pollIntervalMs: number;
  /** Connections handled in one tick, so a large tenant spreads over cycles. */
  connectionsPerTick: number;
  batchSize: number;
  maxAttempts: number;
  /** How far back the first poll of a new connection reaches. */
  backfillMonths: number;
  /**
   * `SearchInvoices` requires a status, so discovery asks for each of these in
   * turn rather than trying to express "everything" in one call.
   */
  trackedStatuses: number[];
}

export interface WorkerConfig {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  statusPollIntervalMs: number;
  /** Reserve a new block of series/numbers when fewer than this many are free. */
  seriesLowWaterMark: number;
  seriesReserveCount: number;
}

export interface AppConfig {
  service: ServiceConfig;
  sfs: SfsConfig;
  oracle: OracleConfig;
  erp: ErpConfig;
  signing: SigningConfig;
  worker: WorkerConfig;
  crypto: CryptoConfig;
  inbox: InboxConfig;
}
