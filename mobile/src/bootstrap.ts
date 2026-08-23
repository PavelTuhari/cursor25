/**
 * Application start-up: open the database, resolve the effective configuration
 * (bundled → cached remote → freshly downloaded remote), then build the API
 * client and the sync engine on top of it.
 */
import { ApiClient, type FetchLike } from './api/client';
import { AuthService } from './auth/authService';
import { KvStorage, type SecureStorage } from './auth/secureStorage';
import type { Session } from './auth/types';
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

export interface Runtime {
  config: ConfigBundle;
  db: Database;
  api: ApiClient;
  sync: SyncEngine;
  auth: AuthService;
  locale: string;
  themeMode: ThemeMode;
  storeId: string | null;
  /** The session restored from secure storage, if the user was signed in. */
  session: Session | null;
  /** Downloads the remote config and applies it; returns the new bundle when it changed. */
  refreshRemoteConfig: () => Promise<ConfigBundle | null>;
  warnings: string[];
}

export interface BootstrapOptions {
  driver: SqlDriver;
  deviceLocales: string[];
  fetchImpl?: FetchLike;
  /** Where the session token is kept; defaults to the database-backed store. */
  storage?: SecureStorage;
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

  const api = new ApiClient({ config: config.app.api, fetchImpl: options.fetchImpl });
  const auth = new AuthService({
    api,
    db,
    storage: options.storage ?? new KvStorage(db.driver),
    config: config.app.api.auth,
  });
  api.setTokenProvider(auth.tokenProvider());
  const session = await auth.restore();

  const sync = new SyncEngine({
    db,
    api,
    config: config.app,
    isAuthenticated: () => auth.isAuthenticated(),
  });

  const [storedLocale, storedTheme, storedStore] = await Promise.all([
    db.getSetting('locale'),
    db.getSetting('themeMode'),
    db.getSetting('storeId'),
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
    auth,
    locale,
    themeMode: (storedTheme as ThemeMode | null) ?? 'system',
    storeId: storedStore && storedStore.length > 0 ? storedStore : null,
    session,
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
        auth.setConfig(bundle.app.api.auth);
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
