/** Promo flyer viewer: cover, pages and the products tied to the promotion. */
import React from 'react';
import { Dimensions, Image, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDate } from '../../domain/dates';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery, useEntityRecord } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import type { BlockProps } from '../blocks/types';
import { EmptyState, LoadingBlock, Section } from '../components/base';
import { ProductCard, type ProductRecord } from '../components/ProductCard';

export function PromoScreen({
  promoId,
  navigate,
}: {
  promoId: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { locale, config } = useApp();
  const list = useShoppingList();
  const { data, loading } = useEntityRecord('promotions', promoId);
  const promo = data[0];

  const products = useEntityQuery<ProductRecord>({
    entity: 'products',
    where: [{ field: 'promo_id', op: '=', value: promoId }],
    orderBy: [{ field: 'discount_percent', dir: 'desc' }],
    limit: 100,
  });

  if (loading) return <LoadingBlock />;
  if (!promo) return <EmptyState message={t('common.empty')} />;

  const pages = Array.isArray(promo.pages) ? (promo.pages as string[]) : [];
  const width = Dimensions.get('window').width;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
    >
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold as never }}>
          {translate(promo.title, locale, config.app.app.defaultLocale, '')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
          {formatDate(promo.starts_at as string, locale)} — {formatDate(promo.ends_at as string, locale)}
        </Text>
      </View>

      {pages.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {pages.map((page, index) => (
            <Image
              key={`${page}-${index}`}
              source={{ uri: page }}
              style={{ width, aspectRatio: 0.72, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="contain"
            />
          ))}
        </ScrollView>
      ) : (
        <Image
          source={{ uri: (promo.cover_url as string) ?? theme.images.placeholder }}
          style={{ width, aspectRatio: 0.72, backgroundColor: theme.colors.surfaceAlt }}
          resizeMode="contain"
        />
      )}

      {products.data.length > 0 ? (
        <Section title={t('promos.products')}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
          >
            {products.data.map((product) => (
              <ProductCard
                key={String(product.id)}
                product={product}
                width={156}
                inList={list.isInList(String(product.id))}
                onAddToList={(item) => void list.addProduct({ id: String(item.id), name: item.name, unit: item.unit })}
                onPress={(item) => navigate('product', { productId: String(item.id) })}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}
    </ScrollView>
  );
}
