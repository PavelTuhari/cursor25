/**
 * Root component: boots the runtime, then renders the config-driven navigator.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Localization from 'expo-localization';
import Constants from 'expo-constants';

import { ExpoSecureStorage } from './src/auth/expoSecureStorage';
import { KvStorage } from './src/auth/secureStorage';
import { bootstrap, type Runtime } from './src/bootstrap';
import { ExpoSqlDriver } from './src/db/expoDriver';
import { AppProvider } from './src/state/AppContext';
import { useAutoSync } from './src/state/useAutoSync';
import { ShoppingListProvider } from './src/state/ShoppingListContext';
import { RootNavigator } from './src/ui/navigation/RootNavigator';

/** Lives inside the providers so it can use the app context. */
function AutoSync(): null {
  useAutoSync();
  return null;
}

export default function App(): React.ReactElement {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  // Bumped when a downloaded configuration replaces the one being rendered.
  const [configRevision, setConfigRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const driver = await ExpoSqlDriver.open();
        const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
        const instance = await bootstrap({
          driver,
          // The token goes to the platform keystore, not to the app database.
          storage: new ExpoSecureStorage(new KvStorage(driver)),
          deviceLocales: Localization.getLocales().map((locale) => locale.languageTag),
          // Dev and staging builds point the app at their own backend.
          apiBaseUrl: __DEV__ ? extra?.apiBaseUrl : undefined,
        });
        setRuntime(instance);

        // The app is usable immediately; config refresh and the first sync run behind it.
        void instance.refreshRemoteConfig().then((updated) => {
          if (updated) setConfigRevision((revision) => revision + 1);
        });
        if (instance.config.app.sync.syncOnStart) {
          void instance.sync.sync();
        }
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : String(bootError));
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#C21B17', textAlign: 'center' }}>{error}</Text>
      </View>
    );
  }

  if (!runtime) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProvider
        key={configRevision}
        config={runtime.config}
        db={runtime.db}
        api={runtime.api}
        sync={runtime.sync}
        auth={runtime.auth}
        initialLocale={runtime.locale}
        initialThemeMode={runtime.themeMode}
        initialStoreId={runtime.storeId}
        initialSession={runtime.session}
        systemScheme={scheme}
        onPersist={(key, value) => void runtime.db.setSetting(key, value)}
      >
        <ShoppingListProvider>
          <AutoSync />
          <StatusBar style="auto" />
          <RootNavigator />
        </ShoppingListProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
