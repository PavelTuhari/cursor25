/**
 * Icons are referenced by name from JSON, so they are resolved through a map
 * rather than imported per call site. Glyphs keep the bundle free of an icon
 * font; swapping in `@expo/vector-icons` means changing this file only.
 */
import React from 'react';
import { Text, type TextStyle } from 'react-native';

const GLYPHS: Record<string, string> = {
  home: '⌂',
  grid: '▦',
  tag: '％',
  list: '☰',
  card: '▭',
  user: '☺',
  search: '⌕',
  heart: '♡',
  'heart-filled': '♥',
  pin: '⚲',
  gear: '⚙',
  info: 'ⓘ',
  chevron: '›',
  close: '✕',
  plus: '＋',
  minus: '−',
  check: '✓',
  refresh: '↻',
  clock: '◷',
  phone: '☎',
  cloud: '☁',
  receipt: '▤',
  logout: '⇥',
  lock: '⚿',
  warning: '⚠',
};

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: TextStyle;
}

export function Icon({ name, size = 20, color, style }: IconProps): React.ReactElement {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ fontSize: size, lineHeight: size * 1.2, color }, style]}
    >
      {GLYPHS[name] ?? '•'}
    </Text>
  );
}
