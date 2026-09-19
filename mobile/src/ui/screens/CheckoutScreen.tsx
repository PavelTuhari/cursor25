/**
 * Checkout. Which fulfilment methods, slots and minimums apply all come from
 * `app.config.json` → `cart`, so a tenant without delivery simply configures
 * `fulfillment: ["pickup"]` and this screen adapts.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { translate } from '../../db/records';
import { formatPrice } from '../../domain/price';
import { availableSlots } from '../../domain/orders';
import { isValidPhone, normalizePhone } from '../../domain/phone';
import type { Fulfillment } from '../../domain/cart';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useCart } from '../../state/CartContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { Button, Card, EmptyState } from '../components/base';
import { Icon } from '../components/Icon';
import type { BlockProps } from '../blocks/types';

export function CheckoutScreen({ navigate }: { navigate: BlockProps['navigate'] }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale, storeId, session } = useApp();
  const cart = useCart();
  const cartConfig = config.app.cart;
  const currency = config.app.app.currency;

  const [fulfillment, setFulfillment] = useState<Fulfillment>(cartConfig.fulfillment[0] ?? 'pickup');
  const [store, setStore] = useState<string | null>(storeId);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(session?.phone ?? '');
  const [comment, setComment] = useState('');
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(null);
  const [payment, setPayment] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stores = useEntityQuery({
    entity: 'stores',
    where: [{ field: 'is_active', op: '=', value: 1 }],
    orderBy: [{ field: 'code', dir: 'asc' }],
    limit: 100,
  });
  const slots = useMemo(() => availableSlots(cartConfig, new Date()), [cartConfig]);
  const totals = cart.totals(fulfillment);

  if (cart.items.length === 0) return <EmptyState message={t('cart.empty')} icon="cart" />;

  const place = async (): Promise<void> => {
    setError(null);
    if (fulfillment === 'pickup' && !store) return setError(t('checkout.need_store'));
    if (fulfillment === 'delivery' && address.trim().length < 5) return setError(t('checkout.need_address'));
    if (fulfillment === 'delivery' && !slot) return setError(t('checkout.need_slot'));
    if (!isValidPhone(phone)) return setError(t('checkout.need_phone'));

    setBusy(true);
    try {
      const order = await cart.checkout({
        fulfillment,
        storeId: fulfillment === 'pickup' ? store : null,
        address: fulfillment === 'delivery' ? address.trim() : null,
        phone: normalizePhone(phone),
        comment: comment.trim() || null,
        slotDate: slot?.date ?? null,
        slotTime: slot?.time ?? null,
        paymentMethod: payment,
      });
      navigate('order', { orderId: order.id });
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        {cartConfig.fulfillment.length > 1 ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                {t('checkout.fulfillment')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                {cartConfig.fulfillment.map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: fulfillment === option }}
                    onPress={() => setFulfillment(option)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: theme.spacing.md,
                      borderRadius: theme.radius.md,
                      backgroundColor: fulfillment === option ? theme.colors.primary : theme.colors.surfaceAlt,
                    }}
                  >
                    <Text
                      style={{
                        color: fulfillment === option ? theme.colors.onPrimary : theme.colors.text,
                        fontSize: theme.typography.sizes.sm,
                      }}
                    >
                      {t(option === 'pickup' ? 'checkout.pickup' : 'checkout.delivery')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </Card>
        ) : null}

        {fulfillment === 'pickup' ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                {t('checkout.store')}
              </Text>
              {stores.data.map((item) => (
                <Pressable
                  key={String(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: store === item.id }}
                  onPress={() => setStore(String(item.id))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}
                >
                  <Icon
                    name={store === item.id ? 'check' : 'pin'}
                    size={18}
                    color={store === item.id ? theme.colors.success : theme.colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                      {translate(item.name, locale, config.app.app.defaultLocale, '')}
                    </Text>
                    <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                      {translate(item.address, locale, config.app.app.defaultLocale, '')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                {t('checkout.address')}
              </Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder={t('checkout.address_placeholder')}
                placeholderTextColor={theme.colors.textMuted}
                style={inputStyle(theme)}
              />
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, marginTop: theme.spacing.sm }}>
                {t('checkout.slot')}
              </Text>
              {slots.map((day) => (
                <View key={day.date} style={{ gap: theme.spacing.xs }}>
                  <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{day.date}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                    {day.times.map((time) => {
                      const selected = slot?.date === day.date && slot?.time === time;
                      return (
                        <Pressable
                          key={time}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setSlot({ date: day.date, time })}
                          style={{
                            paddingHorizontal: theme.spacing.md,
                            paddingVertical: theme.spacing.sm,
                            borderRadius: theme.radius.pill,
                            backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceAlt,
                          }}
                        >
                          <Text
                            style={{
                              color: selected ? theme.colors.onPrimary : theme.colors.text,
                              fontSize: theme.typography.sizes.xs,
                            }}
                          >
                            {time}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </Card>
        )}

        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{t('checkout.phone')}</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+373 60 123 456"
              placeholderTextColor={theme.colors.textMuted}
              style={inputStyle(theme)}
            />
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {t('checkout.comment')}
            </Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={t('checkout.comment_placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              multiline
              style={[inputStyle(theme), { minHeight: 64 }]}
            />
          </View>
        </Card>

        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {t('checkout.payment')}
            </Text>
            {[
              { id: 'cash', label: t('checkout.payment_cash') },
              { id: 'card', label: t('checkout.payment_card') },
            ].map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: payment === option.id }}
                onPress={() => setPayment(option.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}
              >
                <Icon
                  name={payment === option.id ? 'check' : 'chevron'}
                  size={18}
                  color={payment === option.id ? theme.colors.success : theme.colors.textMuted}
                />
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Row label={t('cart.subtotal')} value={totals.subtotalText} />
            {totals.discount > 0 ? (
              <Row label={t('cart.discount')} value={`−${formatPrice(totals.discount, currency)}`} />
            ) : null}
            {fulfillment === 'delivery' ? (
              <Row
                label={t('cart.delivery')}
                value={totals.deliveryFee > 0 ? formatPrice(totals.deliveryFee, currency) : t('cart.delivery_free')}
              />
            ) : null}
            <Row label={t('cart.total')} value={totals.totalText} strong />
          </View>
        </Card>

        {error ? (
          <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm }}>{error}</Text>
        ) : null}

        <Button
          label={t('checkout.place_order')}
          icon="check"
          disabled={busy || !totals.canCheckout}
          onPress={() => void place()}
        />
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textAlign: 'center' }}>
          {t('checkout.placed_offline')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{label}</Text>
      <Text
        style={{
          color: strong ? theme.colors.price : theme.colors.text,
          fontSize: strong ? theme.typography.sizes.lg : theme.typography.sizes.sm,
          fontWeight: (strong ? theme.typography.weights.bold : theme.typography.weights.regular) as never,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>) {
  return {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.colors.text,
  };
}
