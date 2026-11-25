/**
 * Personal coupons: validity, applicability and the discount they produce.
 *
 * A coupon may be limited to products or categories; then only those lines of
 * the basket count both for the minimum and for the discount itself.
 */

export interface CouponLike {
  id: string;
  code?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  min_order_total?: number | null;
  product_ids?: unknown;
  category_ids?: unknown;
  starts_at?: string | null;
  ends_at?: string | null;
  is_activated?: boolean | null;
  used_at?: string | null;
}

export interface DiscountableLine {
  product_id?: string | null;
  category_id?: string | null;
  price?: number | null;
  quantity?: number | null;
}

function asIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function withinPeriod(coupon: CouponLike, now: Date): boolean {
  const time = now.getTime();
  if (coupon.starts_at) {
    const starts = new Date(coupon.starts_at).getTime();
    if (!Number.isNaN(starts) && time < starts) return false;
  }
  if (coupon.ends_at) {
    const ends = new Date(coupon.ends_at).getTime();
    if (!Number.isNaN(ends) && time > ends) return false;
  }
  return true;
}

/** A coupon is usable while it is inside its period and has not been redeemed. */
export function isCouponValid(coupon: CouponLike, now = new Date()): boolean {
  if (coupon.used_at) return false;
  return withinPeriod(coupon, now);
}

export function lineIsEligible(coupon: CouponLike, line: DiscountableLine): boolean {
  const products = asIdList(coupon.product_ids);
  const categories = asIdList(coupon.category_ids);
  if (products.length === 0 && categories.length === 0) return true;
  if (line.product_id && products.includes(line.product_id)) return true;
  return Boolean(line.category_id && categories.includes(line.category_id));
}

export function eligibleSubtotal(coupon: CouponLike, lines: DiscountableLine[]): number {
  return lines.reduce((sum, line) => {
    if (!lineIsEligible(coupon, line)) return sum;
    return sum + (line.price ?? 0) * (line.quantity ?? 1);
  }, 0);
}

export function isCouponApplicable(
  coupon: CouponLike,
  lines: DiscountableLine[],
  subtotal: number,
  now = new Date(),
): boolean {
  if (!isCouponValid(coupon, now)) return false;
  if ((coupon.min_order_total ?? 0) > subtotal) return false;
  return eligibleSubtotal(coupon, lines) > 0;
}

/** Rounded to whole bani; never larger than the products it applies to. */
export function couponDiscount(
  coupon: CouponLike,
  lines: DiscountableLine[],
  subtotal: number,
  now = new Date(),
): number {
  if (!isCouponApplicable(coupon, lines, subtotal, now)) return 0;

  const base = eligibleSubtotal(coupon, lines);
  const value = coupon.discount_value ?? 0;
  if (value <= 0) return 0;

  const raw = coupon.discount_type === 'percent' ? (base * value) / 100 : value;
  return Math.round(Math.min(raw, base) * 100) / 100;
}

export function activeCoupons<T extends CouponLike>(coupons: T[], now = new Date()): T[] {
  return coupons.filter((coupon) => isCouponValid(coupon, now));
}
