/**
 * Sign-in, session storage and sign-out.
 *
 * The flow itself is configuration: `api.auth.flow` chooses between a code sent
 * by SMS (`otp`, the default for the Moldovan networks) and login + password,
 * and every endpoint is named in `app.config.json`.
 *
 * Signing out wipes the data that belongs to the account (card, receipts,
 * favourites, profile) so the next person to open the app on this device does
 * not see it; the shopping list, which is not account data, stays.
 */
import { ApiClient, ApiError, type TokenProvider } from '../api/client';
import type { ApiAuthConfig } from '../config/types';
import type { Database } from '../db/database';
import { resetSyncState } from '../db/syncState';
import { normalizePhone } from '../domain/phone';
import type { SecureStorage } from './secureStorage';
import { AuthError, type CodeRequest, type CodeResponse, type Session, type TokenResponse } from './types';

const SESSION_KEY = 'auth:session';

export interface AuthServiceOptions {
  api: ApiClient;
  db: Database;
  storage: SecureStorage;
  config: ApiAuthConfig;
  now?: () => Date;
}

export class AuthService {
  private session: Session | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();
  private refreshing: Promise<string | null> | null = null;

  constructor(private options: AuthServiceOptions) {}

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  setConfig(config: ApiAuthConfig): void {
    this.options.config = config;
  }

  getSession(): Session | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  subscribe(listener: (session: Session | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.session);
  }

  /** Restores the session saved on the device; call once at start-up. */
  async restore(): Promise<Session | null> {
    const raw = await this.options.storage.get(SESSION_KEY);
    if (!raw) return null;
    try {
      this.session = JSON.parse(raw) as Session;
    } catch {
      await this.options.storage.remove(SESSION_KEY);
      return null;
    }
    this.emit();
    return this.session;
  }

  /** Token provider handed to the API client: adds the header and refreshes on 401. */
  tokenProvider(): TokenProvider {
    return {
      getToken: async () => this.session?.token ?? null,
      refresh: async () => this.refresh(),
    };
  }

  /* ------------------------------------------------------------------ otp */

  async requestCode(phoneInput: string): Promise<CodeRequest> {
    const endpoint = this.options.config.requestCodeEndpoint;
    if (!endpoint) throw new AuthError('not_configured', 'api.auth.requestCodeEndpoint is not configured');

    const phone = normalizePhone(phoneInput);
    if (!phone) throw new AuthError('invalid_phone', 'the phone number is not valid');

    const response = await this.call<CodeResponse>(endpoint, { phone });
    return {
      requestId: response.request_id ?? null,
      resendAfterSeconds: response.resend_after_seconds ?? this.options.config.otpResendSeconds ?? 60,
      expiresInSeconds: response.expires_in_seconds ?? 300,
      ...(response.dev_code ? { devCode: response.dev_code } : {}),
    };
  }

  async verifyCode(phoneInput: string, code: string, requestId: string | null = null): Promise<Session> {
    const endpoint = this.options.config.loginEndpoint;
    if (!endpoint) throw new AuthError('not_configured', 'api.auth.loginEndpoint is not configured');

    const phone = normalizePhone(phoneInput);
    if (!phone) throw new AuthError('invalid_phone', 'the phone number is not valid');

    const expected = this.options.config.otpLength ?? 4;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== expected) throw new AuthError('invalid_code', `the code must have ${expected} digits`);

    const response = await this.call<TokenResponse>(endpoint, {
      phone,
      code: digits,
      ...(requestId ? { request_id: requestId } : {}),
    });
    return this.acceptToken(response, phone);
  }

  /* ------------------------------------------------------------- password */

  async loginWithPassword(login: string, password: string): Promise<Session> {
    const endpoint = this.options.config.loginEndpoint;
    if (!endpoint) throw new AuthError('not_configured', 'api.auth.loginEndpoint is not configured');
    const response = await this.call<TokenResponse>(endpoint, { login: login.trim(), password });
    return this.acceptToken(response, null);
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Concurrent 401s share one refresh instead of racing for a new token. */
  async refresh(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    const endpoint = this.options.config.refreshEndpoint;
    const refreshToken = this.session?.refreshToken;
    if (!endpoint || !refreshToken) {
      await this.signOutLocally();
      return null;
    }

    this.refreshing = (async () => {
      try {
        const response = await this.call<TokenResponse>(endpoint, { refresh_token: refreshToken });
        const session = await this.acceptToken(response, this.session?.phone ?? null);
        return session.token;
      } catch {
        // The refresh token is gone or rejected: the user has to sign in again.
        await this.signOutLocally();
        return null;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  async logout(): Promise<void> {
    const endpoint = this.options.config.logoutEndpoint;
    if (endpoint && this.session) {
      try {
        await this.options.api.request(endpoint, { method: 'POST', noRetry: true, skipTokenRefresh: true });
      } catch {
        // Losing the server round-trip must not keep the user signed in locally.
      }
    }
    await this.signOutLocally();
  }

  private async signOutLocally(): Promise<void> {
    this.session = null;
    await this.options.storage.remove(SESSION_KEY);
    await this.clearAccountData();
    this.emit();
  }

  /** Drops every entity marked `requiresAuth` and forgets its sync cursor. */
  private async clearAccountData(): Promise<void> {
    const { db } = this.options;
    for (const entity of db.entities) {
      if (!entity.requiresAuth) continue;
      await db.repository(entity.name).clear();
      await resetSyncState(db.driver, entity.name);
      await db.driver.execute('DELETE FROM _outbox WHERE entity = ?', [entity.name]);
    }
  }

  private async acceptToken(response: TokenResponse, phone: string | null): Promise<Session> {
    if (!response?.access_token) throw new AuthError('unknown', 'the server did not return an access token');

    const user = response.user;
    const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
    const session: Session = {
      userId: user?.id ?? this.session?.userId ?? 'me',
      token: response.access_token,
      refreshToken: response.refresh_token ?? this.session?.refreshToken ?? null,
      expiresAt: response.expires_in
        ? new Date(this.now().getTime() + response.expires_in * 1000).toISOString()
        : null,
      phone: user?.phone ?? phone ?? this.session?.phone ?? null,
      email: user?.email ?? this.session?.email ?? null,
      displayName: displayName.length > 0 ? displayName : this.session?.displayName ?? null,
    };

    this.session = session;
    await this.options.storage.set(SESSION_KEY, JSON.stringify(session));
    this.emit();
    return session;
  }

  private async call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    try {
      return await this.options.api.request<T>(endpoint, {
        method: 'POST',
        body,
        noRetry: true,
        // A 401 here means the credentials are wrong, not that the token is stale.
        skipTokenRefresh: true,
      });
    } catch (error) {
      throw toAuthError(error);
    }
  }
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof ApiError) {
    if (error.status === 0) return new AuthError('network', error.message);
    if (error.status === 429) return new AuthError('too_many_requests', error.message);
    if (error.status === 401 || error.status === 403) return new AuthError('invalid_credentials', error.message);
    if (error.status === 400 || error.status === 422) return new AuthError('invalid_code', error.message);
  }
  return new AuthError('unknown', error instanceof Error ? error.message : String(error));
}
