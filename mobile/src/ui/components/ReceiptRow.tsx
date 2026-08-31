/** One purchase in the history list. */
import React from 'react';
import { Text, View } from 'react-native';

import { translate, type EntityRecord } from '../../db/records';
import { formatDateTime } from '../../domain/dates';
import { formatPrice } from '../../domain/price';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { Card } from './base';
import { Icon } from './Icon';

export interface ReceiptRecord extends EntityRecord {
  id: string;
  number?: string | null;
  store_id?: string | null;
  purchased_at?: string | null;
  total?: number | null;
  discount_total?: number | null;
  points_earned?: number | null;
  item_count?: number | null;
  items?: unknown;
}

export function ReceiptRow({
  receipt,
  showStore = true,
  showPoints = true,
  onPress,
}: {
  receipt: ReceiptRecord;
  showStore?: boolean;
  showPoints?: boolean;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const store = useEntityRecord('stores', showStore ? receipt.store_id ?? null : null);
  const currency = config.app.app.currency;
  const items = Array.isArray(receipt.items) ? receipt.items.length : receipt.item_count ?? 0;

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Icon name="receipt" size={22} color={theme.colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
            {formatDateTime(receipt.purchased_at ?? null, locale)}
          </Text>
          {showStore && store.data[0] ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {translate(store.data[0].name, locale, config.app.app.defaultLocale, '')}
            </Text>
          ) : null}
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
            {t('receipt.items', { count: items })}
            {showPoints && (receipt.points_earned ?? 0) > 0
              ? ` · ${t('receipt.points_earned', { points: receipt.points_earned ?? 0 })}`
              : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text
            style={{
              color: theme.colors.price,
              fontSize: theme.typography.sizes.md,
              fontWeight: theme.typography.weights.bold as never,
            }}
          >
            {formatPrice(receipt.total ?? 0, currency)}
          </Text>
          {(receipt.discount_total ?? 0) > 0 ? (
            <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.xs }}>
              −{formatPrice(receipt.discount_total ?? 0, currency)}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
