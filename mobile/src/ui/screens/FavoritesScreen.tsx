/** Products the user marked as favourite; the list itself syncs bidirectionally. */
import React, { useMemo } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import type { BlockProps } from '../blocks/types';
import { EmptyState, LoadingBlock } from '../components/base';
import { ProductCard, type ProductRecord } from '../components/ProductCard';

export function FavoritesScreen({ navigate }: { navigate: BlockProps['navigate'] }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config } = useApp();
  const list = useShoppingList();
  const favorites = useEntityQuery({ entity: 'favorites', limit: 500 });

  const productIds = useMemo(
    () => favorites.data.map((item) => String(item.product_id)).filter((id) => id !== 'null'),
    [favorites.data],
  );
  const products = useEntityQuery<ProductRecord>(
    productIds.length > 0 ? { entity: 'products', where: [{ field: 'id', op: 'in', value: productIds }], limit: 500 } : null,
  );

  const columns = config.app.catalog.gridColumns;
  const width = (Dimensions.get('window').width - theme.spacing.lg * 2 - theme.spacing.md * (columns - 1)) / columns;

  if (favorites.loading || products.loading) return <LoadingBlock />;
  if (products.data.length === 0) return <EmptyState message={t('common.empty')} icon="heart" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
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
