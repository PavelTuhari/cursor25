/** Small presentational primitives shared by every block and screen. */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useT, useTheme } from '../../state/AppContext';
import { Icon } from './Icon';

export interface SectionProps {
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Section({ title, actionLabel, onAction, children, style }: SectionProps): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={[{ marginTop: theme.spacing.lg }, style]}>
      {(title || actionLabel) && (
        <View style={[styles.sectionHeader, { paddingHorizontal: theme.spacing.lg }]}>
          {title ? (
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.bold as never,
              }}
            >
              {title}
            </Text>
          ) : (
            <View />
          )}
          {actionLabel && onAction ? (
            <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: theme.colors.primary, fontSize: theme.typography.sizes.sm }}>
                {actionLabel} ›
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const content = (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {content}
    </Pressable>
  );
}

export function Badge({ label, tone = 'badge' }: { label: string; tone?: 'badge' | 'success' | 'warning' }): React.ReactElement {
  const theme = useTheme();
  const background =
    tone === 'success' ? theme.colors.success : tone === 'warning' ? theme.colors.warning : theme.colors.badge;
  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: theme.colors.onBadge,
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weights.bold as never,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const theme = useTheme();
  const background =
    variant === 'primary' ? theme.colors.primary : variant === 'secondary' ? theme.colors.surfaceAlt : 'transparent';
  const color = variant === 'primary' ? theme.colors.onPrimary : theme.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Text style={{ color, fontWeight: theme.typography.weights.medium as never, fontSize: theme.typography.sizes.md }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ message, icon = 'info' }: { message: string; icon?: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: theme.spacing.xl, gap: theme.spacing.sm }}>
      <Icon name={icon} size={28} color={theme.colors.textMuted} />
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.md, textAlign: 'center' }}>
        {message}
      </Text>
    </View>
  );
}

export function LoadingBlock(): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ padding: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm }}>
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{t('common.loading')}</Text>
    </View>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm, alignItems: 'center' }}>
      <Icon name="warning" size={24} color={theme.colors.danger} />
      <Text style={{ color: theme.colors.danger, textAlign: 'center', fontSize: theme.typography.sizes.sm }}>
        {message}
      </Text>
      {onRetry ? <Button label={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
});
