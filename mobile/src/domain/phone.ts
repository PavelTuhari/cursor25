/**
 * Phone helpers for the sign-in flow. Moldovan numbers are the default, but the
 * country code is a parameter so another tenant can pass its own.
 */

export const DEFAULT_COUNTRY_CODE = '+373';

/** Turns anything the user typed into `+373XXXXXXXX`, or null if it cannot. */
export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (hasPlus) return digits.length >= 8 ? `+${digits}` : null;

  const codeDigits = countryCode.replace(/\D/g, '');
  if (digits.startsWith(codeDigits) && digits.length > codeDigits.length) return `+${digits}`;
  // Local formats: leading zero (0 6X XXX XXX) or the bare subscriber number.
  const local = digits.replace(/^0+/, '');
  if (local.length < 8 || local.length > 10) return null;
  return `+${codeDigits}${local}`;
}

export function isValidPhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): boolean {
  return normalizePhone(input, countryCode) !== null;
}

/** `+37360123456` → `+373 60 123 456` */
export function formatPhone(phone: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const normalized = normalizePhone(phone, countryCode);
  if (!normalized) return phone;
  const codeDigits = countryCode.replace(/\D/g, '');
  if (!normalized.startsWith(`+${codeDigits}`)) return normalized;

  const local = normalized.slice(codeDigits.length + 1);
  const groups = local.length === 8 ? [2, 3, 3] : [3, 3, 3];
  const parts: string[] = [];
  let offset = 0;
  for (const size of groups) {
    if (offset >= local.length) break;
    parts.push(local.slice(offset, offset + size));
    offset += size;
  }
  if (offset < local.length) parts.push(local.slice(offset));
  return `${countryCode} ${parts.join(' ')}`;
}

/** Masks a number for confirmation screens: `+373 60 *** 456`. */
export function maskPhone(phone: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const formatted = formatPhone(phone, countryCode);
  const parts = formatted.split(' ');
  if (parts.length < 3) return formatted;
  return parts.map((part, index) => (index === parts.length - 2 ? '*'.repeat(part.length) : part)).join(' ');
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(input.trim());
}
