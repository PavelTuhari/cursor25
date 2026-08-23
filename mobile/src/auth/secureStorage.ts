/**
 * Where the session token lives.
 *
 * On device it goes to the platform keystore through `expo-secure-store`; the
 * database-backed implementation is the fallback for platforms without one
 * (web) and the one used by tests and CLI tooling.
 */
import type { SqlDriver } from '../db/driver';
import { getKv, setKv } from '../db/migrator';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class KvStorage implements SecureStorage {
  constructor(private readonly driver: SqlDriver) {}

  get(key: string): Promise<string | null> {
    return getKv(this.driver, key);
  }

  async set(key: string, value: string): Promise<void> {
    await setKv(this.driver, key, value);
  }

  async remove(key: string): Promise<void> {
    await this.driver.execute('DELETE FROM _kv WHERE key = ?', [key]);
  }
}

export class MemoryStorage implements SecureStorage {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}
