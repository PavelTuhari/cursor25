/** One order: progress, contents and what the shopper can still do with it. */
import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDateTime } from '../../domain/dates';
import { isCancellable, orderLabel, orderProgress, orderStatusKey } from '../../domain/orders';
import { formatPrice } from '../../domain/price';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useCart } from '../../state/CartContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { Badge, Button, Card, EmptyState, LoadingBlock } from '../components/base';
import { Icon } from '../components/Icon';
import type { BlockProps } from '../blocks/types';

interface OrderLine {
  product_id?: string | null;
  title?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  total?: number | null;
}

export function OrderScreen({
  orderId,
  navigate,
}: {
  orderId: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale, db, invalidate, runSync } = useApp();
  const cart = useCart();
  const { data, loading } = useEntityRecord('orders', orderId);
  const order = data[0];
  const store = useEntityRecord('stores', (order?.store_id as string) ?? null);

  if (loading) return <LoadingBlock />;
  if (!order) return <EmptyState message={t('common.empty')} icon="bag" />;

  const currency = config.app.app.currency;
  const lines: OrderLine[] = Array.isArray(order.items) ? (order.items as OrderLine[]) : [];
  const progress = orderProgress(order.status, order.fulfillment as string);

  const cancel = (): void => {
    Alert.alert(t('order.cancel_confirm'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('order.cancel'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await db.repository('orders').saveLocal({
              ...order,
              status: 'cancelled',
              updated_at: new Date().toISOString(),
            });
            invalidate();
            void runSync({ entities: ['orders'] });
          })();
        },
      },
    ]);
  };

  const repeat = async (): Promise<void> => {
    for (const line of lines) {
      if (!line.product_id) continue;
      await cart.add(
        {
          id: String(line.product_id),
          name: line.title ?? String(line.product_id),
          price: line.price ?? 0,
          unit: line.unit ?? null,
        },
        line.quantity ?? 1,
      );
    }
    navigate('cart');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.bold as never,
              }}
            >
              {t('order.number', { number: orderLabel({ id: orderId, number: order.number as string }) })}
            </Text>
            <Badge
              label={t(orderStatusKey(order.status))}
              tone={order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'warning' : 'badge'}
            />
          </View>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
            {formatDateTime((order.placed_at as string) ?? null, locale)}
          </Text>

          {progress.cancelled ? null : (
            <View style={{ flexDirection: 'row', gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
              {progress.steps.map((step, index) => (
                <View key={step} style={{ flex: 1, gap: 4 }}>
                  <View
                    style={{
                      height: 4,
                      borderRadius: theme.radius.pill,
                      backgroundColor: index <= progress.index ? theme.colors.primary : theme.colors.surfaceAlt,
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: index <= progress.index ? theme.colors.text : theme.colors.textMuted,
                      fontSize: theme.typography.sizes.xs,
                    }}
                  >
                    {t(orderStatusKey(step))}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <Icon name={order.fulfillment === 'delivery' ? 'truck' : 'store'} size={18} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, flex: 1 }}>
              {order.fulfillment === 'delivery'
                ? t('order.delivery_to', { address: String(order.address ?? '') })
                : t('order.pickup_at', {
                    store: store.data[0]
                      ? translate(store.data[0].name, locale, config.app.app.defaultLocale, '')
                      : '—',
                  })}
            </Text>
          </View>
          {order.slot_date ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('order.slot', { date: String(order.slot_date), time: String(order.slot_time ?? '') })}
            </Text>
          ) : null}
          {order.phone ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {String(order.phone)}
            </Text>
          ) : null}
          {order.comment ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {String(order.comment)}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          {lines.map((line, index) => (
            <View key={`${String(line.product_id ?? index)}-${index}`} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                  {line.title ?? String(line.product_id ?? '')}
                </Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {line.quantity ?? 1} {line.unit ?? ''} × {formatPrice(line.price ?? 0, currency)}
                </Text>
              </View>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                {formatPrice(line.total ?? (line.price ?? 0) * (line.quantity ?? 1), currency)}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          {Number(order.discount_total ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                {t('cart.discount')}
              </Text>
              <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.sm }}>
                −{formatPrice(Number(order.discount_total), currency)}
              </Text>
            </View>
          ) : null}
          {Number(order.delivery_fee ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                {t('cart.delivery')}
              </Text>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                {formatPrice(Number(order.delivery_fee), currency)}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg }}>{t('cart.total')}</Text>
            <Text
              style={{
                color: theme.colors.price,
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.bold as never,
              }}
            >
              {formatPrice(Number(order.total ?? 0), currency)}
            </Text>
          </View>
        </View>
      </Card>

      {lines.some((line) => line.product_id) ? (
        <Button label={t('order.repeat')} icon="cart" variant="secondary" onPress={() => void repeat()} />
      ) : null}
      {isCancellable(order.status) ? <Button label={t('order.cancel')} variant="ghost" onPress={cancel} /> : null}
    </ScrollView>
  );
}
