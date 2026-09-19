/** Account blocks: sign-in prompt, sign-out, purchase history. */
import React from 'react';
import { Alert, Text, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { asAction, runAction } from '../actions';
import { Button, Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { ReceiptRow, type ReceiptRecord } from '../components/ReceiptRow';
import { blockBoolean, blockQuery, blockString, type BlockProps } from './types';

export function LoginPromptBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const titleKey = blockString(block, 'titleKey') ?? 'auth.prompt_title';
  const textKey = blockString(block, 'textKey') ?? 'auth.prompt_text';

  return (
    <Section>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
              <Icon name="lock" size={22} color={theme.colors.primary} />
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.md,
                    fontWeight: theme.typography.weights.medium as never,
                  }}
                >
                  {t(titleKey)}
                </Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                  {t(textKey)}
                </Text>
              </View>
            </View>
            <Button label={t('auth.login')} icon="user" onPress={() => navigate('login')} />
          </View>
        </Card>
      </View>
    </Section>
  );
}

export function LogoutButtonBlock(_: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { logout } = useApp();

  const confirm = (): void => {
    Alert.alert(t('auth.logout_confirm'), t('auth.logout_note'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.logout'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <View style={{ padding: theme.spacing.lg }}>
      <Button label={t('profile.logout')} icon="logout" variant="secondary" onPress={confirm} />
    </View>
  );
}

export function PurchaseHistoryBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { data, loading } = useEntityQuery<ReceiptRecord>(blockQuery(block));
  const moreAction = asAction(block.props?.moreAction);

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return null;

  return (
    <Section
      title={block.titleKey ? t(block.titleKey) : undefined}
      actionLabel={moreAction ? t('common.more') : undefined}
      onAction={moreAction ? () => runAction(moreAction, { navigate }) : undefined}
    >
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}>
        {data.map((receipt) => (
          <ReceiptRow
            key={receipt.id}
            receipt={receipt}
            showPoints={false}
            onPress={() => navigate('receipt', { receiptId: receipt.id })}
          />
        ))}
      </View>
    </Section>
  );
}

export function ReceiptListBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { isAuthenticated } = useApp();
  const { data, loading } = useEntityQuery<ReceiptRecord>(isAuthenticated ? blockQuery(block) : null);

  if (!isAuthenticated) return <View />;
  if (loading) return <LoadingBlock />;
  if (data.length === 0) return <EmptyState message={t('account.empty_receipts')} icon="receipt" />;

  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
      {data.map((receipt) => (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          showStore={blockBoolean(block, 'showStore', true)}
          showPoints={blockBoolean(block, 'showPoints', true)}
          onPress={() => navigate('receipt', { receiptId: receipt.id })}
        />
      ))}
    </View>
  );
}
