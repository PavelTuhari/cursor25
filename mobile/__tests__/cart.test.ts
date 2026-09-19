import { cartTotals, clampQuantity, lineTotal, repriceLines, type CartLine } from '../src/domain/cart';
import {
  activeCoupons,
  couponDiscount,
  eligibleSubtotal,
  isCouponApplicable,
  isCouponValid,
} from '../src/domain/coupons';
import {
  availableSlots,
  isCancellable,
  isOrderOpen,
  orderLabel,
  orderProgress,
  orderStatusKey,
  toDateString,
} from '../src/domain/orders';
import { loadBundle } from './helpers';

const bundle = loadBundle();
const cartConfig = bundle.app.cart;
const currency = bundle.app.app.currency;
const now = new Date('2026-08-23T12:00:00Z');

const lines: CartLine[] = [
  { id: 'c1', product_id: 'p-1001', title: 'Lapte', price: 17.9, quantity: 2 },
  { id: 'c2', product_id: 'p-2001', title: 'Pâine', price: 9.5, quantity: 1 },
];

describe('cart totals', () => {
  it('sums the lines and formats the money', () => {
    const totals = cartTotals(lines, cartConfig, currency, { fulfillment: 'pickup' });
    expect(lineTotal(lines[0]!)).toBeCloseTo(35.8);
    expect(totals.subtotal).toBeCloseTo(45.3);
    expect(totals.quantity).toBe(3);
    expect(totals.lines).toBe(2);
    expect(totals.total).toBeCloseTo(45.3);
    expect(totals.totalText).toBe('45,30 lei');
  });

  it('keeps checkout closed below the minimum order', () => {
    const totals = cartTotals(lines, cartConfig, currency, { fulfillment: 'pickup' });
    expect(totals.missingToMinimum).toBeCloseTo(cartConfig.minOrderTotal - 45.3);
    expect(totals.canCheckout).toBe(false);

    const big = cartTotals([{ ...lines[0]!, quantity: 20 }], cartConfig, currency, { fulfillment: 'pickup' });
    expect(big.missingToMinimum).toBe(0);
    expect(big.canCheckout).toBe(true);
  });

  it('never allows checkout with an empty basket', () => {
    const totals = cartTotals([], cartConfig, currency, { fulfillment: 'pickup' });
    expect(totals.canCheckout).toBe(false);
    expect(totals.total).toBe(0);
  });

  it('charges delivery until the free-delivery threshold is reached', () => {
    const small = cartTotals([{ ...lines[0]!, quantity: 12 }], cartConfig, currency, { fulfillment: 'delivery' });
    expect(small.subtotal).toBeCloseTo(214.8);
    expect(small.deliveryFee).toBe(cartConfig.deliveryFee);
    expect(small.missingToFreeDelivery).toBeCloseTo(cartConfig.freeDeliveryFrom - 214.8);
    expect(small.total).toBeCloseTo(214.8 + cartConfig.deliveryFee);

    const large = cartTotals([{ ...lines[0]!, quantity: 30 }], cartConfig, currency, { fulfillment: 'delivery' });
    expect(large.deliveryFee).toBe(0);
    expect(large.missingToFreeDelivery).toBeNull();
  });

  it('does not charge delivery for a pickup order', () => {
    const totals = cartTotals([{ ...lines[0]!, quantity: 12 }], cartConfig, currency, { fulfillment: 'pickup' });
    expect(totals.deliveryFee).toBe(0);
    expect(totals.missingToFreeDelivery).toBeNull();
  });

  it('applies a coupon before deciding about delivery and the minimum', () => {
    const coupon = { id: 'cpn-1', discount_type: 'percent', discount_value: 10 };
    const totals = cartTotals([{ ...lines[0]!, quantity: 30 }], cartConfig, currency, {
      fulfillment: 'delivery',
      coupon,
      now,
    });
    expect(totals.subtotal).toBeCloseTo(537);
    expect(totals.discount).toBeCloseTo(53.7);
    // 537 − 53.7 = 483.3, below the 500 threshold, so delivery is charged again.
    expect(totals.deliveryFee).toBe(cartConfig.deliveryFee);
    expect(totals.total).toBeCloseTo(483.3 + cartConfig.deliveryFee);
  });

  it('clamps quantities to the configured maximum', () => {
    expect(clampQuantity(5, cartConfig)).toBe(5);
    expect(clampQuantity(0, cartConfig)).toBe(0);
    expect(clampQuantity(-3, cartConfig)).toBe(0);
    expect(clampQuantity(999, cartConfig)).toBe(cartConfig.maxQuantityPerItem);
  });
});

describe('re-pricing the basket', () => {
  it('follows the catalogue when a price changed', () => {
    const prices = new Map([['p-1001', 19.9]]);
    const { lines: repriced, changed } = repriceLines(lines, (id) => prices.get(id));

    expect(changed).toHaveLength(1);
    expect(repriced[0]!.price).toBe(19.9);
    // A product missing from the catalogue keeps the price it was added at.
    expect(repriced[1]!.price).toBe(9.5);
  });

  it('leaves everything alone when nothing moved', () => {
    const prices = new Map([
      ['p-1001', 17.9],
      ['p-2001', 9.5],
    ]);
    const { lines: repriced, changed } = repriceLines(lines, (id) => prices.get(id));
    expect(changed).toEqual([]);
    expect(repriced[0]).toBe(lines[0]);
  });

  it('ignores rounding noise below a ban', () => {
    const prices = new Map([['p-1001', 17.902]]);
    expect(repriceLines(lines, (id) => prices.get(id)).changed).toEqual([]);
  });

  it('skips manually added lines that have no product', () => {
    const manual: CartLine[] = [{ id: 'c9', title: 'Ceva', price: 5, quantity: 1 }];
    expect(repriceLines(manual, () => 9).changed).toEqual([]);
  });
});

describe('coupons', () => {
  const percent = {
    id: 'cpn-1',
    code: 'DAIRY10',
    discount_type: 'percent',
    discount_value: 10,
    product_ids: ['p-1001'],
    starts_at: '2026-08-01T00:00:00Z',
    ends_at: '2026-08-31T23:59:59Z',
  };
  const amount = { id: 'cpn-2', code: 'MINUS50', discount_type: 'amount', discount_value: 50, min_order_total: 100 };

  it('counts only the products the coupon covers', () => {
    expect(eligibleSubtotal(percent, lines)).toBeCloseTo(35.8);
    expect(couponDiscount(percent, lines, 45.3, now)).toBeCloseTo(3.58);
  });

  it('covers the whole basket when it lists no products', () => {
    expect(eligibleSubtotal(amount, lines)).toBeCloseTo(45.3);
  });

  it('respects the minimum order total', () => {
    expect(isCouponApplicable(amount, lines, 45.3, now)).toBe(false);
    expect(couponDiscount(amount, lines, 45.3, now)).toBe(0);

    const big = [{ ...lines[0]!, quantity: 10 }];
    expect(couponDiscount(amount, big, 179, now)).toBe(50);
  });

  it('never discounts more than the products it applies to', () => {
    const generous = { id: 'cpn-3', discount_type: 'amount', discount_value: 500 };
    expect(couponDiscount(generous, lines, 45.3, now)).toBeCloseTo(45.3);
  });

  it('ignores expired, not-yet-started and redeemed coupons', () => {
    expect(isCouponValid(percent, new Date('2026-09-05T12:00:00Z'))).toBe(false);
    expect(isCouponValid(percent, new Date('2026-07-05T12:00:00Z'))).toBe(false);
    expect(isCouponValid({ ...percent, used_at: '2026-08-10T10:00:00Z' }, now)).toBe(false);
    expect(isCouponValid({ id: 'cpn-4' }, now)).toBe(true);
    expect(activeCoupons([percent, { ...percent, id: 'cpn-5', used_at: '2026-08-10T10:00:00Z' }], now)).toHaveLength(1);
  });
});

describe('orders', () => {
  it('maps a status onto a translation key and a progress step', () => {
    expect(orderStatusKey('picking')).toBe('order.status.picking');
    expect(orderStatusKey('nonsense')).toBe('order.status.new');

    const pickup = orderProgress('ready', 'pickup');
    expect(pickup.steps).toContain('ready');
    expect(pickup.index).toBe(3);
    expect(pickup.done).toBe(false);

    const delivery = orderProgress('delivering', 'delivery');
    expect(delivery.steps).toContain('delivering');
    expect(delivery.index).toBe(3);

    const cancelled = orderProgress('cancelled', 'pickup');
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.index).toBe(-1);
  });

  it('knows which orders can still be cancelled or are still open', () => {
    expect(isCancellable('new')).toBe(true);
    expect(isCancellable('confirmed')).toBe(true);
    expect(isCancellable('picking')).toBe(false);
    expect(isOrderOpen('delivering')).toBe(true);
    expect(isOrderOpen('completed')).toBe(false);
    expect(isOrderOpen('cancelled')).toBe(false);
  });

  it('labels an order by its number, falling back to the local id', () => {
    expect(orderLabel({ id: 'ord_abc123def', number: '2026000012' })).toBe('2026000012');
    expect(orderLabel({ id: 'ord_abc123def', number: null })).toBe('123DEF');
  });

  it('offers slots for the next days and drops the ones already started today', () => {
    const midday = new Date(2026, 7, 23, 13, 30);
    const slots = availableSlots(cartConfig, midday);

    expect(slots[0]!.date).toBe(toDateString(midday));
    expect(slots[0]!.times).not.toContain('10:00-12:00');
    expect(slots[0]!.times).toContain('14:00-16:00');
    expect(slots).toHaveLength(cartConfig.slotDays);
    expect(slots[1]!.times).toEqual(cartConfig.slotHours);
  });

  it('drops today entirely once every slot has started', () => {
    const late = new Date(2026, 7, 23, 21, 0);
    const slots = availableSlots(cartConfig, late);
    expect(slots).toHaveLength(cartConfig.slotDays - 1);
    expect(slots[0]!.date).not.toBe(toDateString(late));
  });
});
