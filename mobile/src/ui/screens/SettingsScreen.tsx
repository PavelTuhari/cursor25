/** Language, theme and synchronisation settings. */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApp, useT, useTheme } from '../../state/AppContext';
import type { ThemeMode } from '../theme';
import { Button, Card } from '../components/base';
import { Icon } from '../components/Icon';

const LOCALE_LABELS: Record<string, string> = { ro: 'Română', ru: 'Русский', en: 'English' };

export function SettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, locale, setLocale, themeMode, setThemeMode, syncStatus, runSync } = useApp();

  const modes: ThemeMode[] = ['system', 'light', 'dark'];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      <Card>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, marginBottom: theme.spacing.sm }}>
          {t('settings.language')}
        </Text>
        {config.app.app.locales.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ selected: item === locale }}
            onPress={() => setLocale(item)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm, gap: theme.spacing.sm }}
          >
            <Icon name={item === locale ? 'check' : 'chevron'} size={18} color={item === locale ? theme.colors.success : theme.colors.textMuted} />
            <Text style={{ color: theme.colors.text }}>{LOCALE_LABELS[item] ?? item}</Text>
          </Pressable>
        ))}
      </Card>

      <Card>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, marginBottom: theme.spacing.sm }}>
          {t('settings.theme')}
        </Text>
        {modes.map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === themeMode }}
            onPress={() => setThemeMode(mode)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm, gap: theme.spacing.sm }}
          >
            <Icon name={mode === themeMode ? 'check' : 'chevron'} size={18} color={mode === themeMode ? theme.colors.success : theme.colors.textMuted} />
            <Text style={{ color: theme.colors.text }}>{t(`settings.theme_${mode}`)}</Text>
          </Pressable>
        ))}
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{t('sync.title')}</Text>
          {syncStatus.pending > 0 ? (
            <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.sm }}>
              {t('sync.pending', { count: syncStatus.pending })}
            </Text>
          ) : null}
          <Button label={t('sync.now')} icon="refresh" variant="secondary" disabled={syncStatus.running} onPress={() => void runSync(true)} />
        </View>
      </Card>

      <Card>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
          {config.app.app.name} · {config.app.app.id} · config v{config.app.configVersion}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
          API: {config.app.api.baseUrl}
        </Text>
      </Card>
    </ScrollView>
  );
}
