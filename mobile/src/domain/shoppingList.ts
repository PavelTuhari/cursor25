/** Shopping-list maths shared by the list screen and the tab badge. */
import type { CurrencyConfig } from '../config/types';
import { formatPrice } from './price';

export interface ShoppingListItem {
  /** Records come from the generic repository, which returns open records. */
  [key: string]: unknown;
  id: string;
  product_id?: string | null;
  title?: string | null;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  is_done?: boolean | null;
  sort_order?: number | null;
  updated_at?: string | null;
}

export interface ListTotals {
  items: number;
  pending: number;
  done: number;
  estimated: number;
  estimatedText: string;
}

export function listTotals(
  items: ShoppingListItem[],
  priceOf: (item: ShoppingListItem) => number | null,
  currency: CurrencyConfig,
): ListTotals {
  let estimated = 0;
  let done = 0;
  for (const item of items) {
    if (item.is_done) done += 1;
    const price = priceOf(item);
    if (price !== null) estimated += price * (item.quantity ?? 1);
  }
  return {
    items: items.length,
    pending: items.length - done,
    done,
    estimated,
    estimatedText: formatPrice(estimated, currency),
  };
}

/** Done items sink to the bottom; the rest keep their manual order. */
export function sortListItems(items: ShoppingListItem[], groupDoneAtBottom: boolean): ShoppingListItem[] {
  return [...items].sort((a, b) => {
    if (groupDoneAtBottom && Boolean(a.is_done) !== Boolean(b.is_done)) {
      return a.is_done ? 1 : -1;
    }
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

export function nextSortOrder(items: ShoppingListItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0) + 10;
}

/** Ids are generated on the device so an offline item can be pushed later. */
export function generateLocalId(prefix: string, random: () => number = Math.random): string {
  const now = Date.now().toString(36);
  const noise = Math.floor(random() * 0xffffff).toString(36).padStart(4, '0');
  return `${prefix}_${now}${noise}`;
}
