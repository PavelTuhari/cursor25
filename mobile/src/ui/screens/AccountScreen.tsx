/**
 * Personal details. Which fields are editable is configuration
 * (`account.editableFields`); saving writes locally and queues the change, so
 * it also works with no connection.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { isValidEmail, formatPhone } from '../../domain/phone';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { Button, Card, EmptyState } from '../components/base';
import { Icon } from '../components/Icon';

const FIELD_LABELS: Record<string, string> = {
  first_name: 'account.first_name',
  last_name: 'account.last_name',
  email: 'account.email',
  birthday: 'account.birthday',
  city: 'account.city',
};

export function AccountScreen(): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, db, session, invalidate, syncStatus } = useApp();
  const { data, loading } = useEntityQuery({ entity: 'profile', limit: 1 });
  const profile = data[0];

  const editable = useMemo(
    () => config.app.account.editableFields.filter((field) => FIELD_LABELS[field] !== undefined),
    [config.app.account.editableFields],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [marketing, setMarketing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const next: Record<string, string> = {};
    for (const field of editable) next[field] = String(profile[field] ?? '');
    setValues(next);
    setMarketing(profile.marketing_opt_in === true);
  }, [profile, editable]);

  if (loading) return <EmptyState message={t('common.loading')} />;
  if (!profile && !session) return <EmptyState message={t('auth.prompt_title')} icon="lock" />;

  const save = async (): Promise<void> => {
    setError(null);
    if (values.email && values.email.length > 0 && !isValidEmail(values.email)) {
      setError(t('account.email_invalid'));
      return;
    }
    await db.repository('profile').saveLocal({
      ...(profile ?? {}),
      id: String(profile?.id ?? session?.userId ?? 'me'),
      ...values,
      marketing_opt_in: marketing,
      updated_at: new Date().toISOString(),
    });
    invalidate();
    setSaved(true);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
              {t('auth.phone')}
            </Text>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {formatPhone(String(profile?.phone ?? session?.phone ?? ''))}
            </Text>
          </View>
        </Card>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>
              {t('account.personal_data')}
            </Text>
            {editable.map((field) => (
              <View key={field} style={{ gap: theme.spacing.xs }}>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {t(FIELD_LABELS[field] as string)}
                </Text>
                <TextInput
                  value={values[field] ?? ''}
                  onChangeText={(text) => {
                    setValues((current) => ({ ...current, [field]: text }));
                    setSaved(false);
                  }}
                  autoCapitalize={field === 'email' ? 'none' : 'words'}
                  keyboardType={field === 'email' ? 'email-address' : 'default'}
                  placeholder={field === 'birthday' ? '1990-01-31' : ''}
                  placeholderTextColor={theme.colors.textMuted}
                  style={{
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    color: theme.colors.text,
                  }}
                />
              </View>
            ))}

            {config.app.account.showMarketingOptIn ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: marketing }}
                onPress={() => {
                  setMarketing((value) => !value);
                  setSaved(false);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
              >
                <Icon name={marketing ? 'check' : 'plus'} size={18} color={marketing ? theme.colors.success : theme.colors.textMuted} />
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, flex: 1 }}>
                  {t('account.marketing_opt_in')}
                </Text>
              </Pressable>
            ) : null}

            {error ? (
              <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm }}>{error}</Text>
            ) : null}
            {saved ? (
              <Text style={{ color: theme.colors.success, fontSize: theme.typography.sizes.sm }}>
                {syncStatus.pending > 0 ? t('account.saved_offline') : t('account.saved')}
              </Text>
            ) : null}

            <Button label={t('common.save')} icon="check" onPress={() => void save()} />
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
