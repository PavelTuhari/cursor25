/**
 * The wallet preview: an internal window that renders the wallet on its own,
 * against a separate database seeded with a chosen scenario.
 *
 * Why this exists. The wallet's interesting states - nothing connected,
 * credentials rejected, a decision still queued - are all several steps and a
 * backend away. Reaching them by hand before every check is slow enough that in
 * practice they stop being checked. Here each is one URL.
 *
 * Three properties make it trustworthy:
 *
 *   * it runs the **real** blocks, the real config and the real database layer -
 *     only the data is fixed, so a bug in the screen still shows up here;
 *   * it opens its **own** database file, so seeding cannot disturb the app's
 *     data or be disturbed by a sync;
 *   * the scenario comes from the URL, so it can be driven without touching the
 *     screen - which is what makes it usable from a test runner.
 *
 * Development only: `App.tsx` mounts it behind `__DEV__` and an explicit flag.
 */
import React from 'react';
import { Platform, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { bootstrap, type Runtime } from '../bootstrap';
import { ExpoSqlDriver } from '../db/expoDriver';
import { KvStorage } from '../auth/secureStorage';
import { AppProvider } from '../state/AppContext';
import { BlocksScreen } from '../ui/screens/BlocksScreen';
import { ConnectCompanyScreen } from '../ui/screens/ConnectCompanyScreen';
import { findScenario, SCENARIOS, type Scenario } from './walletScenarios';
import type { Session } from '../auth/types';

/** A separate file, so the preview never touches the app's own data. */
const PREVIEW_DB = 'wallet-preview.db';

/**
 * Navigation is out of scope in a preview: showing where a tap would go is more
 * useful than actually going there.
 */
const logNavigate = (screen: string, params?: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.log('[preview] navigate', screen, params ?? {});
};

/** The wallet is behind authentication; the preview supplies a session. */
const PREVIEW_SESSION: Session = {
  userId: 'usr-preview',
  token: 'preview',
  refreshToken: null,
  expiresAt: null,
  phone: '+37360000001',
  email: null,
  displayName: 'Preview',
};

/** Reads `?scenario=` on web; on a device the first scenario is used. */
function scenarioFromUrl(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('scenario');
}

function setScenarioInUrl(id: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', id);
  window.history.replaceState({}, '', url.toString());
}

async function seed(runtime: Runtime, scenario: Scenario): Promise<void> {
  const now = new Date().toISOString();

  // Wipe first: a scenario describes the whole state, not a delta on top of
  // whatever the previous one left behind.
  for (const entity of ['connections', 'fiscal_invoices', 'company']) {
    await runtime.db.repository(entity).clear();
  }

  if (scenario.connections.length > 0) {
    await runtime.db.repository('connections').upsertManyFromServer(scenario.connections, now);
  }
  if (scenario.invoices.length > 0) {
    await runtime.db.repository('fiscal_invoices').upsertManyFromServer(scenario.invoices, now);
  }
}

interface State {
  runtime: Runtime | null;
  scenario: Scenario;
  error: string | null;
  seeding: boolean;
}

/** Which screen the window shows. `wallet` is the default. */
export type PreviewScreen = 'wallet' | 'connect';

export function WalletPreview({
  screen = 'wallet',
}: { screen?: PreviewScreen } = {}): React.ReactElement {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [state, setState] = React.useState<State>({
    runtime: null,
    scenario: findScenario(scenarioFromUrl()),
    error: null,
    seeding: true,
  });
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const driver = await ExpoSqlDriver.open(PREVIEW_DB);
        const runtime = await bootstrap({
          driver,
          storage: new KvStorage(driver),
          deviceLocales: ['ru-MD'],
        });
        await seed(runtime, state.scenario);
        setState((previous) => ({ ...previous, runtime, seeding: false }));
      } catch (error) {
        setState((previous) => ({
          ...previous,
          error: (error as Error).message,
          seeding: false,
        }));
      }
    })();
  }, []);

  const choose = (scenario: Scenario): void => {
    if (!state.runtime || scenario.id === state.scenario.id) return;
    setScenarioInUrl(scenario.id);
    setState((previous) => ({ ...previous, scenario, seeding: true }));

    void (async () => {
      await seed(state.runtime!, scenario);
      // A fresh key remounts the tree, so every block re-runs its query rather
      // than showing the previous scenario until something invalidates.
      setState((previous) => ({ ...previous, seeding: false }));
    })();
  };

  if (state.error) {
    return (
      <View style={styles.centre}>
        <Text style={{ color: '#C21B17', textAlign: 'center' }}>{state.error}</Text>
      </View>
    );
  }

  if (!state.runtime) {
    return (
      <View style={styles.centre}>
        <Text testID="preview-status">Preview starting…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <Text style={styles.barTitle}>Wallet preview</Text>
        <Text testID="preview-scenario" style={styles.barScenario}>
          {screen === 'connect' ? 'connect · ' : ''}
          {state.scenario.id} — {state.scenario.title}
        </Text>
        <Text style={styles.barNote}>{state.scenario.note}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SCENARIOS.map((scenario) => {
              const current = scenario.id === state.scenario.id;
              return (
                <Pressable
                  key={scenario.id}
                  accessibilityRole="button"
                  onPress={() => choose(scenario)}
                  style={[styles.tab, current && styles.tabCurrent]}
                >
                  <Text style={[styles.tabText, current && styles.tabTextCurrent]}>
                    {scenario.id}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Text testID="preview-state" style={styles.barState}>
          {state.seeding ? 'seeding' : 'ready'}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <AppProvider
          key={state.scenario.id}
          config={state.runtime.config}
          db={state.runtime.db}
          api={state.runtime.api}
          sync={state.runtime.sync}
          auth={state.runtime.auth}
          push={state.runtime.push}
          initialLocale={state.runtime.locale}
          initialThemeMode={state.runtime.themeMode}
          initialStoreId={state.runtime.storeId}
          initialSession={PREVIEW_SESSION}
          systemScheme={scheme}
        >
          {screen === 'connect' ? (
            <ConnectCompanyScreen
              connectionId={state.scenario.connections[0]?.['id'] as string | undefined}
              navigate={logNavigate}
              goBack={() => console.log('[preview] goBack')}
            />
          ) : (
            <BlocksScreen screenId="wallet" navigate={logNavigate} />
          )}
        </AppProvider>
      </View>
    </View>
  );
}

const styles = {
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  bar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#16181D',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2F38',
  },
  barTitle: { color: '#98A1AE', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  barScenario: { color: '#F2F4F7', fontSize: 14, fontWeight: '600', marginTop: 2 },
  barNote: { color: '#98A1AE', fontSize: 11, marginTop: 2 },
  barState: { color: '#6B7280', fontSize: 10, marginTop: 6 },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2F38',
  },
  tabCurrent: { backgroundColor: '#E10915', borderColor: '#E10915' },
  tabText: { color: '#98A1AE', fontSize: 11 },
  tabTextCurrent: { color: '#FFFFFF' },
} as const;
