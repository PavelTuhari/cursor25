/** One e-receipt: lines, totals, points and the fiscal code for support. */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDateTime } from '../../domain/dates';
import { formatPrice } from '../../domain/price';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { useShoppingList } from '../../state/ShoppingListContext';
import { Barcode } from '../components/Barcode';
import { Button, Card, EmptyState, LoadingBlock } from '../components/base';
import type { ReceiptRecord } from '../components/ReceiptRow';

interface ReceiptLine {
  product_id?: string | null;
  name?: unknown;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  total?: number | null;
  discount?: number | null;
}

export function ReceiptScreen({ receiptId }: { receiptId: string }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const list = useShoppingList();
  const { data, loading } = useEntityRecord<ReceiptRecord>('receipts', receiptId);
  const receipt = data[0];
  const store = useEntityRecord('stores', receipt?.store_id ?? null);

  if (loading) return <LoadingBlock />;
  if (!receipt) return <EmptyState message={t('common.empty')} icon="receipt" />;

  const currency = config.app.app.currency;
  const lines: ReceiptLine[] = Array.isArray(receipt.items) ? (receipt.items as ReceiptLine[]) : [];

  const addAllToList = async (): Promise<void> => {
    for (const line of lines) {
      if (!line.product_id) continue;
      await list.addProduct({ id: String(line.product_id), name: line.name, unit: line.unit ?? null });
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.sizes.lg,
              fontWeight: theme.typography.weights.bold as never,
            }}
          >
            {t('receipt.title', { number: receipt.number ?? receipt.id })}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
            {formatDateTime(receipt.purchased_at ?? null, locale)}
          </Text>
          {store.data[0] ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {translate(store.data[0].name, locale, config.app.app.defaultLocale, '')} ·{' '}
              {translate(store.data[0].address, locale, config.app.app.defaultLocale, '')}
            </Text>
          ) : null}
          {receipt.payment_method ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t('receipt.payment', { method: String(receipt.payment_method) })}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          {lines.map((line, index) => (
            <View
              key={`${String(line.product_id ?? index)}-${index}`}
              style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                  {translate(line.name, locale, config.app.app.defaultLocale, String(line.product_id ?? ''))}
                </Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {(line.quantity ?? 1)} {line.unit ?? ''} × {formatPrice(line.price ?? 0, currency)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                  {formatPrice(line.total ?? (line.price ?? 0) * (line.quantity ?? 1), currency)}
                </Text>
                {(line.discount ?? 0) > 0 ? (
                  <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.xs }}>
                    −{formatPrice(line.discount ?? 0, currency)}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg }}>{t('receipt.total')}</Text>
            <Text
              style={{
                color: theme.colors.price,
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.bold as never,
              }}
            >
              {formatPrice(receipt.total ?? 0, currency)}
            </Text>
          </View>
          {(receipt.discount_total ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                {t('receipt.discount')}
              </Text>
              <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.sm }}>
                {formatPrice(receipt.discount_total ?? 0, currency)}
              </Text>
            </View>
          ) : null}
          {(receipt.points_earned ?? 0) > 0 ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t('receipt.points_earned', { points: receipt.points_earned ?? 0 })}
            </Text>
          ) : null}
          {(Number(receipt.points_spent) || 0) > 0 ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t('receipt.points_spent', { points: Number(receipt.points_spent) })}
            </Text>
          ) : null}
        </View>
      </Card>

      {typeof receipt.fiscal_code === 'string' && receipt.fiscal_code.length > 0 ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('receipt.fiscal_code')}
            </Text>
            <Barcode value={receipt.fiscal_code} format={config.app.account.receiptBarcodeFormat} height={72} />
          </View>
        </Card>
      ) : null}

      {lines.some((line) => line.product_id) ? (
        <Button label={t('receipt.repeat')} icon="plus" variant="secondary" onPress={() => void addAllToList()} />
      ) : null}
    </ScrollView>
  );
}
