/**
 * Translation lookup. Dictionaries come from the config bundle, so a tenant can
 * ship its own wording without touching the code.
 */
import type { Translations } from '../config/types';

export interface Translator {
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(
  translations: Record<string, Translations>,
  locale: string,
  fallbackLocale: string,
): Translator {
  const primary = translations[locale] ?? {};
  const fallback = translations[fallbackLocale] ?? {};
  return {
    locale,
    t(key, params) {
      const template = primary[key] ?? fallback[key];
      // A missing key surfaces as the key itself: visible in QA, harmless in production.
      return interpolate(template ?? key, params);
    },
  };
}

/** Picks the best supported locale for the device's preferred languages. */
export function resolveLocale(preferred: string[], supported: string[], fallback: string): string {
  for (const candidate of preferred) {
    const exact = supported.find((locale) => locale.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
    const language = candidate.split('-')[0]?.toLowerCase();
    const partial = supported.find((locale) => locale.toLowerCase().startsWith(language ?? ''));
    if (partial) return partial;
  }
  return fallback;
}
