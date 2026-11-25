/** Money formatting and discount maths, driven by `app.currency`. */
import type { CurrencyConfig } from '../config/types';

export function formatPrice(value: number | null | undefined, currency: CurrencyConfig): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const amount = value.toFixed(currency.decimals);
  // Thousands separator: a narrow no-break space, the Moldovan/Romanian convention.
  const [integer = '0', fraction] = amount.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const formatted = fraction ? `${grouped},${fraction}` : grouped;
  return currency.position === 'prefix'
    ? `${currency.symbol} ${formatted}`
    : `${formatted} ${currency.symbol}`;
}

export function discountPercent(price: number, oldPrice: number | null | undefined): number {
  if (!oldPrice || oldPrice <= 0 || price >= oldPrice) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

export function unitPrice(price: number, unitSize: number | null | undefined): number | null {
  if (!unitSize || unitSize <= 0) return null;
  return price / unitSize;
}

export function formatUnitPrice(
  price: number,
  unitSize: number | null | undefined,
  unit: string | null | undefined,
  currency: CurrencyConfig,
): string | null {
  const perUnit = unitPrice(price, unitSize);
  if (perUnit === null || !unit) return null;
  return `${formatPrice(perUnit, currency)} / ${unit}`;
}
