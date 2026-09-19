/** Route names and params used by the config-driven navigator. */
export type RootStackParamList = {
  tabs: undefined;
  category: { categoryId?: string; preset?: string; title?: string } | undefined;
  product: { productId: string };
  search: { query?: string } | undefined;
  promo: { promoId: string };
  store: { storeId: string };
  stores: undefined;
  favorites: undefined;
  settings: undefined;
  login: undefined;
  account: undefined;
  receipts: undefined;
  receipt: { receiptId: string };
  cart: undefined;
  checkout: undefined;
  orders: undefined;
  order: { orderId: string };
  coupons: undefined;
  scan: undefined;
  list: undefined;
  promos: undefined;
};

export type ScreenName = keyof RootStackParamList;
