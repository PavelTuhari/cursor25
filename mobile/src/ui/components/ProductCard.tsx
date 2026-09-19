/** Product tile used by carousels, grids and search results. */
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import type { EntityRecord } from '../../db/records';
import { translate } from '../../db/records';
import { formatPrice, formatUnitPrice } from '../../domain/price';
import { Badge } from './base';
import { Icon } from './Icon';

export interface ProductRecord extends EntityRecord {
  id: string;
  name?: unknown;
  brand?: string | null;
  image_url?: string | null;
  price?: number | null;
  old_price?: number | null;
  discount_percent?: number | null;
  unit?: string | null;
  unit_size?: number | null;
  stock_status?: string | null;
}

export interface ProductCardProps {
  product: ProductRecord;
  width?: number;
  onPress: (product: ProductRecord) => void;
  onAddToList?: (product: ProductRecord) => void;
  inList?: boolean;
}

export function ProductCard({ product, width, onPress, onAddToList, inList }: ProductCardProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const currency = config.app.app.currency;
  const cardConfig = config.app.catalog.productCard;

  const name = translate(product.name, locale, config.app.app.defaultLocale, product.id);
  const price = product.price ?? 0;
  const unitPriceText = cardConfig.showUnitPrice
    ? formatUnitPrice(price, product.unit_size ?? null, product.unit ?? null, currency)
    : null;
  const outOfStock = product.stock_status === 'out_of_stock';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => onPress(product)}
      style={({ pressed }) => ({
        width,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View>
        <Image
          source={{ uri: product.image_url ?? theme.images.placeholder }}
          style={{
            width: '100%',
            aspectRatio: 1,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surfaceAlt,
          }}
          resizeMode="contain"
        />
        {cardConfig.showDiscountBadge && (product.discount_percent ?? 0) > 0 ? (
          <View style={{ position: 'absolute', top: theme.spacing.xs, left: theme.spacing.xs }}>
            <Badge label={`-${product.discount_percent}%`} />
          </View>
        ) : null}
        {cardConfig.showFavoriteButton && onAddToList ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={inList ? t('product.in_list') : t('product.add_to_list')}
            onPress={() => onAddToList(product)}
            hitSlop={8}
            style={{
              position: 'absolute',
              top: theme.spacing.xs,
              right: theme.spacing.xs,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.pill,
              padding: theme.spacing.xs,
            }}
          >
            <Icon name={inList ? 'check' : 'plus'} size={16} color={inList ? theme.colors.success : theme.colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
        <Text
          style={{
            color: theme.colors.price,
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.bold as never,
          }}
        >
          {formatPrice(price, currency)}
        </Text>
        {product.old_price ? (
          <Text
            style={{
              color: theme.colors.priceOld,
              fontSize: theme.typography.sizes.sm,
              textDecorationLine: 'line-through',
            }}
          >
            {formatPrice(product.old_price, currency)}
          </Text>
        ) : null}
      </View>

      {unitPriceText ? (
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{unitPriceText}</Text>
      ) : null}

      <Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
        {name}
      </Text>
      {product.brand ? (
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{product.brand}</Text>
      ) : null}

      {cardConfig.showStockStatus && outOfStock ? (
        <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
          {t('product.out_of_stock')}
        </Text>
      ) : null}
    </Pressable>
  );
}
