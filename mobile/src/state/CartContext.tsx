/**
 * The basket and checkout.
 *
 * `cart_items` is a device-only table: a basket belongs to the phone it was
 * filled on, so it is never synced. Placing an order turns it into a row in
 * `orders`, which is bidirectional — the order is written locally, queued in
 * the outbox and delivered to the API as soon as there is a connection.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { translate, type EntityRecord } from '../db/records';
import {
  cartTotals,
  clampQuantity,
  repriceLines,
  type CartLine,
  type CartTotals,
  type Fulfillment,
} from '../domain/cart';
import type { CouponLike } from '../domain/coupons';
import { generateLocalId } from '../domain/shoppingList';
import { useApp } from './AppContext';

export interface CheckoutInput {
  fulfillment: Fulfillment;
  storeId?: string | null;
  address?: string | null;
  phone?: string | null;
  comment?: string | null;
  slotDate?: string | null;
  slotTime?: string | null;
  paymentMethod?: string;
}

export interface PlacedOrder {
  id: string;
  total: number;
}

export interface CartValue {
  items: CartLine[];
  loading: boolean;
  count: number;
  coupon: CouponLike | null;
  setCoupon: (coupon: CouponLike | null) => void;
  totals: (fulfillment: Fulfillment) => CartTotals;
  add: (product: { id: string; name?: unknown; price?: number | null; unit?: string | null; image_url?: string | null }, quantity?: number) => Promise<void>;
  setQuantity: (id: string, quantity: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  quantityOf: (productId: string) => number;
  checkout: (input: CheckoutInput) => Promise<PlacedOrder>;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, config, locale, dataVersion, invalidate, session, runSync } = useApp();
  const [items, setItems] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [coupon, setCoupon] = useState<CouponLike | null>(null);

  const repository = useMemo(() => db.repository<CartLine>('cart_items'), [db]);
  const cartConfig = config.app.cart;
  const currency = config.app.app.currency;

  const reload = useCallback(async () => {
    const rows = await repository.query(
      { entity: 'cart_items', orderBy: [{ field: 'added_at', dir: 'asc' }], limit: 500 },
      { locale },
    );

    // Prices move with every sync; the basket follows the catalogue.
    const productIds = rows
      .map((row) => row.product_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const products = productIds.length
      ? await db.repository('products').query(
          { entity: 'products', select: ['id', 'price'], where: [{ field: 'id', op: 'in', value: productIds }] },
          { locale },
        )
      : [];
    const priceById = new Map(products.map((product) => [String(product.id), Number(product.price ?? 0)]));

    const { lines, changed } = repriceLines(rows, (productId) => priceById.get(productId));
    for (const line of changed) {
      await repository.saveLocal({ ...line, updated_at: new Date().toISOString() });
    }

    setItems(lines);
    setLoading(false);
  }, [repository, db, locale]);

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  const persist = useCallback(
    async (line: CartLine) => {
      // `cart_items` is a local entity, so this write queues nothing.
      await repository.saveLocal({ ...line, updated_at: new Date().toISOString() });
      await reload();
    },
    [repository, reload],
  );

  const add = useCallback<CartValue['add']>(
    async (product, quantity = 1) => {
      const existing = items.find((line) => line.product_id === product.id);
      if (existing) {
        const next = clampQuantity((existing.quantity ?? 1) + quantity, cartConfig);
        await persist({ ...existing, quantity: next });
        return;
      }
      const now = new Date().toISOString();
      await persist({
        id: generateLocalId('cart'),
        product_id: product.id,
        title: translate(product.name, locale, config.app.app.defaultLocale, product.id),
        price: product.price ?? 0,
        unit: product.unit ?? null,
        image_url: product.image_url ?? null,
        quantity: clampQuantity(quantity, cartConfig),
        added_at: now,
      });
    },
    [items, persist, cartConfig, locale, config.app.app.defaultLocale],
  );

  const remove = useCallback<CartValue['remove']>(
    async (id) => {
      await repository.deleteLocal(id);
      await reload();
    },
    [repository, reload],
  );

  const setQuantity = useCallback<CartValue['setQuantity']>(
    async (id, quantity) => {
      const line = items.find((item) => item.id === id);
      if (!line) return;
      const next = clampQuantity(quantity, cartConfig);
      if (next === 0) {
        await remove(id);
        return;
      }
      await persist({ ...line, quantity: next });
    },
    [items, persist, remove, cartConfig],
  );

  const clear = useCallback(async () => {
    await repository.clear();
    setCoupon(null);
    await reload();
  }, [repository, reload]);

  const totals = useCallback(
    (fulfillment: Fulfillment) => cartTotals(items, cartConfig, currency, { fulfillment, coupon }),
    [items, cartConfig, currency, coupon],
  );

  const quantityOf = useCallback(
    (productId: string) => items.find((line) => line.product_id === productId)?.quantity ?? 0,
    [items],
  );

  const checkout = useCallback<CartValue['checkout']>(
    async (input) => {
      const summary = totals(input.fulfillment);
      if (!summary.canCheckout) {
        throw new Error('cart is below the minimum order total');
      }

      const now = new Date().toISOString();
      const order: EntityRecord = {
        id: generateLocalId('ord'),
        status: 'new',
        fulfillment: input.fulfillment,
        store_id: input.storeId ?? null,
        address: input.address ?? null,
        phone: input.phone ?? session?.phone ?? null,
        comment: input.comment ?? null,
        slot_date: input.slotDate ?? null,
        slot_time: input.slotTime ?? null,
        items: items.map((line) => ({
          product_id: line.product_id,
          title: line.title,
          quantity: line.quantity,
          unit: line.unit,
          price: line.price,
          total: (line.price ?? 0) * (line.quantity ?? 1),
        })),
        item_count: items.length,
        subtotal: summary.subtotal,
        discount_total: summary.discount,
        delivery_fee: summary.deliveryFee,
        total: summary.total,
        coupon_code: coupon?.code ?? null,
        payment_method: input.paymentMethod ?? 'cash',
        placed_at: now,
        updated_at: now,
      };

      await db.repository('orders').saveLocal(order);
      await clear();
      invalidate();
      // Best effort: if there is a connection the order leaves immediately.
      void runSync();
      return { id: String(order.id), total: summary.total };
    },
    [totals, items, coupon, session, db, clear, invalidate, runSync],
  );

  const value: CartValue = {
    items,
    loading,
    count: items.length,
    coupon,
    setCoupon,
    totals,
    add,
    setQuantity,
    remove,
    clear,
    quantityOf,
    checkout,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
