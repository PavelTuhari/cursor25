/**
 * Sign-in. Which flow is shown comes from `api.auth.flow`: a code sent by SMS
 * (the default for Moldovan networks) or login and password.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AuthError } from '../../auth/types';
import { formatPhone, isValidPhone } from '../../domain/phone';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { Button, Card } from '../components/base';
import { Icon } from '../components/Icon';

type Step = 'phone' | 'code';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, auth, runSync } = useApp();
  const authConfig = config.app.api.auth;
  const flow = authConfig.flow ?? 'password';

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const otpLength = authConfig.otpLength ?? 4;

  useEffect(() => {
    if (resendIn <= 0) return;
    timer.current = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [resendIn > 0]);

  const describe = useCallback(
    (failure: unknown): string => {
      if (failure instanceof AuthError) {
        switch (failure.code) {
          case 'invalid_phone':
            return t('auth.phone_invalid');
          case 'invalid_code':
          case 'invalid_credentials':
            return t('auth.code_invalid');
          case 'too_many_requests':
            return t('auth.resend_in', { seconds: authConfig.otpResendSeconds ?? 60 });
          case 'network':
            return t('sync.offline');
          default:
            return t('common.error');
        }
      }
      return t('common.error');
    },
    [t, authConfig.otpResendSeconds],
  );

  const sendCode = useCallback(async () => {
    setError(null);
    if (!isValidPhone(phone)) {
      setError(t('auth.phone_invalid'));
      return;
    }
    setBusy(true);
    try {
      const request = await auth.requestCode(phone);
      setRequestId(request.requestId);
      setDevCode(request.devCode ?? null);
      setResendIn(request.resendAfterSeconds);
      setStep('code');
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }, [auth, phone, t, describe]);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (flow === 'otp') await auth.verifyCode(phone, code, requestId);
      else await auth.loginWithPassword(phone, password);
      // Pull the account's data (card, receipts, favourites) right away.
      void runSync();
      onSignedIn();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }, [auth, flow, phone, code, password, requestId, runSync, onSignedIn, describe]);

  const canSubmit = useMemo(
    () => (flow === 'otp' ? code.replace(/\D/g, '').length === otpLength : password.length >= 4),
    [flow, code, otpLength, password],
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold as never }}>
              {t('auth.prompt_title')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {t('auth.prompt_text')}
            </Text>

            {step === 'phone' || flow === 'password' ? (
              <>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {t('auth.phone')}
                </Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  autoFocus
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  placeholder="+373 60 123 456"
                  placeholderTextColor={theme.colors.textMuted}
                  style={{
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.lg,
                  }}
                />
                {flow === 'otp' ? (
                  <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                    {t('auth.phone_hint')}
                  </Text>
                ) : (
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholder={t('auth.password')}
                    placeholderTextColor={theme.colors.textMuted}
                    style={{
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.md,
                      padding: theme.spacing.md,
                      color: theme.colors.text,
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
                  {t('auth.code_sent', { phone: formatPhone(phone) })}
                </Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  autoFocus
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={otpLength}
                  placeholder={'•'.repeat(otpLength)}
                  placeholderTextColor={theme.colors.textMuted}
                  style={{
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.xxl,
                    letterSpacing: 12,
                    textAlign: 'center',
                  }}
                />
                {devCode ? (
                  <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.xs }}>
                    dev code: {devCode}
                  </Text>
                ) : null}
              </>
            )}

            {error ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                <Icon name="warning" size={16} color={theme.colors.danger} />
                <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm, flex: 1 }}>{error}</Text>
              </View>
            ) : null}

            {flow === 'otp' && step === 'phone' ? (
              <Button label={t('auth.send_code')} onPress={() => void sendCode()} disabled={busy} />
            ) : (
              <Button label={t('auth.confirm')} onPress={() => void submit()} disabled={busy || !canSubmit} />
            )}

            {flow === 'otp' && step === 'code' ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Pressable
                  accessibilityRole="button"
                  disabled={resendIn > 0 || busy}
                  onPress={() => void sendCode()}
                  hitSlop={8}
                >
                  <Text style={{ color: resendIn > 0 ? theme.colors.textMuted : theme.colors.primary, fontSize: theme.typography.sizes.sm }}>
                    {resendIn > 0 ? t('auth.resend_in', { seconds: resendIn }) : t('auth.resend')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}
                  hitSlop={8}
                >
                  <Text style={{ color: theme.colors.primary, fontSize: theme.typography.sizes.sm }}>
                    {t('auth.change_phone')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Card>

        <Pressable
          accessibilityRole={authConfig.termsUrl ? 'link' : undefined}
          onPress={() => (authConfig.termsUrl ? void Linking.openURL(authConfig.termsUrl) : undefined)}
        >
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textAlign: 'center' }}>
            {t('auth.terms')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
