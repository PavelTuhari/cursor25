/** Products of one category (or a preset such as "deals"), with sorting. */
import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';

import type { DataQuery, QueryCondition, QueryOrder } from '../../config/types';
import { translate } from '../../db/records';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery, useEntityRecord } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import { EmptyState, LoadingBlock } from '../components/base';
import { ProductCard, type ProductRecord } from '../components/ProductCard';
import type { BlockProps } from '../blocks/types';

type SortKey = 'popular' | 'price_asc' | 'price_desc' | 'discount';

const SORTS: Record<SortKey, QueryOrder[]> = {
  popular: [{ field: 'sort_order', dir: 'asc' }, { field: 'rating', dir: 'desc' }],
  price_asc: [{ field: 'price', dir: 'asc' }],
  price_desc: [{ field: 'price', dir: 'desc' }],
  discount: [{ field: 'discount_percent', dir: 'desc' }],
};

export function CategoryScreen({
  categoryId,
  preset,
  navigate,
}: {
  categoryId?: string;
  preset?: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const [sort, setSort] = useState<SortKey>(preset === 'deals' ? 'discount' : 'popular');
  const list = useShoppingList();

  const category = useEntityRecord('categories', categoryId ?? null);
  const subcategories = useEntityQuery(
    categoryId
      ? {
          entity: 'categories',
          where: [
            { field: 'parent_id', op: '=', value: categoryId },
            { field: 'is_active', op: '=', value: 1 },
          ],
          orderBy: [{ field: 'sort_order', dir: 'asc' }],
          limit: 50,
        }
      : null,
  );

  const query = useMemo<DataQuery>(() => {
    const where: QueryCondition[] = [{ field: 'is_active', op: '=', value: 1 }];
    if (categoryId) where.push({ field: 'category_id', op: '=', value: categoryId });
    if (preset === 'deals') where.push({ field: 'discount_percent', op: '>', value: 0 });
    return {
      entity: 'products',
      where,
      orderBy: SORTS[sort],
      limit: config.app.catalog.pageSize * 4,
    };
  }, [categoryId, preset, sort, config.app.catalog.pageSize]);

  const products = useEntityQuery<ProductRecord>(query);
  const columns = config.app.catalog.gridColumns;
  const width = (Dimensions.get('window').width - theme.spacing.lg * 2 - theme.spacing.md * (columns - 1)) / columns;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
    >
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weights.bold as never,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
        }}
      >
        {category.data[0]
          ? translate(category.data[0].name, locale, config.app.app.defaultLocale, '')
          : preset === 'deals'
            ? t('home.deals')
            : t('category.all_products')}
      </Text>

      {subcategories.data.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm, paddingTop: theme.spacing.md }}
        >
          {subcategories.data.map((item) => (
            <Pressable
              key={String(item.id)}
              onPress={() => navigate('category', { categoryId: String(item.id) })}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.pill,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                {translate(item.name, locale, config.app.app.defaultLocale, '')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm, paddingTop: theme.spacing.md }}
      >
        {(Object.keys(SORTS) as SortKey[]).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: sort === key }}
            onPress={() => setSort(key)}
            style={{
              backgroundColor: sort === key ? theme.colors.primary : theme.colors.surface,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
            }}
          >
            <Text
              style={{
                color: sort === key ? theme.colors.onPrimary : theme.colors.text,
                fontSize: theme.typography.sizes.sm,
              }}
            >
              {t(`sort.${key}`)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {products.loading ? <LoadingBlock /> : null}
      {!products.loading && products.data.length === 0 ? <EmptyState message={t('category.empty')} /> : null}

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
        }}
      >
        {products.data.map((product) => (
          <ProductCard
            key={String(product.id)}
            product={product}
            width={width}
            inList={list.isInList(String(product.id))}
            onAddToList={(item) => void list.addProduct({ id: String(item.id), name: item.name, unit: item.unit })}
            onPress={(item) => navigate('product', { productId: String(item.id) })}
          />
        ))}
      </View>
    </ScrollView>
  );
}
