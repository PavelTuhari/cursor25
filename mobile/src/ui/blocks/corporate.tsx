/**
 * Corporate blocks: the company card, the list of fiscal invoices and the
 * button that asks for an invoice against a receipt.
 *
 * Everything here reads from the local database like any other block, so a
 * business customer sees their invoices and their company details with no
 * network at all; a request made offline waits in the outbox.
 */
import React from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import {
  canRequestInvoice,
  invoiceBadge,
  invoiceLabel,
  isVatRegistered,
  type CompanyRecord,
  type FiscalInvoiceRecord,
} from '../../domain/company';
import { formatPrice } from '../../domain/price';
import { formatDate } from '../../domain/dates';
import { asAction, runAction } from '../actions';
import { Button, Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { blockBoolean, blockQuery, type BlockProps } from './types';

/** One label/value line, skipped entirely when there is no value. */
function Field({ label, value }: { label: string; value?: string | null }): React.ReactElement | null {
  const theme = useTheme();
  if (!value) return null;

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.typography.sizes.sm,
          width: 118,
        }}
      >
        {label}
      </Text>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger';
}): React.ReactElement {
  const theme = useTheme();
  const colour = {
    neutral: theme.colors.textMuted,
    positive: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  }[tone];

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: colour,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: colour, fontSize: theme.typography.sizes.xs }}>{label}</Text>
    </View>
  );
}

export function CompanyCardBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { data, loading } = useEntityQuery<CompanyRecord>(blockQuery(block));
  const editAction = asAction(block.props?.editAction);
  const company = data[0];

  if (loading) return <LoadingBlock />;

  if (!company) {
    return (
      <Section title={block.titleKey ? t(block.titleKey) : undefined}>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                {t('corporate.no_company')}
              </Text>
              <Button
                label={t('corporate.add_company')}
                icon="plus"
                onPress={() =>
                  editAction ? runAction(editAction, { navigate }) : navigate('companyEdit')
                }
              />
            </View>
          </Card>
        </View>
      </Section>
    );
  }

  const verified = Boolean(company.efactura_verified);
  const actor = Boolean(company.efactura_actor);

  return (
    <Section title={block.titleKey ? t(block.titleKey) : undefined}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.md,
                fontWeight: theme.typography.weights.medium as never,
              }}
            >
              {company.name}
            </Text>

            <View style={{ gap: theme.spacing.xs }}>
              <Field label={t('corporate.idno')} value={company.idno} />
              <Field
                label={t('corporate.vat_code')}
                value={isVatRegistered(company) ? company.vat_code : t('corporate.no_vat')}
              />
              <Field label={t('corporate.legal_address')} value={company.legal_address} />
              <Field label={t('corporate.delivery_address')} value={company.delivery_address} />
            </View>

            {blockBoolean(block, 'showBank', true) && company.bank_account ? (
              <View style={{ gap: theme.spacing.xs }}>
                <Field label={t('corporate.bank_account')} value={company.bank_account} />
                <Field label={t('corporate.bank_name')} value={company.bank_name} />
                <Field label={t('corporate.bank_swift')} value={company.bank_swift} />
              </View>
            ) : null}

            {blockBoolean(block, 'showContact', true) && company.contact_name ? (
              <View style={{ gap: theme.spacing.xs }}>
                <Field label={t('corporate.contact')} value={company.contact_name} />
                <Field label="Email" value={company.contact_email} />
                <Field label={t('corporate.contact')} value={company.contact_phone} />
              </View>
            ) : null}

            {blockBoolean(block, 'showVerification', true) ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <StatusChip
                  label={t(verified ? 'corporate.verified' : 'corporate.not_verified')}
                  tone={verified ? 'positive' : 'warning'}
                />
                <StatusChip
                  label={t(actor ? 'corporate.efactura_actor' : 'corporate.not_efactura_actor')}
                  tone={actor ? 'positive' : 'neutral'}
                />
              </View>
            ) : null}

            <Button
              label={t('corporate.edit_company')}
              icon="edit"
              variant="secondary"
              onPress={() =>
                editAction ? runAction(editAction, { navigate }) : navigate('companyEdit')
              }
            />
          </View>
        </Card>
      </View>
    </Section>
  );
}

export function FiscalInvoiceListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, isAuthenticated, locale } = useApp();
  const { data, loading } = useEntityQuery<FiscalInvoiceRecord>(
    isAuthenticated ? blockQuery(block) : null,
  );

  if (!isAuthenticated) return <View />;
  if (loading) return <LoadingBlock />;
  if (data.length === 0) {
    return <EmptyState message={t('corporate.empty_invoices')} icon="receipt" />;
  }

  const currency = config.app.app.currency;

  return (
    <Section title={block.titleKey ? t(block.titleKey) : undefined}>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        {data.map((invoice) => {
          const badge = invoiceBadge(invoice);
          return (
            <Card key={invoice.id}>
              <View style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.typography.sizes.md,
                      fontWeight: theme.typography.weights.medium as never,
                    }}
                  >
                    {invoiceLabel(invoice)}
                  </Text>
                  <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
                    {formatPrice(invoice.total ?? 0, currency)}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}
                  >
                    {invoice.issued_at ? formatDate(invoice.issued_at, locale) : ''}
                  </Text>
                  <StatusChip label={t(badge.labelKey)} tone={badge.tone} />
                </View>

                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {blockBoolean(block, 'showPdf', true) && invoice.pdf_url ? (
                    <Button
                      label={t('corporate.open_pdf')}
                      icon="download"
                      variant="secondary"
                      onPress={() => void Linking.openURL(invoice.pdf_url!)}
                    />
                  ) : null}
                  {blockBoolean(block, 'showQr', true) && invoice.qr_text ? (
                    <Button
                      label={t('corporate.show_qr')}
                      icon="qr"
                      variant="secondary"
                      onPress={() => navigate('invoiceQr', { invoiceId: invoice.id })}
                    />
                  ) : null}
                </View>
              </View>
            </Card>
          );
        })}
      </View>
    </Section>
  );
}

/**
 * Sits on a receipt. Enabled only for a corporate customer whose company is on
 * file, once per receipt and inside the window the configuration allows.
 */
export function InvoiceRequestBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { config, db, isAuthenticated, invalidate } = useApp();
  const receiptId = typeof block.props?.receiptId === 'string' ? block.props.receiptId : null;

  const { data: companies } = useEntityQuery<CompanyRecord>(
    isAuthenticated ? { entity: 'company', limit: 1 } : null,
  );
  const { data: invoices } = useEntityQuery<FiscalInvoiceRecord>(
    isAuthenticated && receiptId
      ? { entity: 'fiscal_invoices', where: [{ field: 'receipt_id', op: '=', value: receiptId }] }
      : null,
  );

  const corporate = config.app.corporate;
  const company = companies[0];

  if (!isAuthenticated || !receiptId || !corporate?.enabled) return null;
  if (!company) return null;

  const already = !canRequestInvoice(receiptId, invoices);

  const request = async (): Promise<void> => {
    try {
      // `saveLocal` marks the row dirty and queues an outbox job, so the button
      // works offline and the request reaches the API on the next sync. The id
      // is derived from the receipt, which makes a double tap a no-op.
      await db.repository('fiscal_invoices').saveLocal({
        id: `req-${receiptId}`,
        receipt_id: receiptId,
        company_id: company.id,
        state: 'requested',
        updated_at: new Date().toISOString(),
      });
      invalidate();
      Alert.alert(t('corporate.request_invoice'), t('corporate.request_sent'));
    } catch (error) {
      Alert.alert(t('common.error'), (error as Error).message);
    }
  };

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
      <Button
        label={t('corporate.request_invoice')}
        icon="receipt"
        disabled={already}
        onPress={() => void request()}
      />
      {already ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          <Icon name="info" size={16} color={theme.colors.textMuted} />
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
            {t('corporate.request_exists')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
