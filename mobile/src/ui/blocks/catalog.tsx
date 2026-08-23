/** Catalogue blocks: search entry point, banners, category and product lists. */
import React from 'react';
import { Dimensions, FlatList, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { translate, type EntityRecord } from '../../db/records';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import { asAction, runAction } from '../actions';
import { Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { ProductCard, type ProductRecord } from '../components/ProductCard';
import { blockNumber, blockQuery, blockString, type BlockProps } from './types';

function useBlockTitle(block: BlockProps['block']): string | undefined {
  const t = useT();
  const { locale, config } = useApp();
  if (block.titleKey) return t(block.titleKey);
  if (block.title) return translate(block.title, locale, config.app.app.defaultLocale);
  return undefined;
}

export function SearchBarBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const placeholderKey = blockString(block, 'placeholderKey') ?? 'search.placeholder';
  const target = blockString(block, 'target') ?? 'search';

  return (
    <Pressable
      accessibilityRole="search"
      onPress={() => navigate(target)}
      style={{
        marginHorizontal: theme.spacing.lg,
        marginTop: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.pill,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Icon name="search" size={18} color={theme.colors.textMuted} />
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.md }}>{t(placeholderKey)}</Text>
    </Pressable>
  );
}

export function HeroCarouselBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const { data, loading } = useEntityQuery(blockQuery(block));
  const aspectRatio = blockNumber(block, 'aspectRatio', 1.9);
  const width = Dimensions.get('window').width - theme.spacing.lg * 2;

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return null;

  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
      style={{ marginTop: theme.spacing.md }}
    >
      {data.map((banner) => (
        <Pressable
          key={String(banner.id)}
          accessibilityRole="button"
          onPress={() => runAction(asAction(banner.action), { navigate })}
        >
          <Image
            source={{ uri: (banner.image_url as string) ?? theme.images.placeholder }}
            style={{
              width,
              aspectRatio,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surfaceAlt,
            }}
            resizeMode="cover"
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CategoryTile({
  category,
  size,
  onPress,
}: {
  category: EntityRecord;
  size: number;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { locale, config } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ width: size, alignItems: 'center', gap: theme.spacing.xs }}
    >
      <Image
        source={{ uri: (category.image_url as string) ?? theme.images.placeholder }}
        style={{
          width: size - theme.spacing.md,
          height: size - theme.spacing.md,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
        }}
        resizeMode="contain"
      />
      <Text
        numberOfLines={2}
        style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xs, textAlign: 'center' }}
      >
        {translate(category.name, locale, config.app.app.defaultLocale, String(category.id))}
      </Text>
    </Pressable>
  );
}

export function CategoryGridBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const title = useBlockTitle(block);
  const { data, loading } = useEntityQuery(blockQuery(block));
  const columns = blockNumber(block, 'columns', 4);
  const size = (Dimensions.get('window').width - theme.spacing.lg * 2) / columns;
  const moreAction = asAction(block.props?.moreAction);

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return null;

  return (
    <Section
      title={title}
      actionLabel={moreAction ? t('common.more') : undefined}
      onAction={moreAction ? () => runAction(moreAction, { navigate }) : undefined}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingHorizontal: theme.spacing.lg,
          rowGap: theme.spacing.md,
        }}
      >
        {data.map((category) => (
          <CategoryTile
            key={String(category.id)}
            category={category}
            size={size}
            onPress={() => navigate('category', { categoryId: String(category.id) })}
          />
        ))}
      </View>
    </Section>
  );
}

export function CategoryListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { locale, config } = useApp();
  const { data, loading } = useEntityQuery(blockQuery(block));

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return <EmptyState message={t('common.empty')} />;

  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
      {data.map((category) => (
        <Card key={String(category.id)} onPress={() => navigate('category', { categoryId: String(category.id) })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Image
              source={{ uri: (category.image_url as string) ?? theme.images.placeholder }}
              style={{ width: 44, height: 44, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="contain"
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                {translate(category.name, locale, config.app.app.defaultLocale, String(category.id))}
              </Text>
              {typeof category.product_count === 'number' && category.product_count > 0 ? (
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {category.product_count}
                </Text>
              ) : null}
            </View>
            <Icon name="chevron" size={20} color={theme.colors.textMuted} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function ProductCarouselBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const title = useBlockTitle(block);
  const { data, loading } = useEntityQuery<ProductRecord>(blockQuery(block));
  const cardWidth = blockNumber(block, 'cardWidth', 156);
  const shoppingList = useShoppingList();
  const moreAction = asAction(block.props?.moreAction);

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return null;

  return (
    <Section
      title={title}
      actionLabel={moreAction ? t('common.more') : undefined}
      onAction={moreAction ? () => runAction(moreAction, { navigate }) : undefined}
    >
      <FlatList
        horizontal
        data={data}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            width={cardWidth}
            inList={shoppingList.isInList(String(item.id))}
            onAddToList={(product) => void shoppingList.addProduct({ id: String(product.id), name: product.name, unit: product.unit })}
            onPress={(product) => navigate('product', { productId: String(product.id) })}
          />
        )}
      />
    </Section>
  );
}

export function ProductGridBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config } = useApp();
  const title = useBlockTitle(block);
  const { data, loading } = useEntityQuery<ProductRecord>(blockQuery(block));
  const columns = blockNumber(block, 'columns', config.app.catalog.gridColumns);
  const shoppingList = useShoppingList();
  const width = (Dimensions.get('window').width - theme.spacing.lg * 2 - theme.spacing.md * (columns - 1)) / columns;

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return <EmptyState message={t('category.empty')} />;

  return (
    <Section title={title}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
        }}
      >
        {data.map((product) => (
          <ProductCard
            key={String(product.id)}
            product={product}
            width={width}
            inList={shoppingList.isInList(String(product.id))}
            onAddToList={(item) => void shoppingList.addProduct({ id: String(item.id), name: item.name, unit: item.unit })}
            onPress={(item) => navigate('product', { productId: String(item.id) })}
          />
        ))}
      </View>
    </Section>
  );
}
