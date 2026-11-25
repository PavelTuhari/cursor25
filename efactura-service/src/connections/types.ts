/**
 * Multi-company model: a connection is one company acting in one role, with its
 * own e-Factura API user.
 */

export type ConnectionState = 'pending' | 'active' | 'invalid' | 'revoked';

export interface Connection {
  id: number;
  tenantId: string;
  idno: string;
  title: string | null;
  /** 1 supplier, 2 buyer, 3 transporter. */
  actorRole: number;
  sfsUsername: string | null;
  state: ConnectionState;
  consentAt: Date | null;
  consentVersion: string | null;
  /** How far the incoming poll has read. */
  lastPollAt: Date | null;
  lastSeenAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What leaves the service over the API. The password is absent by construction,
 * not by filtering - there is no field for it to occupy.
 */
export interface ConnectionView {
  id: number;
  idno: string;
  title: string | null;
  actorRole: number;
  state: ConnectionState;
  sfsUsername: string | null;
  consentAt: Date | null;
  consentVersion: string | null;
  lastPollAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export function toConnectionView(connection: Connection): ConnectionView {
  return {
    id: connection.id,
    idno: connection.idno,
    title: connection.title,
    actorRole: connection.actorRole,
    state: connection.state,
    sfsUsername: connection.sfsUsername,
    consentAt: connection.consentAt,
    consentVersion: connection.consentVersion,
    lastPollAt: connection.lastPollAt,
    lastError: connection.lastError,
    createdAt: connection.createdAt,
  };
}

export type InboxDecision =
  | 'none'
  | 'accepting'
  | 'accepted'
  | 'rejecting'
  | 'rejected'
  | 'failed';

export type InboxSource = 'sfs' | 'platform';

export interface InboxRow {
  id: number;
  tenantId: string;
  connectionId: number;
  seria: string;
  number: string;
  supplierIdno: string;
  supplierName: string | null;
  buyerIdno: string;
  issuedAt: Date | null;
  total: number | null;
  totalVat: number | null;
  invoiceStatus: number | null;
  decision: InboxDecision;
  decisionNote: string | null;
  decisionAt: Date | null;
  attempts: number;
  lastError: string | null;
  xml: string | null;
  qrText: string | null;
  source: InboxSource;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields the poller writes when it discovers or refreshes a document. */
export interface InboxUpsert {
  tenantId: string;
  connectionId: number;
  seria: string;
  number: string;
  supplierIdno: string;
  supplierName?: string | null;
  buyerIdno: string;
  issuedAt?: Date | null;
  total?: number | null;
  totalVat?: number | null;
  invoiceStatus?: number | null;
  xml?: string | null;
  qrText?: string | null;
  source: InboxSource;
}
