/**
 * Builds the `<Documents>` payload that `PostInvoices` expects.
 *
 * The layout follows chapter 5 of the CTIF integration guide ("Modelul
 * Aplicarii Semnaturilor Digitale"), which is the authoritative one because it
 * shows the document exactly as it is hashed and signed - note that `IsFarma`
 * and `CreationMotiv` sit *inside* `SupplierInfo` there, unlike the abbreviated
 * sample in chapter 4.12.
 */
import { escapeXml } from '../sfs/soap.js';
import type { InvoiceDocument, InvoiceLine, Party } from './types.js';

/** Amounts go out with two decimals; the service rejects locale separators. */
export function money(value: number): string {
  return value.toFixed(2);
}

/** Quantities keep up to three decimals but drop trailing zeros. */
export function quantity(value: number): string {
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

export function toEFacturaDateTime(value: Date): string {
  return value.toISOString().replace(/(\.\d{3})Z$/, '$1Z');
}

function attribute(name: string, value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  return ` ${name}="${escapeXml(String(value))}"`;
}

function party(tag: string, value: Party, indent: string): string {
  const open =
    `${indent}<${tag}` +
    attribute('IDNO', value.idno) +
    attribute('TaxpayerType', value.taxpayerType) +
    attribute('Title', value.title) +
    attribute('Address', value.address);

  if (!value.bankAccount) return `${open} />`;

  const account =
    `${indent}  <BankAccount` +
    attribute('Account', value.bankAccount.account) +
    attribute('BranchTitle', value.bankAccount.branchTitle) +
    attribute('BranchCode', value.bankAccount.branchCode) +
    ' />';

  return `${open}>\n${account}\n${indent}</${tag}>`;
}

function row(line: InvoiceLine, indent: string): string {
  return (
    `${indent}<Row` +
    attribute('Code', line.code) +
    attribute('Name', line.name) +
    attribute('UnitOfMeasure', line.unitOfMeasure) +
    attribute('Quantity', quantity(line.quantity)) +
    attribute('UnitPriceWithoutTVA', money(line.unitPriceWithoutVat)) +
    attribute('TotalPriceWithoutTVA', money(line.totalPriceWithoutVat)) +
    attribute('TVA', line.vatRate) +
    attribute('TotalTVA', money(line.totalVat)) +
    attribute('TotalPrice', money(line.totalPrice)) +
    ' />'
  );
}

export function totals(document: InvoiceDocument): { total: number; totalVat: number } {
  const total =
    document.total ?? document.lines.reduce((sum, line) => sum + line.totalPrice, 0);
  const totalVat =
    document.totalVat ?? document.lines.reduce((sum, line) => sum + line.totalVat, 0);
  return { total: round2(total), totalVat: round2(totalVat) };
}

/** Half-up to two decimals, so sums of line totals do not drift by a ban. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildDocument(document: InvoiceDocument, indent = '  '): string {
  const inner = indent + '  ';
  const info = inner + '  ';
  const { total, totalVat } = totals(document);

  const parts: string[] = [];
  if (document.seria) parts.push(`${info}<Seria>${escapeXml(document.seria)}</Seria>`);
  if (document.number) parts.push(`${info}<Number>${escapeXml(document.number)}</Number>`);
  parts.push(`${info}<DeliveryDate>${toEFacturaDateTime(document.deliveryDate)}</DeliveryDate>`);
  parts.push(party('Supplier', document.supplier, info));
  parts.push(party('Buyer', document.buyer, info));
  if (document.transporter) parts.push(party('Transporter', document.transporter, info));
  if (document.delegateName)
    parts.push(`${info}<DelegateName>${escapeXml(document.delegateName)}</DelegateName>`);
  if (document.delegateDate)
    parts.push(`${info}<DelegateDate>${toEFacturaDateTime(document.delegateDate)}</DelegateDate>`);
  parts.push(`${info}<Total>${money(total)}</Total>`);
  parts.push(`${info}<TotalTVA>${money(totalVat)}</TotalTVA>`);
  parts.push(`${info}<Merchandises>`);
  for (const line of document.lines) parts.push(row(line, info + '  '));
  parts.push(`${info}</Merchandises>`);
  parts.push(`${info}<IsFarma>${document.isPharma ? 'true' : 'false'}</IsFarma>`);
  parts.push(`${info}<CreationMotiv>${document.creationMotive ?? 4}</CreationMotiv>`);

  return (
    `${indent}<Document>\n` +
    `${inner}<SupplierInfo>\n` +
    parts.join('\n') +
    `\n${inner}</SupplierInfo>\n` +
    `${indent}</Document>`
  );
}

export function buildDocumentsXml(documents: InvoiceDocument[]): string {
  if (documents.length === 0) throw new Error('buildDocumentsXml requires at least one document');
  return `<Documents>\n${documents.map((d) => buildDocument(d)).join('\n')}\n</Documents>`;
}
