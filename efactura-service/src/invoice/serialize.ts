/** JSON round-tripping for `InvoiceDocument`, which JSON.parse alone gets wrong on dates. */
import type { InvoiceDocument } from './types.js';

const DATE_FIELDS = ['deliveryDate', 'delegateDate'] as const;

export function serializeDocument(document: InvoiceDocument): string {
  return JSON.stringify(document);
}

export function parseDocument(payload: string): InvoiceDocument {
  const raw = JSON.parse(payload) as Record<string, unknown>;
  for (const field of DATE_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string') raw[field] = new Date(value);
  }
  return raw as unknown as InvoiceDocument;
}

/** Accepts the JSON body of `POST /invoices`, where dates arrive as strings. */
export function documentFromJson(body: unknown): InvoiceDocument {
  if (!body || typeof body !== 'object') throw new Error('body must be an object');
  return parseDocument(JSON.stringify(body));
}
