/**
 * Barcode scanning: what the camera returns is not always what the catalogue
 * stores, so a scan is looked up by several equivalent forms.
 */
import { ean13CheckDigit, isValidEan13 } from './barcode';

export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

/**
 * Equivalent representations of one scanned code, most specific first:
 * a UPC-A is an EAN-13 with a leading zero, and an EAN-8 is often stored
 * padded. Duplicates are removed.
 */
export function scanCandidates(raw: string): string[] {
  const code = normalizeScannedCode(raw);
  if (code.length === 0) return [];

  const candidates = [code];
  if (/^\d+$/.test(code)) {
    if (code.length === 12) candidates.push(`0${code}`); // UPC-A → EAN-13
    if (code.length === 13 && code.startsWith('0')) candidates.push(code.slice(1));
    if (code.length === 8) candidates.push(code.padStart(13, '0'));
    if (code.length === 13) candidates.push(code.replace(/^0+/, ''));
  }
  return [...new Set(candidates)].filter((item) => item.length > 0);
}

/** Digits-only codes of a plausible length are worth a catalogue lookup. */
export function looksLikeProductCode(raw: string): boolean {
  const code = normalizeScannedCode(raw);
  if (!/^\d+$/.test(code)) return false;
  return code.length >= 8 && code.length <= 14;
}

/** A loyalty card or coupon may be scanned too; EAN-13 with a valid check digit. */
export function isLoyaltyCode(raw: string, prefix: string): boolean {
  const code = normalizeScannedCode(raw);
  return code.startsWith(prefix) && isValidEan13(code);
}

export function withCheckDigit(body: string): string {
  const digits = body.replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  return digits + String(ean13CheckDigit(digits));
}
