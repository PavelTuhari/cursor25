import { join } from 'node:path';

import type { ApiClientOptions, FetchLike } from '../src/api/client';
import { ApiClient } from '../src/api/client';
import type { AppConfig, ConfigBundle } from '../src/config/types';
import { Database } from '../src/db/database';
import { NodeSqlDriver } from '../src/db/nodeDriver';
import { loadConfigDir } from '../tools/loadConfigDir';

export const CONFIG_DIR = join(__dirname, '..', 'config');

export function loadBundle(): ConfigBundle {
  return loadConfigDir(CONFIG_DIR);
}

export async function openTestDatabase(bundle = loadBundle()): Promise<{ db: Database; driver: NodeSqlDriver }> {
  const driver = new NodeSqlDriver(':memory:');
  const db = await Database.open(driver, bundle.entities);
  return { db, driver };
}

/** Minimal fetch double: routes are matched by `METHOD path` prefix. */
export interface StubRoute {
  status?: number;
  body?: unknown;
  /** Throws a network-level failure instead of answering. */
  networkError?: boolean;
}

export class FetchStub {
  readonly calls: Array<{ url: string; method: string; body: unknown }> = [];
  private readonly queues = new Map<string, StubRoute[]>();

  on(key: string, ...responses: StubRoute[]): this {
    this.queues.set(key, [...(this.queues.get(key) ?? []), ...responses]);
    return this;
  }

  get fetch(): FetchLike {
    return async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = new URL(input);
      this.calls.push({
        url: input,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });

      // Routes are declared without the base URL's path prefix.
      const key = [...this.queues.keys()].find((candidate) => {
        const [candidateMethod, path] = candidate.split(' ');
        return candidateMethod === method && (url.pathname === path || url.pathname.endsWith(path ?? ''));
      });
      const queue = key ? this.queues.get(key) : undefined;
      const route = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (!route) throw new Error(`unexpected request: ${method} ${url.pathname}`);
      if (route.networkError) throw new Error('connection refused');

      const status = route.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => route.body,
      } as Response;
    };
  }
}

export function makeApiClient(
  appConfig: AppConfig,
  fetchImpl: FetchLike,
  overrides: Partial<ApiClientOptions> = {},
): ApiClient {
  return new ApiClient({
    config: appConfig.api,
    fetchImpl,
    sleep: async () => undefined,
    ...overrides,
  });
}
