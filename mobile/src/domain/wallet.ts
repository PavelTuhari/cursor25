/**
 * Wallet rules: incoming fiscal invoices, the companies they belong to, and the
 * decisions a buyer can take on them.
 *
 * Outgoing invoices keep their own vocabulary in `company.ts`; a buyer looking
 * at a document someone sent them cares about different things than a seller
 * looking at one they issued.
 */
import { EFACTURA_STATUS, type FiscalInvoiceRecord } from './company';

export type Direction = 'in' | 'out';

export type ConnectionState = 'pending' | 'active' | 'invalid' | 'revoked';

export interface ConnectionRecord {
  [key: string]: unknown;
  id: string;
  idno: string;
  title?: string | null;
  actor_role?: number | null;
  state?: ConnectionState | null;
  sfs_username?: string | null;
  consent_at?: string | null;
  consent_version?: string | null;
  last_poll_at?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
}

/** Decision the buyer has taken, and how far it has travelled. */
export type Decision = 'none' | 'accepting' | 'accepted' | 'rejecting' | 'rejected' | 'failed';

export interface WalletInvoice extends FiscalInvoiceRecord {
  direction?: Direction | null;
  supplier_idno?: string | null;
  supplier_name?: string | null;
  buyer_idno?: string | null;
  decision?: Decision | null;
  decision_note?: string | null;
  source?: 'sfs' | 'platform' | null;
  paid_amount?: number | null;
}

export function isIncoming(invoice: WalletInvoice): boolean {
  return invoice.direction === 'in';
}

// ---------------------------------------------------------------------------
// What the buyer sees
// ---------------------------------------------------------------------------

/**
 * States of an incoming document, as a person would describe them. Deliberately
 * fewer than the tax service has codes for: a buyer does not need to know the
 * difference between "signed by supplier" and "sent to buyer".
 */
export type IncomingView =
  | 'awaiting'
  | 'accepted'
  | 'rejected'
  | 'canceled'
  | 'sending'
  | 'failed';

export function incomingView(invoice: WalletInvoice): IncomingView {
  // Our own queue wins over the tax service's status while a decision is in
  // flight, otherwise the row would flicker back to "awaiting" after a tap.
  if (invoice.decision === 'accepting' || invoice.decision === 'rejecting') return 'sending';
  if (invoice.decision === 'failed') return 'failed';

  switch (invoice.efactura_status) {
    case EFACTURA_STATUS.acceptedByBuyer:
    case EFACTURA_STATUS.signedByBuyer:
    case EFACTURA_STATUS.delivered:
      return 'accepted';
    case EFACTURA_STATUS.rejectedByBuyer:
      return 'rejected';
    case EFACTURA_STATUS.canceledBySupplier:
      return 'canceled';
    default:
      return 'awaiting';
  }
}

export function incomingBadge(invoice: WalletInvoice): {
  labelKey: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
} {
  const view = incomingView(invoice);
  switch (view) {
    case 'accepted':
      return { labelKey: 'wallet.status_accepted', tone: 'positive' };
    case 'rejected':
      return { labelKey: 'wallet.status_rejected', tone: 'danger' };
    case 'canceled':
      return { labelKey: 'wallet.status_canceled', tone: 'danger' };
    case 'failed':
      return { labelKey: 'wallet.status_failed', tone: 'danger' };
    case 'sending':
      return { labelKey: 'wallet.status_sending', tone: 'neutral' };
    default:
      return { labelKey: 'wallet.status_awaiting', tone: 'warning' };
  }
}

/**
 * Whether the buyer may still decide. Only a document the tax service says was
 * sent to them, and on which nothing has been decided yet.
 */
export function canDecide(invoice: WalletInvoice): boolean {
  if (!isIncoming(invoice)) return false;
  if (invoice.decision && invoice.decision !== 'none' && invoice.decision !== 'failed') return false;
  return (
    invoice.efactura_status === EFACTURA_STATUS.sentToBuyer ||
    invoice.efactura_status === EFACTURA_STATUS.signedBySupplier
  );
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export function connectionBadge(connection: ConnectionRecord): {
  labelKey: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
} {
  switch (connection.state) {
    case 'active':
      return { labelKey: 'wallet.conn_active', tone: 'positive' };
    case 'invalid':
      return { labelKey: 'wallet.conn_invalid', tone: 'danger' };
    case 'revoked':
      return { labelKey: 'wallet.conn_revoked', tone: 'neutral' };
    default:
      return { labelKey: 'wallet.conn_pending', tone: 'warning' };
  }
}

/** A connection whose credentials were rejected needs the owner, not a retry. */
export function needsAttention(connection: ConnectionRecord): boolean {
  return connection.state === 'invalid';
}

export interface ConnectionDraft {
  idno?: string;
  sfsUsername?: string;
  sfsPassword?: string;
  consentAccepted?: boolean;
}

const FISCAL_CODE = /^\d{13}$/;

/** Field-level validation for the connect form. Values are translation keys. */
export function validateConnection(draft: ConnectionDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!draft.idno || !FISCAL_CODE.test(draft.idno.replace(/[\s-]/g, ''))) {
    errors['idno'] = 'corporate.error_idno';
  }
  if (!draft.sfsUsername?.trim()) errors['sfsUsername'] = 'wallet.error_username';
  if (!draft.sfsPassword) errors['sfsPassword'] = 'wallet.error_password';
  // Without consent nothing is sent, so this is a validation error and not a
  // disabled button: the reason has to be visible.
  if (!draft.consentAccepted) errors['consentAccepted'] = 'wallet.error_consent';

  return errors;
}

// ---------------------------------------------------------------------------
// Grouping and totals
// ---------------------------------------------------------------------------

export interface SupplierGroup {
  idno: string;
  name: string;
  count: number;
  total: number;
  awaiting: number;
}

/** Groups incoming documents by who issued them, biggest exposure first. */
export function groupBySupplier(invoices: WalletInvoice[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();

  for (const invoice of invoices) {
    if (!isIncoming(invoice)) continue;
    const idno = invoice.supplier_idno ?? 'unknown';
    const group = groups.get(idno) ?? {
      idno,
      name: invoice.supplier_name ?? idno,
      count: 0,
      total: 0,
      awaiting: 0,
    };
    group.count += 1;
    group.total += invoice.total ?? 0;
    if (incomingView(invoice) === 'awaiting') group.awaiting += 1;
    groups.set(idno, group);
  }

  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export interface WalletSummary {
  documents: number;
  awaiting: number;
  total: number;
  unpaid: number;
}

export function summarise(invoices: WalletInvoice[]): WalletSummary {
  let documents = 0;
  let awaiting = 0;
  let total = 0;
  let unpaid = 0;

  for (const invoice of invoices) {
    if (!isIncoming(invoice)) continue;
    documents += 1;
    const amount = invoice.total ?? 0;
    total += amount;

    const view = incomingView(invoice);
    if (view === 'awaiting') awaiting += 1;
    // A document the buyer refused, or the supplier withdrew, is not money
    // owed - counting it would overstate what the company has to pay.
    if (view !== 'rejected' && view !== 'canceled') {
      unpaid += outstanding(invoice);
    }
  }

  return {
    documents,
    awaiting,
    total: Math.round(total * 100) / 100,
    unpaid: Math.round(unpaid * 100) / 100,
  };
}

export function outstanding(invoice: WalletInvoice): number {
  return Math.max(0, (invoice.total ?? 0) - (invoice.paid_amount ?? 0));
}

export function isPaid(invoice: WalletInvoice): boolean {
  return (invoice.total ?? 0) > 0 && outstanding(invoice) < 0.01;
}
