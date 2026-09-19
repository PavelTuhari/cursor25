/** `expo-secure-store` implementation, with a graceful fallback. */
import * as SecureStore from 'expo-secure-store';

import type { SecureStorage } from './secureStorage';

export class ExpoSecureStorage implements SecureStorage {
  constructor(private readonly fallback: SecureStorage) {}

  /** Web and some emulators have no keystore; the fallback keeps the app usable. */
  private async available(): Promise<boolean> {
    try {
      return await SecureStore.isAvailableAsync();
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!(await this.available())) return this.fallback.get(key);
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!(await this.available())) return this.fallback.set(key, value);
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await this.fallback.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    // Always clear both: a token may have been written before the keystore appeared.
    await this.fallback.remove(key);
    if (!(await this.available())) return;
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // nothing else to clean up
    }
  }
}
