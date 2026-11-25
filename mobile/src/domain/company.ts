/**
 * Corporate-customer rules: fiscal identifiers, VAT codes and the state of a
 * fiscal invoice as the e-Factura service reports it.
 *
 * Kept free of React and of the database so the same functions run in the sign-up
 * form, in the receipt screen and in the tests.
 */

/** IDNO (company) and IDNP (natural person) are both 13 digits in Moldova. */
const FISCAL_CODE = /^\d{13}$/;

/** Cod TVA as printed on a VAT certificate: up to 8 digits, often 7. */
const VAT_CODE = /^\d{6,8}$/;

/** IBAN in Moldova: MD, two check digits, then 20 alphanumerics. */
const MD_IBAN = /^MD\d{2}[A-Z0-9]{20}$/;

export function normaliseFiscalCode(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidIdno(value: string): boolean {
  return FISCAL_CODE.test(normaliseFiscalCode(value));
}

export function isValidVatCode(value: string): boolean {
  return VAT_CODE.test(normaliseFiscalCode(value));
}

export function normaliseIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

export function isValidMdIban(value: string): boolean {
  return MD_IBAN.test(normaliseIban(value));
}

export interface CompanyRecord {
  /** Open index signature so the record satisfies the database's `EntityRecord`. */
  [key: string]: unknown;
  id: string;
  idno: string;
  name: string;
  vat_code?: string | null;
  /** Registered office, which is what goes on the invoice. */
  legal_address?: string | null;
  delivery_address?: string | null;
  bank_account?: string | null;
  bank_name?: string | null;
  bank_swift?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /** Set once the e-Factura service has confirmed the company via SFS. */
  efactura_verified?: boolean | number | null;
  efactura_actor?: boolean | number | null;
  status?: string | null;
  updated_at?: string | null;
}

/** Field-level validation for the company form. Keys are translation keys. */
export function validateCompany(company: Partial<CompanyRecord>): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!company.idno || !isValidIdno(company.idno)) errors['idno'] = 'corporate.error_idno';
  if (!company.name || company.name.trim().length < 2) errors['name'] = 'corporate.error_name';
  if (!company.legal_address || company.legal_address.trim().length < 5) {
    errors['legal_address'] = 'corporate.error_address';
  }
  // VAT registration is optional - a company below the threshold has none.
  if (company.vat_code && !isValidVatCode(company.vat_code)) {
    errors['vat_code'] = 'corporate.error_vat';
  }
  if (company.bank_account && !isValidMdIban(company.bank_account)) {
    errors['bank_account'] = 'corporate.error_iban';
  }
  if (company.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(company.contact_email)) {
    errors['contact_email'] = 'corporate.error_email';
  }

  return errors;
}

export function isVatRegistered(company: Pick<CompanyRecord, 'vat_code'>): boolean {
  return Boolean(company.vat_code && isValidVatCode(company.vat_code));
}

// ---------------------------------------------------------------------------
// Fiscal invoices
// ---------------------------------------------------------------------------

/**
 * What the app shows the customer. The service reports both its own queue state
 * and the e-Factura status; the customer only cares about the combination, so
 * the two are folded into one word here.
 */
export type InvoiceView = 'requested' | 'issued' | 'signed' | 'delivered' | 'rejected' | 'failed';

export interface FiscalInvoiceRecord {
  [key: string]: unknown;
  id: string;
  receipt_id?: string | null;
  company_id?: string | null;
  seria?: string | null;
  number?: string | null;
  issued_at?: string | null;
  total?: number | null;
  total_vat?: number | null;
  /** Pipeline state of the e-Factura service. */
  state?: string | null;
  /** Numeric InvoiceStatus from SIA e-Factura. */
  efactura_status?: number | null;
  qr_text?: string | null;
  pdf_url?: string | null;
  updated_at?: string | null;
}

/** Mirrors the codes in the CTIF integration guide. */
export const EFACTURA_STATUS = {
  draft: 0,
  signedBySupplier: 1,
  rejectedByBuyer: 2,
  acceptedByBuyer: 3,
  canceledBySupplier: 5,
  sentToBuyer: 7,
  signedByBuyer: 8,
  delivered: 10,
} as const;

export function invoiceView(invoice: FiscalInvoiceRecord): InvoiceView {
  if (invoice.state === 'failed') return 'failed';

  switch (invoice.efactura_status) {
    case EFACTURA_STATUS.rejectedByBuyer:
    case EFACTURA_STATUS.canceledBySupplier:
      return 'rejected';
    case EFACTURA_STATUS.acceptedByBuyer:
    case EFACTURA_STATUS.signedByBuyer:
      return 'signed';
    case EFACTURA_STATUS.delivered:
      return 'delivered';
    case EFACTURA_STATUS.signedBySupplier:
    case EFACTURA_STATUS.sentToBuyer:
      return 'issued';
    default:
      // No status yet: the document is somewhere in the service's own queue.
      return invoice.state === 'confirmed' ? 'issued' : 'requested';
  }
}

/** Translation key and semantic tone for the badge on an invoice row. */
export function invoiceBadge(invoice: FiscalInvoiceRecord): {
  labelKey: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
} {
  const view = invoiceView(invoice);
  switch (view) {
    case 'signed':
    case 'delivered':
      return { labelKey: `corporate.status_${view}`, tone: 'positive' };
    case 'rejected':
    case 'failed':
      return { labelKey: `corporate.status_${view}`, tone: 'danger' };
    case 'issued':
      return { labelKey: 'corporate.status_issued', tone: 'neutral' };
    default:
      return { labelKey: 'corporate.status_requested', tone: 'warning' };
  }
}

/** "EAA 000005001", or a dash while the series has not been assigned yet. */
export function invoiceLabel(invoice: FiscalInvoiceRecord): string {
  if (!invoice.seria || !invoice.number) return '—';
  return `${invoice.seria} ${invoice.number}`;
}

/** A customer may ask for a fiscal invoice only once per receipt. */
export function canRequestInvoice(
  receiptId: string,
  invoices: FiscalInvoiceRecord[],
): boolean {
  return !invoices.some(
    (invoice) => invoice.receipt_id === receiptId && invoice.state !== 'failed',
  );
}

/** An invoice may be asked for only so many days after the purchase. */
export function withinRequestWindow(purchasedAt: string | null, windowDays: number, now: Date): boolean {
  if (windowDays <= 0) return true;
  const bought = purchasedAt ? Date.parse(purchasedAt) : NaN;
  if (Number.isNaN(bought)) return false;
  return now.getTime() - bought <= windowDays * 24 * 60 * 60 * 1000;
}
