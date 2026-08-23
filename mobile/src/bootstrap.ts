/**
 * Application start-up: open the database, resolve the effective configuration
 * (bundled → cached remote → freshly downloaded remote), then build the API
 * client and the sync engine on top of it.
 */
import { ApiClient, type FetchLike, type TokenProvider } from './api/client';
import { bundledConfig } from './config/defaults';
import { mergeConfigBundle } from './config/merge';
import type { ConfigBundle, RemoteConfigPayload } from './config/types';
import { validateConfigBundle } from './config/validate';
import { Database } from './db/database';
import type { SqlDriver } from './db/driver';
import { getKv, setKv } from './db/migrator';
import { resolveLocale } from './i18n';
import { SyncEngine } from './sync/syncEngine';
import { BLOCK_TYPE_NAMES } from './ui/blocks/blockTypes';
import type { ThemeMode } from './ui/theme';

const REMOTE_CONFIG_KEY = 'config:remote';
const REMOTE_CONFIG_FETCHED_AT = 'config:remote:fetchedAt';
const AUTH_TOKEN_KEY = 'auth:token';
const AUTH_USER_KEY = 'auth:user';

export interface Runtime {
  config: ConfigBundle;
  db: Database;
  api: ApiClient;
  sync: SyncEngine;
  locale: string;
  themeMode: ThemeMode;
  storeId: string | null;
  session: { userId: string | null; token: string | null; displayName: string | null };
  /** Downloads the remote config and applies it; returns the new bundle when it changed. */
  refreshRemoteConfig: () => Promise<ConfigBundle | null>;
  warnings: string[];
}

export interface BootstrapOptions {
  driver: SqlDriver;
  deviceLocales: string[];
  fetchImpl?: FetchLike;
  /**
   * Overrides `api.baseUrl` from any configuration source. Dev and staging
   * builds set it (from `expo.extra.apiBaseUrl`) to talk to a local or test
   * backend; it always wins over the bundled and the remote value.
   */
  apiBaseUrl?: string;
}

/** Applies the build-level API base URL override, if there is one. */
function withApiBaseUrl(bundle: ConfigBundle, baseUrl: string | undefined): ConfigBundle {
  if (!baseUrl || bundle.app.api.baseUrl === baseUrl) return bundle;
  return {
    ...bundle,
    app: { ...bundle.app, api: { ...bundle.app.api, baseUrl } },
  };
}

async function readCachedRemoteConfig(db: Database): Promise<RemoteConfigPayload | null> {
  const raw = await getKv(db.driver, REMOTE_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RemoteConfigPayload;
  } catch {
    return null;
  }
}

/** Validates a candidate bundle and returns it only if it is safe to use. */
export function acceptBundle(candidate: ConfigBundle): { bundle: ConfigBundle | null; errors: string[] } {
  const result = validateConfigBundle(candidate, [...BLOCK_TYPE_NAMES]);
  return { bundle: result.valid ? candidate : null, errors: result.errors };
}

export async function bootstrap(options: BootstrapOptions): Promise<Runtime> {
  const warnings: string[] = [];

  const bundledCheck = validateConfigBundle(bundledConfig, [...BLOCK_TYPE_NAMES]);
  if (!bundledCheck.valid) {
    // A broken bundled config is a build error: fail loudly instead of half-starting.
    throw new Error(`bundled configuration is invalid:\n${bundledCheck.errors.join('\n')}`);
  }
  warnings.push(...bundledCheck.warnings);

  const db = await Database.open(options.driver, bundledConfig.entities);

  const cached = await readCachedRemoteConfig(db);
  let config = withApiBaseUrl(bundledConfig, options.apiBaseUrl);
  if (cached) {
    const candidate = withApiBaseUrl(mergeConfigBundle(bundledConfig, cached), options.apiBaseUrl);
    const { bundle, errors } = acceptBundle(candidate);
    if (bundle) {
      config = bundle;
      await db.applyConfig(config.entities);
    } else {
      warnings.push(`cached remote config rejected: ${errors[0] ?? 'unknown error'}`);
    }
  }

  const tokenProvider: TokenProvider = {
    async getToken() {
      return getKv(db.driver, AUTH_TOKEN_KEY);
    },
  };

  const api = new ApiClient({ config: config.app.api, tokenProvider, fetchImpl: options.fetchImpl });
  const sync = new SyncEngine({
    db,
    api,
    config: config.app,
    isAuthenticated: () => Boolean(tokenProvider),
  });

  const [storedLocale, storedTheme, storedStore, token, userId] = await Promise.all([
    db.getSetting('locale'),
    db.getSetting('themeMode'),
    db.getSetting('storeId'),
    getKv(db.driver, AUTH_TOKEN_KEY),
    getKv(db.driver, AUTH_USER_KEY),
  ]);

  const locale =
    storedLocale && config.app.app.locales.includes(storedLocale)
      ? storedLocale
      : resolveLocale(options.deviceLocales, config.app.app.locales, config.app.app.defaultLocale);

  const runtime: Runtime = {
    config,
    db,
    api,
    sync,
    locale,
    themeMode: (storedTheme as ThemeMode | null) ?? 'system',
    storeId: storedStore && storedStore.length > 0 ? storedStore : null,
    session: { userId, token, displayName: null },
    warnings,
    refreshRemoteConfig: async () => {
      if (!config.app.remoteConfig.enabled) return null;
      try {
        const payload = await api.request<RemoteConfigPayload>(config.app.remoteConfig.endpoint, {
          query: { tenant: config.app.app.tenantId, config_version: config.app.configVersion },
        });
        const candidate = withApiBaseUrl(mergeConfigBundle(bundledConfig, payload), options.apiBaseUrl);
        const { bundle, errors } = acceptBundle(candidate);
        if (!bundle) {
          warnings.push(`remote config rejected: ${errors[0] ?? 'unknown error'}`);
          return null;
        }
        await setKv(db.driver, REMOTE_CONFIG_KEY, JSON.stringify(payload));
        await setKv(db.driver, REMOTE_CONFIG_FETCHED_AT, new Date().toISOString());
        await db.applyConfig(bundle.entities);
        config = bundle;
        // The API client and the sync engine hold their own view of the config.
        runtime.config = bundle;
        api.setConfig(bundle.app.api);
        sync.setConfig(bundle.app);
        return bundle;
      } catch (error) {
        // `failOpen` keeps the app usable on the last known good configuration.
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`remote config download failed: ${message}`);
        if (!config.app.remoteConfig.failOpen) throw error;
        return null;
      }
    },
  };

  return runtime;
}
