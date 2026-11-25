/**
 * Pre-flight checks on a document before it is turned into XML.
 *
 * Catching these locally matters: `PostInvoices` answers a malformed batch with
 * a single "1 - XML incorect" and no indication of which document or field is
 * at fault, so anything we can verify ourselves saves a support call.
 */
import type { InvoiceDocument, Party } from './types.js';
import { round2 } from './xml.js';

/** IDNO and IDNP are both 13 digits in the Moldovan registers. */
const FISCAL_CODE = /^\d{13}$/;

/** Tolerance when comparing a supplied total against the sum of the lines. */
const TOLERANCE = 0.01;

function checkParty(label: string, party: Party | undefined, errors: string[], required: boolean) {
  if (!party) {
    if (required) errors.push(`${label} is missing`);
    return;
  }
  if (!FISCAL_CODE.test(party.idno)) {
    errors.push(`${label}.idno must be 13 digits, got ${JSON.stringify(party.idno)}`);
  }
  if (![1, 2, 3].includes(party.taxpayerType)) {
    errors.push(`${label}.taxpayerType must be 1, 2 or 3`);
  }
  if (!party.title?.trim()) errors.push(`${label}.title is required`);
  if (!party.address?.trim()) errors.push(`${label}.address is required`);
}

export function validateDocument(document: InvoiceDocument): string[] {
  const errors: string[] = [];

  if (!document.externalId?.trim()) errors.push('externalId is required');
  if (!(document.deliveryDate instanceof Date) || Number.isNaN(document.deliveryDate.getTime())) {
    errors.push('deliveryDate must be a valid date');
  }

  checkParty('supplier', document.supplier, errors, true);
  checkParty('buyer', document.buyer, errors, true);
  checkParty('transporter', document.transporter, errors, false);

  if (document.supplier && document.buyer && document.supplier.idno === document.buyer.idno) {
    errors.push('supplier and buyer must be different taxpayers');
  }

  if (!Array.isArray(document.lines) || document.lines.length === 0) {
    errors.push('at least one line is required');
    return errors;
  }

  document.lines.forEach((line, index) => {
    const at = `lines[${index}]`;
    if (!line.name?.trim()) errors.push(`${at}.name is required`);
    if (!line.unitOfMeasure?.trim()) errors.push(`${at}.unitOfMeasure is required`);
    if (!Number.isFinite(line.quantity) || line.quantity === 0) {
      errors.push(`${at}.quantity must be a non-zero number`);
    }
    if (!Number.isFinite(line.vatRate) || line.vatRate < 0) {
      errors.push(`${at}.vatRate must be a non-negative number`);
    }

    // A credit note carries negative quantities and amounts; what matters is
    // that the arithmetic is internally consistent, not the sign.
    const expectedNet = round2(line.quantity * line.unitPriceWithoutVat);
    if (Math.abs(expectedNet - round2(line.totalPriceWithoutVat)) > TOLERANCE) {
      errors.push(
        `${at}.totalPriceWithoutVat ${line.totalPriceWithoutVat} does not match quantity * unitPriceWithoutVat (${expectedNet})`,
      );
    }
    const expectedVat = round2((line.totalPriceWithoutVat * line.vatRate) / 100);
    if (Math.abs(expectedVat - round2(line.totalVat)) > TOLERANCE) {
      errors.push(`${at}.totalVat ${line.totalVat} does not match the ${line.vatRate}% rate (${expectedVat})`);
    }
    const expectedGross = round2(line.totalPriceWithoutVat + line.totalVat);
    if (Math.abs(expectedGross - round2(line.totalPrice)) > TOLERANCE) {
      errors.push(`${at}.totalPrice ${line.totalPrice} does not match net plus VAT (${expectedGross})`);
    }
  });

  const sumTotal = round2(document.lines.reduce((sum, line) => sum + line.totalPrice, 0));
  const sumVat = round2(document.lines.reduce((sum, line) => sum + line.totalVat, 0));
  if (document.total !== undefined && Math.abs(round2(document.total) - sumTotal) > TOLERANCE) {
    errors.push(`total ${document.total} does not match the sum of the lines (${sumTotal})`);
  }
  if (document.totalVat !== undefined && Math.abs(round2(document.totalVat) - sumVat) > TOLERANCE) {
    errors.push(`totalVat ${document.totalVat} does not match the sum of the lines (${sumVat})`);
  }

  return errors;
}

export class InvoiceValidationError extends Error {
  constructor(
    readonly externalId: string,
    readonly errors: string[],
  ) {
    super(`invoice ${externalId} is not valid: ${errors.join('; ')}`);
    this.name = 'InvoiceValidationError';
  }
}

export function assertValidDocument(document: InvoiceDocument): void {
  const errors = validateDocument(document);
  if (errors.length > 0) throw new InvoiceValidationError(document.externalId, errors);
}
