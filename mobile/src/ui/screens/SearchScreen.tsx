/** Full-text search over the offline catalogue, with recent queries. */
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { DataQuery } from '../../config/types';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import type { BlockProps } from '../blocks/types';
import { EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { ProductCard, type ProductRecord } from '../components/ProductCard';

export function SearchScreen({
  initialQuery,
  navigate,
}: {
  initialQuery?: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, db } = useApp();
  const list = useShoppingList();
  const [text, setText] = useState(initialQuery ?? '');
  const [debounced, setDebounced] = useState(text);
  const [history, setHistory] = useState<string[]>([]);

  const searchConfig = config.app.search;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), searchConfig.debounceMs);
    return () => clearTimeout(timer);
  }, [text, searchConfig.debounceMs]);

  useEffect(() => {
    void db.searchHistory(searchConfig.historySize).then(setHistory);
  }, [db, searchConfig.historySize, debounced]);

  useEffect(() => {
    if (debounced.trim().length >= searchConfig.minChars) {
      void db.rememberSearch(debounced, searchConfig.historySize);
    }
  }, [db, debounced, searchConfig]);

  const query = useMemo<DataQuery | null>(() => {
    if (debounced.trim().length < searchConfig.minChars) return null;
    return {
      entity: 'products',
      search: debounced,
      where: [{ field: 'is_active', op: '=', value: 1 }],
      orderBy: [{ field: 'discount_percent', dir: 'desc' }],
      limit: config.app.catalog.pageSize * 3,
    };
  }, [debounced, searchConfig.minChars, config.app.catalog.pageSize]);

  const results = useEntityQuery<ProductRecord>(query);
  const columns = config.app.catalog.gridColumns;
  const width = (Dimensions.get('window').width - theme.spacing.lg * 2 - theme.spacing.md * (columns - 1)) / columns;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
    >
      <View
        style={{
          margin: theme.spacing.lg,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <Icon name="search" size={18} color={theme.colors.textMuted} />
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          style={{ flex: 1, paddingVertical: theme.spacing.md, color: theme.colors.text }}
        />
        {text.length > 0 ? (
          <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Icon name="close" size={16} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {query === null ? (
        <>
          <EmptyState message={t('search.hint', { min: searchConfig.minChars })} icon="search" />
          {history.length > 0 ? (
            <Section title={t('search.history')}>
              <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
                {history.map((item) => (
                  <Pressable key={item} onPress={() => setText(item)} accessibilityRole="button">
                    <Text style={{ color: theme.colors.text, paddingVertical: theme.spacing.sm }}>{item}</Text>
                  </Pressable>
                ))}
              </View>
            </Section>
          ) : null}
        </>
      ) : results.loading ? (
        <LoadingBlock />
      ) : results.data.length === 0 ? (
        <EmptyState message={t('search.empty', { query: debounced })} />
      ) : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          {results.data.map((product) => (
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
      )}
    </ScrollView>
  );
}
