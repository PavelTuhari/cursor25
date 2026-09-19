/**
 * Merging of a remote configuration payload onto the bundled configuration.
 *
 * Objects are merged key by key so a tenant can override a single colour or a
 * single feature flag. Arrays are replaced wholesale: a partially merged list
 * of tabs, blocks or entities would produce a configuration nobody authored.
 */
import type { ConfigBundle, RemoteConfigPayload } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMerge(result[key], value)
      : value;
  }
  return result as T;
}

export function mergeConfigBundle(base: ConfigBundle, remote: RemoteConfigPayload | null): ConfigBundle {
  if (!remote) return base;
  return {
    app: deepMerge(base.app, remote.app),
    theme: deepMerge(base.theme, remote.theme),
    // Structural sections are replaced as a whole when present.
    navigation: remote.navigation ?? base.navigation,
    entities: remote.entities ?? base.entities,
    screens: remote.screens ? { ...base.screens, ...remote.screens } : base.screens,
    translations: remote.translations
      ? mergeTranslations(base.translations, remote.translations)
      : base.translations,
  };
}

function mergeTranslations(
  base: ConfigBundle['translations'],
  remote: ConfigBundle['translations'],
): ConfigBundle['translations'] {
  const result: ConfigBundle['translations'] = { ...base };
  for (const [locale, dictionary] of Object.entries(remote)) {
    result[locale] = { ...(base[locale] ?? {}), ...dictionary };
  }
  return result;
}
