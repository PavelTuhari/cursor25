/**
 * Loads a configuration bundle from a directory on disk. Used by the CLI
 * validator, the mock server and the test suite; the app itself imports the
 * same files through the bundler (see `src/config/defaults.ts`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AppConfig,
  ConfigBundle,
  EntitiesConfig,
  NavigationConfig,
  ScreenConfig,
  ThemeConfig,
  Translations,
} from '../src/config/types';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadConfigDir(dir: string): ConfigBundle {
  const screens: Record<string, ScreenConfig> = {};
  for (const file of readdirSync(join(dir, 'screens'))) {
    if (!file.endsWith('.json')) continue;
    const screen = readJson<ScreenConfig>(join(dir, 'screens', file));
    screens[screen.id] = screen;
  }

  const translations: Record<string, Translations> = {};
  for (const file of readdirSync(join(dir, 'l10n'))) {
    if (!file.endsWith('.json')) continue;
    translations[file.replace(/\.json$/, '')] = readJson<Translations>(join(dir, 'l10n', file));
  }

  return {
    app: readJson<AppConfig>(join(dir, 'app.config.json')),
    theme: readJson<ThemeConfig>(join(dir, 'theme.config.json')),
    navigation: readJson<NavigationConfig>(join(dir, 'navigation.config.json')),
    entities: readJson<EntitiesConfig>(join(dir, 'entities.config.json')),
    screens,
    translations,
  };
}
