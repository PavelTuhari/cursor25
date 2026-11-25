/** Cart, orders and coupons as screen blocks. */
import React from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDate, formatDateTime } from '../../domain/dates';
import { couponDiscount, isCouponApplicable, type CouponLike } from '../../domain/coupons';
import { orderLabel, orderStatusKey } from '../../domain/orders';
import { formatPrice } from '../../domain/price';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useCart } from '../../state/CartContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { asAction, runAction } from '../actions';
import { Badge, Button, Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { blockBoolean, blockQuery, blockString, type BlockProps } from './types';

export function CartBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config } = useApp();
  const cart = useCart();
  const currency = config.app.app.currency;
  const fulfillment = config.app.cart.fulfillment[0] ?? 'pickup';
  const totals = cart.totals(fulfillment);
  const checkoutAction = asAction(block.props?.checkoutAction) ?? { type: 'navigate' as const, screen: 'checkout' };

  if (cart.loading) return <LoadingBlock />;
  if (cart.items.length === 0) {
    return (
      <View style={{ paddingTop: theme.spacing.xl }}>
        <EmptyState message={t('cart.empty')} icon="cart" />
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <Button label={t('screen.catalog')} variant="secondary" onPress={() => navigate('catalog')} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      {cart.items.map((line) => (
        <Card key={line.id}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}>
            <Image
              source={{ uri: (line.image_url as string) ?? theme.images.placeholder }}
              style={{ width: 56, height: 56, borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="contain"
            />
            <Pressable
              style={{ flex: 1, gap: 2 }}
              onPress={() => (line.product_id ? navigate('product', { productId: String(line.product_id) }) : undefined)}
            >
              <Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                {line.title ?? ''}
              </Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                {formatPrice(line.price ?? 0, currency)}
                {line.unit ? ` / ${line.unit}` : ''}
              </Text>
            </Pressable>
            <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
              <Text
                style={{
                  color: theme.colors.price,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weights.bold as never,
                }}
              >
                {formatPrice((line.price ?? 0) * (line.quantity ?? 1), currency)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="−"
                  hitSlop={8}
                  onPress={() => void cart.setQuantity(line.id, (line.quantity ?? 1) - 1)}
                >
                  <Icon name="minus" size={18} color={theme.colors.text} />
                </Pressable>
                <Text style={{ color: theme.colors.text, minWidth: 24, textAlign: 'center' }}>
                  {line.quantity ?? 1}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="+"
                  hitSlop={8}
                  onPress={() => void cart.setQuantity(line.id, (line.quantity ?? 1) + 1)}
                >
                  <Icon name="plus" size={18} color={theme.colors.text} />
                </Pressable>
              </View>
            </View>
          </View>
        </Card>
      ))}

      {blockBoolean(block, 'showCoupon', true) && cart.coupon ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Icon name="tag" size={18} color={theme.colors.primary} />
            <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
              {t('cart.coupon')}: {cart.coupon.code ?? ''}
            </Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => cart.setCoupon(null)}>
              <Text style={{ color: theme.colors.primary, fontSize: theme.typography.sizes.sm }}>
                {t('cart.coupon_remove')}
              </Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          <SummaryRow label={t('cart.subtotal')} value={totals.subtotalText} />
          {totals.discount > 0 ? (
            <SummaryRow label={t('cart.discount')} value={`−${formatPrice(totals.discount, currency)}`} tone="success" />
          ) : null}
          {fulfillment === 'delivery' ? (
            <SummaryRow
              label={t('cart.delivery')}
              value={totals.deliveryFee > 0 ? formatPrice(totals.deliveryFee, currency) : t('cart.delivery_free')}
            />
          ) : null}
          <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.xs }} />
          <SummaryRow label={t('cart.total')} value={totals.totalText} strong />

          {totals.missingToMinimum > 0 ? (
            <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.sm }}>
              {t('cart.min_order_missing', { amount: formatPrice(totals.missingToMinimum, currency) })}
            </Text>
          ) : null}
          {totals.missingToFreeDelivery !== null && totals.missingToFreeDelivery > 0 ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('cart.free_delivery_missing', { amount: formatPrice(totals.missingToFreeDelivery, currency) })}
            </Text>
          ) : null}
        </View>
      </Card>

      <Button
        label={t('cart.checkout')}
        icon="cart"
        disabled={!totals.canCheckout}
        onPress={() => runAction(checkoutAction, { navigate })}
      />
      <Button
        label={t('cart.clear')}
        variant="ghost"
        onPress={() =>
          Alert.alert(t('cart.clear_confirm'), '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.delete'), style: 'destructive', onPress: () => void cart.clear() },
          ])
        }
      />
    </View>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'success';
}): React.ReactElement {
  const theme = useTheme();
  const color = tone === 'success' ? theme.colors.success : strong ? theme.colors.price : theme.colors.textMuted;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: strong ? theme.colors.text : theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
        {label}
      </Text>
      <Text
        style={{
          color,
          fontSize: strong ? theme.typography.sizes.lg : theme.typography.sizes.sm,
          fontWeight: (strong ? theme.typography.weights.bold : theme.typography.weights.regular) as never,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function OrderListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale, isAuthenticated } = useApp();
  const { data, loading } = useEntityQuery(isAuthenticated ? blockQuery(block) : null);
  const currency = config.app.app.currency;

  if (!isAuthenticated) return <View />;
  if (loading) return <LoadingBlock />;
  if (data.length === 0) return <EmptyState message={t('order.empty')} icon="bag" />;

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
      {data.map((order) => (
        <Card key={String(order.id)} onPress={() => navigate('order', { orderId: String(order.id) })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Icon name={order.fulfillment === 'delivery' ? 'truck' : 'bag'} size={22} color={theme.colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                {t('order.number', { number: orderLabel({ id: String(order.id), number: order.number as string }) })}
              </Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                {formatDateTime((order.placed_at as string) ?? null, locale)} ·{' '}
                {t('order.items', { count: Number(order.item_count ?? 0) })}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text
                style={{
                  color: theme.colors.price,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weights.bold as never,
                }}
              >
                {formatPrice(Number(order.total ?? 0), currency)}
              </Text>
              <Badge
                label={t(orderStatusKey(order.status))}
                tone={order.status === 'completed' ? 'success' : order.status === 'cancelled' ? 'warning' : 'badge'}
              />
            </View>
          </View>
          {order._dirty ? (
            <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.xs, marginTop: theme.spacing.xs }}>
              {t('order.not_sent')}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

export function CouponStripBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { config, locale, db, invalidate, isAuthenticated } = useApp();
  const cart = useCart();
  const { data, loading } = useEntityQuery(isAuthenticated ? blockQuery(block) : null);
  const layout = blockString(block, 'layout') ?? 'carousel';
  const moreAction = asAction(block.props?.moreAction);
  const currency = config.app.app.currency;

  if (!isAuthenticated) return null;
  if (loading) return layout === 'list' ? <LoadingBlock /> : null;
  if (data.length === 0) return layout === 'list' ? <EmptyState message={t('coupons.empty')} icon="tag" /> : null;

  const activate = async (coupon: Record<string, unknown>): Promise<void> => {
    await db.repository('coupons').saveLocal({
      ...coupon,
      is_activated: true,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    invalidate();
  };

  const cards = data.map((coupon) => {
    const asCoupon = coupon as unknown as CouponLike;
    const lines = cart.items.map((line) => ({
      product_id: line.product_id ?? null,
      price: line.price ?? 0,
      quantity: line.quantity ?? 1,
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const applicable = isCouponApplicable(asCoupon, lines, subtotal);
    const discount = couponDiscount(asCoupon, lines, subtotal);

    return (
      <View key={String(coupon.id)} style={{ width: layout === 'list' ? '100%' : 260 }}>
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Badge
                label={
                  coupon.discount_type === 'percent'
                    ? t('coupons.percent_off', { value: Number(coupon.discount_value ?? 0) })
                    : t('coupons.amount_off', { amount: formatPrice(Number(coupon.discount_value ?? 0), currency) })
                }
              />
              {coupon.is_activated ? <Badge label={t('coupons.activated')} tone="success" /> : null}
            </View>
            <Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {translate(coupon.title, locale, config.app.app.defaultLocale, String(coupon.code ?? ''))}
            </Text>
            <Text numberOfLines={2} style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {translate(coupon.description, locale, config.app.app.defaultLocale, '')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('coupons.expires', { date: formatDate((coupon.ends_at as string) ?? null, locale) })}
              {Number(coupon.min_order_total ?? 0) > 0
                ? ` · ${t('coupons.min_order', { amount: formatPrice(Number(coupon.min_order_total), currency) })}`
                : ''}
            </Text>

            {coupon.is_activated ? (
              <Button
                label={applicable ? t('coupons.apply') : t('coupons.not_applicable')}
                variant="secondary"
                disabled={!applicable}
                onPress={() => {
                  cart.setCoupon(asCoupon);
                  navigate('cart');
                }}
              />
            ) : (
              <Button label={t('coupons.activate')} onPress={() => void activate(coupon)} />
            )}
            {applicable && discount > 0 ? (
              <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.xs }}>
                −{formatPrice(discount, currency)}
              </Text>
            ) : null}
          </View>
        </Card>
      </View>
    );
  });

  const title = block.titleKey ? t(block.titleKey) : undefined;

  if (layout === 'list') {
    return (
      <Section title={title}>
        <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>{cards}</View>
      </Section>
    );
  }

  return (
    <Section
      title={title}
      actionLabel={moreAction ? t('common.more') : undefined}
      onAction={moreAction ? () => runAction(moreAction, { navigate }) : undefined}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
      >
        {cards}
      </ScrollView>
    </Section>
  );
}
