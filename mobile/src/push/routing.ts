/**
 * Where a notification takes the shopper.
 *
 * The payload comes from the backend, so it is treated as untrusted input:
 * only known screens are honoured and only string parameters are passed on.
 */

export interface NotificationRoute {
  screen: string;
  params?: Record<string, string>;
}

/** Screens a notification may open; anything else is ignored. */
const ALLOWED_SCREENS = [
  'home',
  'catalog',
  'category',
  'product',
  'promos',
  'promo',
  'loyalty',
  'coupons',
  'cart',
  'orders',
  'order',
  'receipts',
  'receipt',
  'stores',
  'store',
  'search',
];

const TYPE_ROUTES: Record<string, { screen: string; param?: string; from?: string }> = {
  product: { screen: 'product', param: 'productId', from: 'product_id' },
  category: { screen: 'category', param: 'categoryId', from: 'category_id' },
  promo: { screen: 'promo', param: 'promoId', from: 'promo_id' },
  order: { screen: 'order', param: 'orderId', from: 'order_id' },
  receipt: { screen: 'receipt', param: 'receiptId', from: 'receipt_id' },
  coupon: { screen: 'coupons' },
  coupons: { screen: 'coupons' },
  orders: { screen: 'orders' },
  promotions: { screen: 'promos' },
};

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function resolveNotificationRoute(data: unknown): NotificationRoute | null {
  if (typeof data !== 'object' || data === null) return null;
  const payload = data as Record<string, unknown>;

  const screen = asString(payload.screen);
  if (screen && ALLOWED_SCREENS.includes(screen)) {
    const params = collectParams(payload.params);
    return params ? { screen, params } : { screen };
  }

  const type = asString(payload.type);
  const route = type ? TYPE_ROUTES[type] : undefined;
  if (!route) return null;

  if (!route.param) return { screen: route.screen };
  const id = asString(payload[route.from ?? route.param]) ?? asString(payload.id);
  return id ? { screen: route.screen, params: { [route.param]: id } } : null;
}

function collectParams(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null) return null;
  const params: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const asText = asString(item);
    if (asText) params[key] = asText;
  }
  return Object.keys(params).length > 0 ? params : null;
}
