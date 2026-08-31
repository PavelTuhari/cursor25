/** Product detail. */
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDate } from '../../domain/dates';
import { formatPrice, formatUnitPrice } from '../../domain/price';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery, useEntityRecord } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import type { BlockProps } from '../blocks/types';
import { Badge, Button, EmptyState, LoadingBlock, Section } from '../components/base';
import { ProductCard, type ProductRecord } from '../components/ProductCard';

export function ProductScreen({
  productId,
  navigate,
}: {
  productId: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const list = useShoppingList();
  const { data, loading } = useEntityRecord<ProductRecord>('products', productId);
  const product = data[0];

  const similar = useEntityQuery<ProductRecord>(
    product?.category_id
      ? {
          entity: 'products',
          where: [
            { field: 'category_id', op: '=', value: String(product.category_id) },
            { field: 'id', op: '!=', value: productId },
            { field: 'is_active', op: '=', value: 1 },
          ],
          orderBy: [{ field: 'discount_percent', dir: 'desc' }],
          limit: 10,
        }
      : null,
  );

  if (loading) return <LoadingBlock />;
  if (!product) return <EmptyState message={t('common.empty')} />;

  const currency = config.app.app.currency;
  const name = translate(product.name, locale, config.app.app.defaultLocale, productId);
  const description = translate(product.description, locale, config.app.app.defaultLocale, '');
  const unitPriceText = formatUnitPrice(product.price ?? 0, product.unit_size ?? null, product.unit ?? null, currency);
  const inList = list.isInList(productId);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
    >
      <Image
        source={{ uri: product.image_url ?? theme.images.placeholder }}
        style={{ width: '100%', aspectRatio: 1, backgroundColor: theme.colors.surface }}
        resizeMode="contain"
      />

      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
        {(product.discount_percent ?? 0) > 0 ? <Badge label={`-${product.discount_percent}%`} /> : null}
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold as never }}>
          {name}
        </Text>
        {product.brand ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{product.brand}</Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.md }}>
          <Text style={{ color: theme.colors.price, fontSize: theme.typography.sizes.xxl, fontWeight: theme.typography.weights.bold as never }}>
            {formatPrice(product.price ?? 0, currency)}
          </Text>
          {product.old_price ? (
            <Text style={{ color: theme.colors.priceOld, fontSize: theme.typography.sizes.md, textDecorationLine: 'line-through' }}>
              {formatPrice(product.old_price, currency)}
            </Text>
          ) : null}
        </View>
        {unitPriceText ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{unitPriceText}</Text>
        ) : null}
        {product.promo_ends_at ? (
          <Text style={{ color: theme.colors.secondary, fontSize: theme.typography.sizes.sm }}>
            {t('product.promo_until', { date: formatDate(String(product.promo_ends_at), locale) })}
          </Text>
        ) : null}

        <Text
          style={{
            color: product.stock_status === 'out_of_stock' ? theme.colors.danger : theme.colors.success,
            fontSize: theme.typography.sizes.sm,
          }}
        >
          {product.stock_status === 'out_of_stock'
            ? t('product.out_of_stock')
            : product.stock_status === 'low_stock'
              ? t('product.low_stock')
              : t('product.in_stock')}
        </Text>

        <Button
          label={inList ? t('product.in_list') : t('product.add_to_list')}
          icon={inList ? 'check' : 'plus'}
          onPress={() => void list.addProduct({ id: productId, name: product.name, unit: product.unit })}
          style={{ marginTop: theme.spacing.md }}
        />

        {description ? (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.medium as never }}>
              {t('product.description')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, lineHeight: 20 }}>
              {description}
            </Text>
          </View>
        ) : null}
      </View>

      {similar.data.length > 0 ? (
        <Section title={t('product.similar')}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
          >
            {similar.data.map((item) => (
              <ProductCard
                key={String(item.id)}
                product={item}
                width={156}
                inList={list.isInList(String(item.id))}
                onAddToList={(entry) => void list.addProduct({ id: String(entry.id), name: entry.name, unit: entry.unit })}
                onPress={(entry) => navigate('product', { productId: String(entry.id) })}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}
    </ScrollView>
  );
}
