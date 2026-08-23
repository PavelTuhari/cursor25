/**
 * HTTP client for the UNA.md retail API.
 *
 * Behaviour is entirely configuration driven (base URL, timeout, retry policy,
 * auth mode, extra headers) — see `api` in `config/app.config.json`.
 */
import type { ApiConfig } from '../config/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 5xx and 429 are worth another attempt; 4xx means the request itself is wrong. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface TokenProvider {
  getToken(): Promise<string | null>;
  /** Called once on 401; returning a new token replays the request. */
  refresh?(): Promise<string | null>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** Skips the retry loop (used for user-initiated actions that must fail fast). */
  noRetry?: boolean;
  /**
   * Never answer a 401 by refreshing the token. The auth endpoints themselves
   * set this: refreshing from inside a refresh would wait on itself.
   */
  skipTokenRefresh?: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  config: ApiConfig;
  tokenProvider?: TokenProvider;
  fetchImpl?: FetchLike;
  /** Injected in tests so backoff does not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  private get config(): ApiConfig {
    return this.options.config;
  }

  /** Applied when a remote configuration changes the endpoint or retry policy. */
  setConfig(config: ApiConfig): void {
    this.options.config = config;
  }

  /** Set once the auth service exists; both objects need each other at start-up. */
  setTokenProvider(tokenProvider: TokenProvider): void {
    this.options.tokenProvider = tokenProvider;
  }

  buildUrl(path: string, query?: RequestOptions['query']): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      search.append(key, String(value));
    }
    const queryString = search.toString();
    return `${base}${suffix}${queryString ? `?${queryString}` : ''}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempts = options.noRetry ? 1 : Math.max(1, this.config.retry.attempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.performRequest<T>(path, options);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ApiError ? error.retryable : true;
        if (!retryable || attempt === attempts) break;
        await this.sleep(this.backoffDelay(attempt));
      }
    }
    throw lastError;
  }

  backoffDelay(attempt: number): number {
    const { backoffMs, factor, maxBackoffMs } = this.config.retry;
    const delay = backoffMs * Math.pow(factor, attempt - 1);
    return maxBackoffMs ? Math.min(delay, maxBackoffMs) : delay;
  }

  private async performRequest<T>(path: string, options: RequestOptions, isRetryAfterRefresh = false): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(this.config.headers ?? {}),
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    if (this.config.auth.mode === 'bearer' && this.options.tokenProvider) {
      const token = await this.options.tokenProvider.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network error';
      throw new ApiError(`request to ${url} failed: ${message}`, 0);
    } finally {
      clearTimeout(timeout);
    }

    if (
      response.status === 401 &&
      !isRetryAfterRefresh &&
      !options.skipTokenRefresh &&
      this.options.tokenProvider?.refresh
    ) {
      const token = await this.options.tokenProvider.refresh();
      if (token) return this.performRequest<T>(path, options, true);
    }

    if (!response.ok) {
      const body = await this.safeBody(response);
      throw new ApiError(`${options.method ?? 'GET'} ${url} → ${response.status}`, response.status, body);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async safeBody(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
}
