/** Basket maths: line totals, delivery fee, minimum order and coupon discount. */
import type { CartConfig, CurrencyConfig } from '../config/types';
import { couponDiscount, type CouponLike } from './coupons';
import { formatPrice } from './price';

export interface CartLine {
  [key: string]: unknown;
  id: string;
  product_id?: string | null;
  title?: string | null;
  quantity?: number | null;
  price?: number | null;
  unit?: string | null;
  image_url?: string | null;
}

export type Fulfillment = 'pickup' | 'delivery';

export interface CartTotals {
  lines: number;
  quantity: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  /** How much is still missing to reach `cart.minOrderTotal`; 0 when reached. */
  missingToMinimum: number;
  /** How much is still missing for free delivery; null when the rule is off or already free. */
  missingToFreeDelivery: number | null;
  canCheckout: boolean;
  subtotalText: string;
  totalText: string;
}

export function lineTotal(line: CartLine): number {
  return (line.price ?? 0) * (line.quantity ?? 1);
}

export interface CartTotalsOptions {
  fulfillment: Fulfillment;
  coupon?: CouponLike | null;
  categoryOf?: (productId: string) => string | null;
  now?: Date;
}

export function cartTotals(
  lines: CartLine[],
  config: CartConfig,
  currency: CurrencyConfig,
  options: CartTotalsOptions,
): CartTotals {
  const subtotal = round(lines.reduce((sum, line) => sum + lineTotal(line), 0));
  const quantity = lines.reduce((sum, line) => sum + (line.quantity ?? 1), 0);

  const discount = options.coupon
    ? couponDiscount(
        options.coupon,
        lines.map((line) => ({
          product_id: line.product_id ?? null,
          category_id: line.product_id ? options.categoryOf?.(line.product_id) ?? null : null,
          price: line.price ?? 0,
          quantity: line.quantity ?? 1,
        })),
        subtotal,
        options.now ?? new Date(),
      )
    : 0;

  const discounted = Math.max(0, round(subtotal - discount));
  const deliveryFee =
    options.fulfillment === 'delivery' && !isFreeDelivery(discounted, config) ? config.deliveryFee : 0;

  const missingToMinimum = Math.max(0, round(config.minOrderTotal - discounted));
  const missingToFreeDelivery =
    options.fulfillment === 'delivery' && config.freeDeliveryFrom > 0 && !isFreeDelivery(discounted, config)
      ? round(config.freeDeliveryFrom - discounted)
      : null;

  const total = round(discounted + deliveryFee);

  return {
    lines: lines.length,
    quantity: round(quantity),
    subtotal,
    discount,
    deliveryFee,
    total,
    missingToMinimum,
    missingToFreeDelivery,
    canCheckout: lines.length > 0 && missingToMinimum === 0,
    subtotalText: formatPrice(subtotal, currency),
    totalText: formatPrice(total, currency),
  };
}

function isFreeDelivery(total: number, config: CartConfig): boolean {
  return config.freeDeliveryFrom > 0 && total >= config.freeDeliveryFrom;
}

/** Keeps a quantity inside 1…`maxQuantityPerItem`; 0 means "remove the line". */
export function clampQuantity(quantity: number, config: CartConfig): number {
  if (quantity <= 0) return 0;
  return Math.min(Math.round(quantity * 1000) / 1000, config.maxQuantityPerItem);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
