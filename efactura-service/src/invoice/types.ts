/**
 * The neutral invoice model the service works with.
 *
 * The ERP reader produces it, the XML builder consumes it and the HTTP API
 * accepts it, so nothing outside `db/erp.ts` needs to know the shape of the
 * accounting system's tables.
 */

export interface PartyBankAccount {
  account: string;
  branchTitle?: string;
  branchCode?: string;
}

export interface Party {
  /** IDNO for a company, IDNP for a natural person. */
  idno: string;
  /** 1 legal entity, 2 natural person, 3 non-resident. */
  taxpayerType: number;
  title: string;
  address: string;
  bankAccount?: PartyBankAccount;
}

export interface InvoiceLine {
  /** Article code in the accounting system. */
  code: string;
  name: string;
  unitOfMeasure: string;
  quantity: number;
  unitPriceWithoutVat: number;
  totalPriceWithoutVat: number;
  /** VAT rate as a percentage, e.g. 20 or 8. */
  vatRate: number;
  totalVat: number;
  totalPrice: number;
}

export interface InvoiceDocument {
  /** Identifier in the accounting system; echoed back as APIeInvoiceId. */
  externalId: string;
  seria?: string;
  number?: string;
  deliveryDate: Date;
  supplier: Party;
  buyer: Party;
  transporter?: Party;
  delegateName?: string;
  delegateDate?: Date;
  lines: InvoiceLine[];
  /** Recomputed from the lines unless supplied. */
  total?: number;
  totalVat?: number;
  isPharma?: boolean;
  /** Reason the document was created; 4 is the ordinary sale. */
  creationMotive?: number;
}

/** Row of the service's own outbox table. */
export type OutboxState =
  | 'pending'
  | 'reserved'
  | 'built'
  | 'signed'
  | 'posted'
  | 'confirmed'
  | 'failed'
  | 'canceled';

export interface OutboxRow {
  id: number;
  tenantId: string;
  externalId: string;
  seria: string | null;
  number: string | null;
  state: OutboxState;
  invoiceStatus: number | null;
  attempts: number;
  lastError: string | null;
  payload: string;
  xml: string | null;
  signedXml: string | null;
  createdAt: Date;
  updatedAt: Date;
  nextAttemptAt: Date | null;
}
