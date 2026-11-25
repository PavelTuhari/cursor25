/**
 * Push registration.
 *
 * The native side is behind `PushAdapter` so the registration rules — when to
 * ask, when to re-send a token, what to do on sign-out — are plain logic that
 * the test suite can exercise without a device.
 */
import type { ApiClient } from '../api/client';
import type { PushConfig } from '../config/types';
import type { SqlDriver } from '../db/driver';
import { getKv, setKv } from '../db/migrator';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface PushAdapter {
  platform: string;
  isDevice: boolean;
  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  getToken(): Promise<string | null>;
}

export interface PushServiceOptions {
  api: ApiClient;
  driver: SqlDriver;
  config: PushConfig;
  adapter: PushAdapter;
  locale: () => string;
  userId: () => string | null;
}

export interface RegistrationResult {
  status: PermissionStatus | 'disabled' | 'unsupported';
  token: string | null;
  /** False when the token was already registered and nothing was sent. */
  sent: boolean;
}

const TOKEN_KEY = 'push:token';
const SIGNATURE_KEY = 'push:signature';

export class PushService {
  constructor(private options: PushServiceOptions) {}

  setConfig(config: PushConfig): void {
    this.options.config = config;
  }

  /**
   * Registers the device. `ask` is false for a silent check at start-up: the
   * permission dialog is shown in context (after sign-in, or from settings),
   * never as the first thing a shopper sees.
   */
  async register(ask: boolean): Promise<RegistrationResult> {
    const { config, adapter } = this.options;
    if (!config.enabled) return { status: 'disabled', token: null, sent: false };
    // Simulators have no push token; asking there only produces errors.
    if (!adapter.isDevice) return { status: 'unsupported', token: null, sent: false };

    let status = await adapter.getPermissionStatus();
    if (status === 'undetermined' && ask) status = await adapter.requestPermission();
    if (status !== 'granted') return { status, token: null, sent: false };

    const token = await adapter.getToken();
    if (!token) return { status, token: null, sent: false };

    // The same token for the same user and locale needs no second round-trip.
    const signature = this.signature(token);
    if ((await getKv(this.options.driver, SIGNATURE_KEY)) === signature) {
      return { status, token, sent: false };
    }

    await this.options.api.request(config.registerEndpoint, {
      method: 'POST',
      body: {
        token,
        platform: adapter.platform,
        locale: this.options.locale(),
        user_id: this.options.userId(),
        topics: config.topics,
      },
    });

    await setKv(this.options.driver, TOKEN_KEY, token);
    await setKv(this.options.driver, SIGNATURE_KEY, signature);
    return { status, token, sent: true };
  }

  /** Called on sign-out so the account stops receiving personal pushes here. */
  async unregister(): Promise<void> {
    const token = await getKv(this.options.driver, TOKEN_KEY);
    await setKv(this.options.driver, SIGNATURE_KEY, '');
    if (!token || !this.options.config.enabled) return;
    try {
      await this.options.api.request(`${this.options.config.registerEndpoint}/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        noRetry: true,
      });
    } catch {
      // The server may already have dropped it; the local state is what matters.
    }
  }

  private signature(token: string): string {
    return [token, this.options.userId() ?? 'anonymous', this.options.locale()].join('|');
  }
}
