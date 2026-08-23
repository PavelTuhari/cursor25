/** Stores, shopping list, profile and sync-status blocks. */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDateTime } from '../../domain/dates';
import { listTotals } from '../../domain/shoppingList';
import { isOpenAt, sortByDistance, type WorkingHours } from '../../domain/stores';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import { asAction, runAction } from '../actions';
import { Badge, Button, Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { isVisible } from '../visibility';
import { blockBoolean, blockNumber, blockQuery, type BlockProps } from './types';

function StoreRow({
  store,
  distanceKm,
  onPress,
  showHours,
}: {
  store: Record<string, unknown>;
  distanceKm: number | null;
  onPress: () => void;
  showHours: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { locale, config, storeId } = useApp();
  const openState = isOpenAt(store.working_hours as WorkingHours | null, new Date());

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Icon name="pin" size={22} color={theme.colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
            {translate(store.name, locale, config.app.app.defaultLocale, String(store.id))}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
            {translate(store.address, locale, config.app.app.defaultLocale, '')}
          </Text>
          {showHours ? (
            <Text
              style={{
                color: openState.open ? theme.colors.success : theme.colors.danger,
                fontSize: theme.typography.sizes.xs,
              }}
            >
              {openState.open ? t('stores.open_now') : t('stores.closed')}
              {openState.until ? ` · ${t('stores.until', { time: openState.until })}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {distanceKm !== null ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('stores.distance', { km: distanceKm.toFixed(1) })}
            </Text>
          ) : null}
          {storeId === store.id ? <Badge label={t('stores.selected')} tone="success" /> : null}
        </View>
      </View>
    </Card>
  );
}

export function StoreListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { data, loading } = useEntityQuery(blockQuery(block));
  const showHours = blockBoolean(block, 'showWorkingHours', true);
  // Device location is requested by the stores screen; without it the API order is kept.
  const stores = useMemo(
    () =>
      sortByDistance(
        data.map((store) => ({
          id: String(store.id),
          latitude: typeof store.latitude === 'number' ? store.latitude : null,
          longitude: typeof store.longitude === 'number' ? store.longitude : null,
          record: store,
        })),
        null,
      ),
    [data],
  );

  if (loading) return <LoadingBlock />;
  if (stores.length === 0) return <EmptyState message={t('common.empty')} />;

  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
      {stores.map((store) => (
        <StoreRow
          key={store.id}
          store={store.record}
          distanceKm={store.distanceKm}
          showHours={showHours}
          onPress={() => navigate('store', { storeId: store.id })}
        />
      ))}
    </View>
  );
}

export function StoreLocatorCardBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const limit = blockNumber(block, 'limit', 3);
  const { data, loading } = useEntityQuery({
    entity: 'stores',
    where: [{ field: 'is_active', op: '=', value: 1 }],
    limit,
  });
  const action = asAction(block.props?.action);

  if (loading || data.length === 0) return null;

  return (
    <Section
      title={block.titleKey ? t(block.titleKey) : undefined}
      actionLabel={action ? t('common.more') : undefined}
      onAction={action ? () => runAction(action, { navigate }) : undefined}
    >
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        {data.map((store) => (
          <StoreRow
            key={String(store.id)}
            store={store}
            distanceKm={null}
            showHours
            onPress={() => navigate('store', { storeId: String(store.id) })}
          />
        ))}
      </View>
    </Section>
  );
}

export function ShoppingListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const list = useShoppingList();
  const [draft, setDraft] = useState('');
  const showTotals = blockBoolean(block, 'showTotals', true);
  const suggestions = useEntityQuery(blockQuery(block, 'suggestions'));

  const productIds = list.items.map((item) => item.product_id).filter((id): id is string => typeof id === 'string');
  const products = useEntityQuery(
    productIds.length > 0 ? { entity: 'products', where: [{ field: 'id', op: 'in', value: productIds }] } : null,
  );
  const priceById = new Map(products.data.map((product) => [String(product.id), Number(product.price ?? 0)]));
  const totals = listTotals(
    list.items,
    (item) => (item.product_id ? priceById.get(String(item.product_id)) ?? null : null),
    config.app.app.currency,
  );

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('list.add_placeholder')}
          placeholderTextColor={theme.colors.textMuted}
          onSubmitEditing={() => {
            void list.addManual(draft);
            setDraft('');
          }}
          style={{
            flex: 1,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            color: theme.colors.text,
          }}
        />
        <Button
          label="+"
          onPress={() => {
            void list.addManual(draft);
            setDraft('');
          }}
        />
      </View>

      {showTotals && list.items.length > 0 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
            {t('list.items', { count: totals.pending })}
          </Text>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
            {t('list.total', { total: totals.estimatedText })}
          </Text>
        </View>
      ) : null}

      {list.items.length === 0 ? <EmptyState message={t('list.empty')} icon="list" /> : null}

      {list.items.map((item) => (
        <Card key={item.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: Boolean(item.is_done) }}
              onPress={() => void list.toggleDone(item.id)}
              hitSlop={8}
            >
              <Icon
                name={item.is_done ? 'check' : 'plus'}
                size={20}
                color={item.is_done ? theme.colors.success : theme.colors.textMuted}
              />
            </Pressable>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => (item.product_id ? navigate('product', { productId: String(item.product_id) }) : undefined)}
            >
              <Text
                style={{
                  color: item.is_done ? theme.colors.textMuted : theme.colors.text,
                  textDecorationLine: item.is_done ? 'line-through' : 'none',
                  fontSize: theme.typography.sizes.md,
                }}
              >
                {item.title ?? ''}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Pressable onPress={() => void list.setQuantity(item.id, (item.quantity ?? 1) - 1)} hitSlop={8}>
                <Icon name="minus" size={18} color={theme.colors.text} />
              </Pressable>
              <Text style={{ color: theme.colors.text, minWidth: 24, textAlign: 'center' }}>{item.quantity ?? 1}</Text>
              <Pressable onPress={() => void list.setQuantity(item.id, (item.quantity ?? 1) + 1)} hitSlop={8}>
                <Icon name="plus" size={18} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>
        </Card>
      ))}

      {totals.done > 0 ? (
        <Button label={t('list.clear_done')} variant="secondary" onPress={() => void list.clearDone()} />
      ) : null}

      {suggestions.data.length > 0 ? (
        <Section title={t('home.deals')} style={{ marginTop: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.sm }}>
            {suggestions.data.slice(0, 5).map((product) => (
              <Card
                key={String(product.id)}
                onPress={() => void list.addProduct({ id: String(product.id), name: product.name, unit: product.unit as string })}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.colors.text, flex: 1 }} numberOfLines={1}>
                    {translate(product.name, locale, config.app.app.defaultLocale, String(product.id))}
                  </Text>
                  <Icon name="plus" size={18} color={theme.colors.primary} />
                </View>
              </Card>
            ))}
          </View>
        </Section>
      ) : null}
    </View>
  );
}

export function ProfileHeaderBlock(_: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { session, config } = useApp();

  return (
    <View style={{ padding: theme.spacing.lg }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.primaryMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="user" size={24} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg }}>
              {session.displayName ?? t('profile.guest')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {config.app.app.name} · {config.app.app.tenantId}
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

export function MenuListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, session, locale } = useApp();
  const items = Array.isArray(block.props?.items) ? (block.props?.items as Record<string, unknown>[]) : [];

  const visibleItems = items.filter((item) =>
    isVisible(item.visibleIf as never, {
      features: config.app.features,
      isAuthenticated: Boolean(session.userId),
      locale,
    }),
  );

  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
      {visibleItems.map((item) => (
        <Card key={String(item.id)} onPress={() => runAction(asAction(item.action), { navigate })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Icon name={String(item.icon ?? 'info')} size={20} color={theme.colors.primary} />
            <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {t(String(item.titleKey))}
            </Text>
            <Icon name="chevron" size={20} color={theme.colors.textMuted} />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function SyncStatusBlock(_: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { syncStatus, runSync, locale } = useApp();

  return (
    <View style={{ padding: theme.spacing.lg }}>
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Icon name="cloud" size={20} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, flex: 1 }}>
              {t('sync.title')}
            </Text>
          </View>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
            {syncStatus.running
              ? t('sync.in_progress')
              : t('sync.last', {
                  time: syncStatus.lastSyncAt ? formatDateTime(syncStatus.lastSyncAt, locale) : t('sync.never'),
                })}
          </Text>
          {syncStatus.pending > 0 ? (
            <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.sm }}>
              {t('sync.pending', { count: syncStatus.pending })}
            </Text>
          ) : null}
          {syncStatus.error ? (
            <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
              {t('sync.error', { message: syncStatus.error })}
            </Text>
          ) : null}
          <Button
            label={t('sync.now')}
            icon="refresh"
            variant="secondary"
            disabled={syncStatus.running}
            onPress={() => void runSync()}
          />
        </View>
      </Card>
    </View>
  );
}
