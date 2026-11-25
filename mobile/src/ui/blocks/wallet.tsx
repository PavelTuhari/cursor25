/**
 * Wallet blocks: the document list, the connected companies, and the accept or
 * reject action on an incoming invoice.
 *
 * Everything reads from the local database, so a buyer sees their invoices with
 * no network; a decision made offline waits in the outbox and reaches the tax
 * service when there is one.
 */
import React from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { formatPrice } from '../../domain/price';
import { formatDate } from '../../domain/dates';
import { invoiceLabel } from '../../domain/company';
import {
  canDecide,
  connectionBadge,
  incomingBadge,
  isIncoming,
  needsAttention,
  outstanding,
  summarise,
  type ConnectionRecord,
  type WalletInvoice,
} from '../../domain/wallet';
import { asAction, runAction } from '../actions';
import { Button, Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { blockBoolean, blockQuery, blockString, type BlockProps } from './types';

type Tone = 'neutral' | 'positive' | 'warning' | 'danger';

function Chip({ label, tone }: { label: string; tone: Tone }): React.ReactElement {
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

function SummaryTile({ label, value }: { label: string; value: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
        {label}
      </Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.typography.sizes.lg,
          fontWeight: theme.typography.weights.medium as never,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The wallet list. `filter` selects incoming, outgoing or everything, so the
 * same block serves the buyer's list and the seller's without a second one.
 */
export function WalletListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, isAuthenticated, locale } = useApp();
  const { data, loading } = useEntityQuery<WalletInvoice>(
    isAuthenticated ? blockQuery(block) : null,
  );

  if (!isAuthenticated) return <View />;
  if (loading) return <LoadingBlock />;

  const filter = blockString(block, 'filter') ?? 'in';
  const documents = data.filter((invoice) => {
    if (filter === 'in') return isIncoming(invoice);
    if (filter === 'out') return !isIncoming(invoice);
    return true;
  });

  if (documents.length === 0) {
    // A secondary section says nothing when it has nothing: otherwise a new
    // customer meets the same "no documents yet" twice on one screen.
    if (blockBoolean(block, 'hideWhenEmpty', false)) return <View />;
    return <EmptyState message={t('wallet.empty')} icon="receipt" />;
  }

  const currency = config.app.app.currency;
  const summary = summarise(documents);

  return (
    <Section title={block.titleKey ? t(block.titleKey) : undefined}>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        {blockBoolean(block, 'showSummary', true) && filter !== 'out' ? (
          <Card>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <SummaryTile
                label={t('wallet.summary_documents')}
                value={String(summary.documents)}
              />
              <SummaryTile label={t('wallet.summary_awaiting')} value={String(summary.awaiting)} />
              <SummaryTile
                label={t('wallet.summary_unpaid')}
                value={formatPrice(summary.unpaid, currency)}
              />
            </View>
          </Card>
        ) : null}

        {documents.map((invoice) => {
          const badge = isIncoming(invoice) ? incomingBadge(invoice) : null;
          const due = outstanding(invoice);

          return (
            <Card key={invoice.id} onPress={() => navigate('invoice', { invoiceId: invoice.id })}>
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

                {/* On an incoming document the other party is the supplier; on
                    one we issued, it is the buyer. Saying "from" in both cases
                    would name our own company as the sender. */}
                {isIncoming(invoice) ? (
                  invoice.supplier_name ? (
                    <Text
                      style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}
                      numberOfLines={1}
                    >
                      {t('wallet.from_supplier')} {invoice.supplier_name}
                    </Text>
                  ) : null
                ) : invoice.buyer_idno ? (
                  <Text
                    style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}
                    numberOfLines={1}
                  >
                    {t('wallet.to_buyer')} {invoice.buyer_idno}
                  </Text>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text
                    style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}
                  >
                    {invoice.issued_at ? formatDate(invoice.issued_at, locale) : ''}
                  </Text>
                  {badge ? <Chip label={t(badge.labelKey)} tone={badge.tone} /> : null}
                </View>

                {due > 0.009 && (invoice.paid_amount ?? 0) > 0 ? (
                  <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.sm }}>
                    {t('wallet.outstanding')}: {formatPrice(due, currency)}
                  </Text>
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>
    </Section>
  );
}

export function ConnectionListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { isAuthenticated, locale } = useApp();
  const { data, loading } = useEntityQuery<ConnectionRecord>(
    isAuthenticated ? blockQuery(block) : null,
  );
  const addAction = asAction(block.props?.addAction);

  if (!isAuthenticated) return <View />;
  if (loading) return <LoadingBlock />;

  const active = data.filter((connection) => connection.state !== 'revoked');

  return (
    <Section title={block.titleKey ? t(block.titleKey) : undefined}>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        {active.length === 0 ? (
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                {t('wallet.no_connections')}
              </Text>
              <Button
                label={t('wallet.connect')}
                icon="plus"
                onPress={() =>
                  addAction ? runAction(addAction, { navigate }) : navigate('connectCompany')
                }
              />
            </View>
          </Card>
        ) : null}

        {active.map((connection) => {
          const badge = connectionBadge(connection);
          return (
            <Card
              key={connection.id}
              onPress={() => navigate('connectCompany', { connectionId: connection.id })}
            >
              <View style={{ gap: theme.spacing.xs }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.typography.sizes.md,
                      fontWeight: theme.typography.weights.medium as never,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {connection.title ?? connection.idno}
                  </Text>
                  <Chip label={t(badge.labelKey)} tone={badge.tone} />
                </View>

                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                  {connection.idno}
                </Text>

                {connection.last_poll_at ? (
                  <Text
                    style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}
                  >
                    {t('wallet.conn_last_poll')}: {formatDate(connection.last_poll_at, locale)}
                  </Text>
                ) : null}

                {/* A rejected credential needs its owner, so say so rather than
                    leaving the row looking merely stale. */}
                {needsAttention(connection) ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: theme.spacing.sm,
                      alignItems: 'center',
                      marginTop: theme.spacing.xs,
                    }}
                  >
                    <Icon name="warning" size={16} color={theme.colors.danger} />
                    <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm }}>
                      {t('wallet.conn_fix')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>
          );
        })}

        {active.length > 0 ? (
          <Button
            label={t('wallet.connect')}
            icon="plus"
            variant="secondary"
            onPress={() =>
              addAction ? runAction(addAction, { navigate }) : navigate('connectCompany')
            }
          />
        ) : null}
      </View>
    </Section>
  );
}

/** Accept or reject, on the invoice screen. */
export function InvoiceActionsBlock({ block }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { config, db, invalidate } = useApp();
  const invoiceId = blockString(block, 'invoiceId');
  const [reason, setReason] = React.useState('');
  const [rejecting, setRejecting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const { data } = useEntityQuery<WalletInvoice>(
    invoiceId
      ? { entity: 'fiscal_invoices', where: [{ field: 'id', op: '=', value: invoiceId }], limit: 1 }
      : null,
  );
  const invoice = data[0];
  const wallet = config.app.wallet;

  if (!invoice || !wallet?.enabled) return null;
  if (!canDecide(invoice)) return null;

  const decide = async (decision: 'accepting' | 'rejecting'): Promise<void> => {
    if (decision === 'rejecting' && wallet.decisions.requireRejectComment && !reason.trim()) {
      return;
    }

    setBusy(true);
    try {
      // Written locally and pushed by the outbox: the decision survives a dead
      // connection, and the row shows "sending" until it lands.
      await db.repository('fiscal_invoices').saveLocal({
        ...invoice,
        decision,
        decision_note: decision === 'rejecting' ? reason.trim() : null,
        updated_at: new Date().toISOString(),
      });
      invalidate();
      Alert.alert(t('screen.wallet'), t('wallet.decision_queued'));
    } catch (error) {
      Alert.alert(t('common.error'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      {rejecting ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
            {t('wallet.reject_reason')}
          </Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder={t('wallet.reject_reason')}
            placeholderTextColor={theme.colors.textMuted}
            style={{
              minHeight: 80,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              textAlignVertical: 'top',
            }}
          />
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
            {t('wallet.reject_hint')}
          </Text>
          <Button
            label={t('wallet.reject')}
            icon="close"
            disabled={busy || !reason.trim()}
            onPress={() => void decide('rejecting')}
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={() => {
              setRejecting(false);
              setReason('');
            }}
          />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {wallet.decisions.allowAccept ? (
            <Button
              label={t('wallet.accept')}
              icon="check"
              disabled={busy}
              onPress={() => void decide('accepting')}
              style={{ flex: 1 }}
            />
          ) : null}
          {wallet.decisions.allowReject ? (
            <Button
              label={t('wallet.reject')}
              icon="close"
              variant="secondary"
              disabled={busy}
              onPress={() => setRejecting(true)}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
