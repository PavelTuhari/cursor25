/**
 * Application-wide state: the config bundle, the database, the API client and
 * the sync engine, plus the small pieces of UI state that depend on them
 * (locale, theme mode, selected store, session).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { ApiClient } from '../api/client';
import type { ConfigBundle } from '../config/types';
import type { Database } from '../db/database';
import { createTranslator, type Translator } from '../i18n';
import type { SyncEngine } from '../sync/syncEngine';
import type { SyncReport } from '../sync/types';
import { resolveTheme, type Theme, type ThemeMode } from '../ui/theme';

export interface SessionState {
  userId: string | null;
  token: string | null;
  displayName: string | null;
}

export interface SyncStatus {
  running: boolean;
  lastSyncAt: string | null;
  pending: number;
  error: string | null;
}

export interface AppContextValue {
  config: ConfigBundle;
  db: Database;
  api: ApiClient;
  sync: SyncEngine;
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  locale: string;
  setLocale: (locale: string) => void;
  t: Translator['t'];
  session: SessionState;
  setSession: (session: SessionState) => void;
  storeId: string | null;
  setStoreId: (storeId: string | null) => void;
  syncStatus: SyncStatus;
  /** Increments after every write or sync so screens re-run their queries. */
  dataVersion: number;
  invalidate: () => void;
  runSync: (force?: boolean) => Promise<SyncReport | null>;
  isFeatureEnabled: (feature: string | undefined) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProviderProps {
  config: ConfigBundle;
  db: Database;
  api: ApiClient;
  sync: SyncEngine;
  initialLocale: string;
  initialThemeMode: ThemeMode;
  initialStoreId: string | null;
  initialSession: SessionState;
  systemScheme: 'light' | 'dark';
  onPersist?: (key: string, value: string) => void;
  children: React.ReactNode;
}

export function AppProvider(props: AppProviderProps): React.ReactElement {
  const { config, db, api, sync, systemScheme, onPersist } = props;
  const [locale, setLocaleState] = useState(props.initialLocale);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(props.initialThemeMode);
  const [storeId, setStoreIdState] = useState<string | null>(props.initialStoreId);
  const [session, setSession] = useState<SessionState>(props.initialSession);
  const [dataVersion, setDataVersion] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    running: false,
    lastSyncAt: null,
    pending: 0,
    error: null,
  });

  const theme = useMemo(
    () => resolveTheme(config.theme, themeMode, systemScheme),
    [config.theme, themeMode, systemScheme],
  );

  const translator = useMemo(
    () => createTranslator(config.translations, locale, config.app.app.defaultLocale),
    [config.translations, locale, config.app.app.defaultLocale],
  );

  const invalidate = useCallback(() => setDataVersion((version) => version + 1), []);

  const setLocale = useCallback(
    (next: string) => {
      setLocaleState(next);
      onPersist?.('locale', next);
    },
    [onPersist],
  );

  const setThemeMode = useCallback(
    (next: ThemeMode) => {
      setThemeModeState(next);
      onPersist?.('themeMode', next);
    },
    [onPersist],
  );

  const setStoreId = useCallback(
    (next: string | null) => {
      setStoreIdState(next);
      onPersist?.('storeId', next ?? '');
      setDataVersion((version) => version + 1);
    },
    [onPersist],
  );

  const runSync = useCallback(
    async (force = false): Promise<SyncReport | null> => {
      setSyncStatus((status) => ({ ...status, running: true, error: null }));
      try {
        const report = await sync.sync({ force });
        const pending = await sync.pendingChanges();
        setSyncStatus({
          running: false,
          lastSyncAt: report.finishedAt,
          pending,
          error: report.ok ? null : report.errors.join('; '),
        });
        setDataVersion((version) => version + 1);
        return report;
      } catch (error) {
        setSyncStatus((status) => ({
          ...status,
          running: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        return null;
      }
    },
    [sync],
  );

  const isFeatureEnabled = useCallback(
    (feature: string | undefined) => (feature ? config.app.features[feature] === true : true),
    [config.app.features],
  );

  const value: AppContextValue = {
    config,
    db,
    api,
    sync,
    theme,
    themeMode,
    setThemeMode,
    locale,
    setLocale,
    t: translator.t,
    session,
    setSession,
    storeId,
    setStoreId,
    syncStatus,
    dataVersion,
    invalidate,
    runSync,
    isFeatureEnabled,
  };

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export function useTheme(): Theme {
  return useApp().theme;
}

export function useT(): Translator['t'] {
  return useApp().t;
}
