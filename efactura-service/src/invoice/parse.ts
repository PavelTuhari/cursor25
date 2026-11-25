/**
 * Reads a document coming back from e-Factura.
 *
 * `SearchInvoices` returns only series, number and status - not who issued the
 * document. Since the de-duplication key needs the supplier's IDNO, every newly
 * discovered document is fetched in full and parsed here.
 */
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export interface ParsedInvoice {
  seria: string | null;
  number: string | null;
  issuedAt: Date | null;
  supplierIdno: string | null;
  supplierName: string | null;
  buyerIdno: string | null;
  buyerName: string | null;
  total: number | null;
  totalVat: number | null;
  lineCount: number;
  /** How many signatures the document already carries. */
  signatureCount: number;
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parses one document. Accepts either a bare `<Document>` or a `<Documents>`
 * wrapper, because the service returns both shapes depending on the operation.
 */
export function parseInvoiceXml(xml: string): ParsedInvoice | null {
  if (!xml || xml.trim() === '') return null;

  let tree: Record<string, any>;
  try {
    tree = parser.parse(xml) as Record<string, any>;
  } catch {
    return null;
  }

  const document = tree?.['Documents']?.['Document'] ?? tree?.['Document'];
  const first = Array.isArray(document) ? document[0] : document;
  const info = first?.['SupplierInfo'];
  if (!info) return null;

  const supplier = info['Supplier'] ?? {};
  const buyer = info['Buyer'] ?? {};
  const rows = asArray(info['Merchandises']?.['Row']);

  return {
    seria: info['Seria'] ? String(info['Seria']) : null,
    number: info['Number'] ? String(info['Number']) : null,
    issuedAt: toDate(info['DeliveryDate']),
    supplierIdno: supplier['@_IDNO'] ? String(supplier['@_IDNO']) : null,
    supplierName: supplier['@_Title'] ? String(supplier['@_Title']) : null,
    buyerIdno: buyer['@_IDNO'] ? String(buyer['@_IDNO']) : null,
    buyerName: buyer['@_Title'] ? String(buyer['@_Title']) : null,
    total: toNumber(info['Total']),
    totalVat: toNumber(info['TotalTVA']),
    lineCount: rows.length,
    // Counted from the raw text: the parser's shape for repeated elements
    // varies with how many there are, and the count is all we need.
    signatureCount: (xml.match(/<SignatureContent>/g) ?? []).length,
  };
}
