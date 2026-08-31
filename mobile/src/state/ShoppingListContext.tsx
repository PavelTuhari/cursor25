/**
 * Shopping list state. Every mutation writes to SQLite first and queues an
 * outbox job, so the list keeps working with no connection and converges with
 * the account once the API is reachable again.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { translate } from '../db/records';
import {
  generateLocalId,
  nextSortOrder,
  sortListItems,
  type ShoppingListItem,
} from '../domain/shoppingList';
import { useApp } from './AppContext';

export interface ShoppingListValue {
  items: ShoppingListItem[];
  loading: boolean;
  addProduct: (product: { id: string; name?: unknown; unit?: string | null }) => Promise<void>;
  addManual: (title: string) => Promise<void>;
  setQuantity: (id: string, quantity: number) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearDone: () => Promise<void>;
  isInList: (productId: string) => boolean;
  count: number;
}

const ShoppingListContext = createContext<ShoppingListValue | null>(null);

export function ShoppingListProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, config, locale, dataVersion, invalidate } = useApp();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const repository = useMemo(() => db.repository<ShoppingListItem>('shopping_list_items'), [db]);

  const reload = useCallback(async () => {
    const rows = await repository.query({ entity: 'shopping_list_items', limit: 500 }, { locale });
    setItems(sortListItems(rows, true));
    setLoading(false);
  }, [repository, locale]);

  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  const persist = useCallback(
    async (item: ShoppingListItem) => {
      await repository.saveLocal({ ...item, updated_at: new Date().toISOString() });
      await reload();
      invalidate();
    },
    [repository, reload, invalidate],
  );

  const addProduct = useCallback<ShoppingListValue['addProduct']>(
    async (product) => {
      const existing = items.find((item) => item.product_id === product.id);
      if (existing) {
        await persist({ ...existing, quantity: (existing.quantity ?? 1) + 1, is_done: false });
        return;
      }
      await persist({
        id: generateLocalId('sli'),
        product_id: product.id,
        title: translate(product.name, locale, config.app.app.defaultLocale, product.id),
        quantity: 1,
        unit: product.unit ?? null,
        is_done: false,
        sort_order: nextSortOrder(items),
      });
    },
    [items, persist, locale, config.app.app.defaultLocale],
  );

  const addManual = useCallback<ShoppingListValue['addManual']>(
    async (title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      await persist({
        id: generateLocalId('sli'),
        title: trimmed,
        quantity: 1,
        is_done: false,
        sort_order: nextSortOrder(items),
      });
    },
    [items, persist],
  );

  const setQuantity = useCallback<ShoppingListValue['setQuantity']>(
    async (id, quantity) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      if (quantity <= 0) {
        await repository.deleteLocal(id);
        await reload();
        invalidate();
        return;
      }
      await persist({ ...item, quantity });
    },
    [items, persist, repository, reload, invalidate],
  );

  const toggleDone = useCallback<ShoppingListValue['toggleDone']>(
    async (id) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      await persist({ ...item, is_done: !item.is_done });
    },
    [items, persist],
  );

  const remove = useCallback<ShoppingListValue['remove']>(
    async (id) => {
      await repository.deleteLocal(id);
      await reload();
      invalidate();
    },
    [repository, reload, invalidate],
  );

  const clearDone = useCallback(async () => {
    for (const item of items.filter((entry) => entry.is_done)) {
      await repository.deleteLocal(item.id);
    }
    await reload();
    invalidate();
  }, [items, repository, reload, invalidate]);

  const isInList = useCallback(
    (productId: string) => items.some((item) => item.product_id === productId && !item.is_done),
    [items],
  );

  const value: ShoppingListValue = {
    items,
    loading,
    addProduct,
    addManual,
    setQuantity,
    toggleDone,
    remove,
    clearDone,
    isInList,
    count: items.filter((item) => !item.is_done).length,
  };

  return <ShoppingListContext.Provider value={value}>{children}</ShoppingListContext.Provider>;
}

export function useShoppingList(): ShoppingListValue {
  const value = useContext(ShoppingListContext);
  if (!value) throw new Error('useShoppingList must be used inside <ShoppingListProvider>');
  return value;
}
