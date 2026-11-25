/**
 * Company details. Which fields can be changed is configuration
 * (`corporate.editableFields`); the tax code is entered once, when the company
 * is added. Saving writes locally and queues the change, so it works offline.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { normaliseFiscalCode, normaliseIban, validateCompany, type CompanyRecord } from '../../domain/company';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { Button, Card, EmptyState, LoadingBlock } from '../components/base';

const FIELD_LABELS: Record<string, string> = {
  idno: 'corporate.idno',
  name: 'corporate.company',
  vat_code: 'corporate.vat_code',
  legal_address: 'corporate.legal_address',
  delivery_address: 'corporate.delivery_address',
  bank_account: 'corporate.bank_account',
  bank_name: 'corporate.bank_name',
  bank_swift: 'corporate.bank_swift',
  contact_name: 'corporate.contact',
  contact_email: 'account.email',
  contact_phone: 'auth.phone',
};

const NUMERIC = new Set(['idno', 'vat_code']);

export function CompanyEditScreen({ goBack }: { goBack: () => void }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, db, session, isAuthenticated, invalidate } = useApp();
  const { data, loading } = useEntityQuery<CompanyRecord>(isAuthenticated ? { entity: 'company', limit: 1 } : null);
  const company = data[0];

  const fields = useMemo(() => {
    const editable = (config.app.corporate?.editableFields ?? []).filter((field) => FIELD_LABELS[field] !== undefined);
    return company ? editable : ['idno', ...editable];
  }, [config.app.corporate?.editableFields, company]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of fields) next[field] = String(company?.[field] ?? '');
    setValues(next);
  }, [company, fields]);

  if (loading) return <LoadingBlock />;
  if (!isAuthenticated) return <EmptyState message={t('corporate.login_text')} icon="lock" />;

  const save = async (): Promise<void> => {
    const draft: Partial<CompanyRecord> = { ...(company ?? {}) };
    for (const field of fields) draft[field] = (values[field] ?? '').trim() || null;
    if (draft.idno) draft.idno = normaliseFiscalCode(String(draft.idno));
    if (draft.bank_account) draft.bank_account = normaliseIban(String(draft.bank_account));

    const found = validateCompany(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await db.repository('company').saveLocal({
        ...draft,
        id: String(company?.id ?? `cmp-${session?.userId ?? 'me'}`),
        // Both marks belong to the tax register; only the backend may set them.
        efactura_verified: company?.efactura_verified ?? false,
        efactura_actor: company?.efactura_actor ?? false,
        updated_at: new Date().toISOString(),
      });
      invalidate();
      goBack();
    } finally {
      setSaving(false);
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
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            {fields.map((field) => (
              <View key={field} style={{ gap: theme.spacing.xs }}>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {t(FIELD_LABELS[field] as string)}
                </Text>
                <TextInput
                  accessibilityLabel={t(FIELD_LABELS[field] as string)}
                  value={values[field] ?? ''}
                  onChangeText={(text) => setValues((current) => ({ ...current, [field]: text }))}
                  autoCapitalize={field === 'contact_email' ? 'none' : 'sentences'}
                  keyboardType={
                    NUMERIC.has(field)
                      ? 'number-pad'
                      : field === 'contact_email'
                        ? 'email-address'
                        : field === 'contact_phone'
                          ? 'phone-pad'
                          : 'default'
                  }
                  style={{
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    color: theme.colors.text,
                  }}
                />
                {errors[field] ? (
                  <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs }}>
                    {t(errors[field] as string)}
                  </Text>
                ) : null}
              </View>
            ))}
            <Button label={t('common.save')} icon="check" disabled={saving} onPress={() => void save()} />
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
