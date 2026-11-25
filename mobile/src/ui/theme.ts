/** Runtime theme resolved from `theme.config.json` for the active colour scheme. */
import type { ThemeConfig, ThemeScheme } from '../config/types';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme extends ThemeScheme {
  mode: 'light' | 'dark';
  typography: ThemeConfig['typography'];
  radius: ThemeConfig['radius'];
  spacing: ThemeConfig['spacing'];
  images: ThemeConfig['images'];
}

export function resolveTheme(config: ThemeConfig, mode: ThemeMode, systemScheme: 'light' | 'dark'): Theme {
  const effective = mode === 'system' ? systemScheme : mode;
  const scheme = effective === 'dark' ? config.dark : config.light;
  return {
    mode: effective,
    colors: scheme.colors,
    typography: config.typography,
    radius: config.radius,
    spacing: config.spacing,
    images: config.images,
  };
}
