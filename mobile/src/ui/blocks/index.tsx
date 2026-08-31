/**
 * Block registry: the bridge between a `type` string in a JSON screen config
 * and a React component. `BLOCK_TYPES` is also what the config validator
 * checks against, so a typo in a config is caught before it ships.
 */
import React from 'react';

import type { BlockConfig } from '../../config/types';
import { useApp } from '../../state/AppContext';
import { ErrorBlock } from '../components/base';
import { isVisible } from '../visibility';
import {
  CategoryGridBlock,
  CategoryListBlock,
  HeroCarouselBlock,
  ProductCarouselBlock,
  ProductGridBlock,
  SearchBarBlock,
} from './catalog';
import { InfoBannerBlock, LoyaltyCardBlock, PromoFlyersBlock } from './promo';
import { LoginPromptBlock, LogoutButtonBlock, PurchaseHistoryBlock, ReceiptListBlock } from './account';
import {
  MenuListBlock,
  ProfileHeaderBlock,
  ShoppingListBlock,
  StoreListBlock,
  StoreLocatorCardBlock,
  SyncStatusBlock,
} from './misc';
import { BLOCK_TYPE_NAMES } from './blockTypes';
import type { BlockComponent, BlockProps } from './types';

export const BLOCK_REGISTRY: Record<string, BlockComponent> = {
  search_bar: SearchBarBlock,
  hero_carousel: HeroCarouselBlock,
  category_grid: CategoryGridBlock,
  category_list: CategoryListBlock,
  product_carousel: ProductCarouselBlock,
  product_grid: ProductGridBlock,
  promo_flyers: PromoFlyersBlock,
  loyalty_card: LoyaltyCardBlock,
  info_banner: InfoBannerBlock,
  store_list: StoreListBlock,
  store_locator_card: StoreLocatorCardBlock,
  shopping_list: ShoppingListBlock,
  profile_header: ProfileHeaderBlock,
  login_prompt: LoginPromptBlock,
  logout_button: LogoutButtonBlock,
  purchase_history: PurchaseHistoryBlock,
  receipt_list: ReceiptListBlock,
  menu_list: MenuListBlock,
  sync_status: SyncStatusBlock,
};

export const BLOCK_TYPES: string[] = [...BLOCK_TYPE_NAMES];

export function BlockRenderer({ block, navigate }: BlockProps): React.ReactElement | null {
  const { config, isAuthenticated, locale } = useApp();

  const visible = isVisible(block.visibleIf, {
    features: config.app.features,
    isAuthenticated,
    locale,
  });
  if (!visible) return null;

  const Component = BLOCK_REGISTRY[block.type];
  if (!Component) {
    // A config from the server may reference a block an older build lacks.
    if (__DEV__) return <ErrorBlock message={`Unknown block type "${block.type}"`} />;
    return null;
  }
  return <Component block={block} navigate={navigate} />;
}

export function renderBlocks(
  blocks: BlockConfig[],
  navigate: BlockProps['navigate'],
): React.ReactElement[] {
  return blocks.map((block) => <BlockRenderer key={block.id} block={block} navigate={navigate} />);
}
