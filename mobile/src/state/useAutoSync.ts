/**
 * Periodic background sync: runs on the configured interval and whenever the
 * app returns to the foreground with stale data.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { shouldAutoSync } from '../domain/dates';
import { useApp } from './AppContext';

export function useAutoSync(): void {
  const { config, syncStatus, runSync } = useApp();
  const lastSyncAt = useRef<string | null>(syncStatus.lastSyncAt);
  lastSyncAt.current = syncStatus.lastSyncAt;

  const intervalMinutes = Math.max(
    config.app.sync.minIntervalMinutes,
    config.app.sync.intervalMinutes,
  );

  useEffect(() => {
    const timer = setInterval(
      () => {
        if (shouldAutoSync(lastSyncAt.current, intervalMinutes)) void runSync();
      },
      config.app.sync.minIntervalMinutes * 60_000,
    );

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && shouldAutoSync(lastSyncAt.current, intervalMinutes)) void runSync();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [config.app.sync.minIntervalMinutes, intervalMinutes, runSync]);
}
