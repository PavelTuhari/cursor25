/** One fiscal invoice: parties, totals, status, and the buyer's decision. */
import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { formatDate } from '../../domain/dates';
import { formatPrice } from '../../domain/price';
import { invoiceLabel } from '../../domain/company';
import {
  incomingBadge,
  isIncoming,
  isPaid,
  outstanding,
  type WalletInvoice,
} from '../../domain/wallet';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { Button, Card, EmptyState, LoadingBlock } from '../components/base';
import { InvoiceActionsBlock } from '../blocks/wallet';
import type { BlockProps } from '../blocks/types';

function Row({ label, value }: { label: string; value?: string | null }): React.ReactElement | null {
  const theme = useTheme();
  if (!value) return null;

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
      <Text
        style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, width: 120 }}
      >
        {label}
      </Text>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export function InvoiceScreen({
  invoiceId,
  navigate,
}: {
  invoiceId: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale } = useApp();
  const { data, loading } = useEntityRecord<WalletInvoice>('fiscal_invoices', invoiceId);
  const invoice = data[0];

  if (loading) return <LoadingBlock />;
  if (!invoice) return <EmptyState message={t('common.empty')} icon="receipt" />;

  const currency = config.app.app.currency;
  const incoming = isIncoming(invoice);
  const badge = incoming ? incomingBadge(invoice) : null;
  const due = outstanding(invoice);
  const paymentsOn = config.app.wallet?.payments.enabled === true;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.sizes.xl,
              fontWeight: theme.typography.weights.bold as never,
            }}
          >
            {invoiceLabel(invoice)}
          </Text>

          {badge ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t(badge.labelKey)}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
            <Row
              label={t('wallet.from_supplier')}
              value={invoice.supplier_name ?? invoice.supplier_idno}
            />
            <Row
              label={t('corporate.idno')}
              value={incoming ? invoice.supplier_idno : invoice.buyer_idno}
            />
            <Row
              label={t('wallet.issued_at')}
              value={invoice.issued_at ? formatDate(invoice.issued_at, locale) : null}
            />
            <Row
              label={t('wallet.summary_total')}
              value={formatPrice(invoice.total ?? 0, currency)}
            />
            <Row
              label={t('wallet.vat_amount')}
              value={
                invoice.total_vat === null || invoice.total_vat === undefined
                  ? null
                  : formatPrice(invoice.total_vat, currency)
              }
            />
            {invoice.source ? (
              <Row
                label={t('wallet.source')}
                value={t(
                  invoice.source === 'sfs' ? 'wallet.source_sfs' : 'wallet.source_platform',
                )}
              />
            ) : null}
          </View>

          {invoice.decision_note ? (
            <View style={{ marginTop: theme.spacing.sm }}>
              <Row label={t('wallet.reject_reason')} value={invoice.decision_note} />
            </View>
          ) : null}
        </View>
      </Card>

      {/* Decisions live in a block so the same control can be dropped onto any
          screen the configuration puts it on. */}
      <InvoiceActionsBlock
        block={{ id: 'invoice-actions', type: 'invoice_actions', props: { invoiceId } }}
        navigate={navigate}
      />

      <View style={{ gap: theme.spacing.sm }}>
        {invoice.pdf_url ? (
          <Button
            label={t('corporate.open_pdf')}
            icon="download"
            variant="secondary"
            onPress={() => void Linking.openURL(String(invoice.pdf_url))}
          />
        ) : null}
        {invoice.qr_text ? (
          <Button
            label={t('corporate.show_qr')}
            icon="qr"
            variant="secondary"
            onPress={() => void Linking.openURL(String(invoice.qr_text))}
          />
        ) : null}
        {paymentsOn && incoming && due > 0.009 ? (
          <Button
            label={`${t('wallet.pay')} · ${formatPrice(due, currency)}`}
            icon="card"
            onPress={() => navigate('invoicePayment', { invoiceId })}
          />
        ) : null}
        {paymentsOn && incoming && isPaid(invoice) ? (
          <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.sm }}>
            {t('wallet.paid')}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
