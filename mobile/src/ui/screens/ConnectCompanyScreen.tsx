/**
 * Connecting a company to e-Factura.
 *
 * Three things this screen is careful about:
 *
 *   * the password is sent straight to the API and never written to the local
 *     database, not even through the sync queue;
 *   * consent is a checkbox with the full text next to it, not a line of small
 *     print under a button;
 *   * a company already connected can be revoked from the same screen, because
 *     the place you grant access is where people look to take it away.
 */
import React from 'react';
import { Alert, Linking, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { connectionBadge, validateConnection, type ConnectionRecord } from '../../domain/wallet';
import { Button, Card, LoadingBlock } from '../components/base';
import { Icon } from '../components/Icon';
import type { BlockProps } from '../blocks/types';

interface Props {
  connectionId?: string;
  navigate: BlockProps['navigate'];
  goBack: () => void;
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>{label}</Text>
      {children}
      {hint ? (
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ConnectCompanyScreen({ connectionId, goBack }: Props): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, api, invalidate, runSync } = useApp();

  const existing = useEntityRecord<ConnectionRecord>('connections', connectionId ?? null);
  const connection = existing.data[0];

  const [idno, setIdno] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (connection) {
      setIdno(String(connection.idno ?? ''));
      setUsername(String(connection.sfs_username ?? ''));
    }
  }, [connection?.id]);

  const wallet = config.app.wallet;
  if (connectionId && existing.loading) return <LoadingBlock />;

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  } as const;

  const submit = async (): Promise<void> => {
    const draft = {
      idno: idno.replace(/[\s-]/g, ''),
      sfsUsername: username.trim(),
      sfsPassword: password,
      consentAccepted: consent,
    };

    const found = validateConnection(draft);
    setErrors(Object.fromEntries(Object.entries(found).map(([key, value]) => [key, t(value)])));
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      // Sent directly, not through the sync queue: the queue keeps its payload
      // in the local database, and this password must not land there.
      await api.request(wallet!.connectionsEndpoint, {
        method: 'POST',
        // A failed connect should tell the user now, not after three retries
        // with their password in flight each time.
        noRetry: true,
        body: {
          idno: draft.idno,
          actorRole: 2,
          sfsUsername: draft.sfsUsername,
          sfsPassword: draft.sfsPassword,
          consentAccepted: true,
          consentVersion: wallet!.consentVersion,
        },
      });

      setPassword('');
      await runSync({ force: true });
      invalidate();
      goBack();
    } catch (error) {
      const message = (error as Error).message;
      // 422 from the service means the tax service itself said no.
      const rejected = /422|rejected/i.test(message);
      Alert.alert(
        t('screen.connect_company'),
        t(rejected ? 'wallet.error_rejected' : 'wallet.error_unreachable'),
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = (): void => {
    Alert.alert(t('wallet.revoke_confirm'), t('wallet.revoke_note'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('wallet.revoke'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await api.request(`${wallet!.connectionsEndpoint}/${connection!.id}`, {
                method: 'DELETE',
                noRetry: true,
              });
              await runSync({ force: true });
              invalidate();
              goBack();
            } catch (error) {
              Alert.alert(t('common.error'), (error as Error).message);
            }
          })();
        },
      },
    ]);
  };

  const badge = connection ? connectionBadge(connection) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
    >
      {connection && badge ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.md,
                fontWeight: theme.typography.weights.medium as never,
              }}
            >
              {connection.title ?? connection.idno}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t(badge.labelKey)}
            </Text>
            {connection.last_error ? (
              <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
                {String(connection.last_error)}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <Field label={t('corporate.idno')} error={errors['idno']}>
            <TextInput
              value={idno}
              onChangeText={setIdno}
              keyboardType="number-pad"
              maxLength={16}
              editable={!connection}
              placeholder="1000000000015"
              placeholderTextColor={theme.colors.textMuted}
              style={inputStyle}
            />
          </Field>

          <Field
            label={t('wallet.api_user')}
            hint={t('wallet.api_user_hint')}
            error={errors['sfsUsername']}
          >
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
          </Field>

          <Field label={t('wallet.password')} error={errors['sfsPassword']}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              style={inputStyle}
            />
          </Field>
        </View>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <Icon name="lock" size={20} color={theme.colors.primary} />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: theme.typography.sizes.md,
                  fontWeight: theme.typography.weights.medium as never,
                }}
              >
                {t('wallet.consent_title')}
              </Text>
              <Text
                style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}
              >
                {t('wallet.consent_text')}
              </Text>
            </View>
          </View>

          <View
            style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}
          >
            <Switch
              value={consent}
              onValueChange={setConsent}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
            />
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, flex: 1 }}>
              {t('wallet.consent_accept')}
            </Text>
          </View>

          {errors['consentAccepted'] ? (
            <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
              {errors['consentAccepted']}
            </Text>
          ) : null}

          {wallet?.consentUrl ? (
            <Button
              label={t('wallet.consent_read')}
              variant="ghost"
              onPress={() => void Linking.openURL(wallet.consentUrl)}
            />
          ) : null}
        </View>
      </Card>

      <Button
        label={connection ? t('common.save') : t('wallet.connect')}
        icon="check"
        disabled={busy}
        onPress={() => void submit()}
      />

      {connection ? (
        <Button label={t('wallet.revoke')} icon="close" variant="secondary" onPress={revoke} />
      ) : null}
    </ScrollView>
  );
}
