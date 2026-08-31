/**
 * The block types a screen config may use. Kept free of React imports so the
 * config validator and CI tooling can use it without a UI runtime; the registry
 * in `index.tsx` is checked against this list by the test suite.
 */
export const BLOCK_TYPE_NAMES = [
  'search_bar',
  'hero_carousel',
  'category_grid',
  'category_list',
  'product_carousel',
  'product_grid',
  'promo_flyers',
  'loyalty_card',
  'info_banner',
  'store_list',
  'store_locator_card',
  'shopping_list',
  'profile_header',
  'login_prompt',
  'logout_button',
  'purchase_history',
  'receipt_list',
  'menu_list',
  'sync_status',
] as const;

export type BlockTypeName = (typeof BLOCK_TYPE_NAMES)[number];
