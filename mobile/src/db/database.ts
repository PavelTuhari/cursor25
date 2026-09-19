/**
 * Application database: opens the driver, applies the config-driven schema and
 * hands out repositories.
 */
import type { EntitiesConfig, EntityConfig } from '../config/types';
import type { SqlDriver } from './driver';
import { migrate, getKv, setKv, type MigrationReport } from './migrator';
import { Repository } from './repository';
import type { EntityRecord } from './records';

export class Database {
  private readonly repositories = new Map<string, Repository>();
  /** Keeps search-history timestamps strictly increasing within a millisecond. */
  private lastSearchStamp = 0;

  private constructor(
    readonly driver: SqlDriver,
    private entitiesConfig: EntitiesConfig,
    readonly migration: MigrationReport,
  ) {}

  static async open(driver: SqlDriver, entities: EntitiesConfig): Promise<Database> {
    const migration = await migrate(driver, entities);
    return new Database(driver, entities, migration);
  }

  /** Re-applies the schema after a new configuration arrived from the server. */
  async applyConfig(entities: EntitiesConfig): Promise<MigrationReport> {
    const report = await migrate(this.driver, entities);
    this.entitiesConfig = entities;
    this.repositories.clear();
    return report;
  }

  get entities(): EntityConfig[] {
    return this.entitiesConfig.entities;
  }

  entity(name: string): EntityConfig {
    const entity = this.entitiesConfig.entities.find((item) => item.name === name);
    if (!entity) throw new Error(`entity "${name}" is not declared in entities.config.json`);
    return entity;
  }

  repository<T extends EntityRecord = EntityRecord>(name: string): Repository<T> {
    const cached = this.repositories.get(name);
    if (cached) return cached as Repository<T>;
    const repository = new Repository<T>(this.driver, this.entity(name));
    this.repositories.set(name, repository as Repository);
    return repository;
  }

  getSetting(key: string): Promise<string | null> {
    return getKv(this.driver, `setting:${key}`);
  }

  setSetting(key: string, value: string): Promise<void> {
    return setKv(this.driver, `setting:${key}`, value);
  }

  async rememberSearch(query: string, historySize: number, now = new Date()): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;

    // Several searches can land in the same millisecond; ordering must stay stable.
    const stamp = Math.max(now.getTime(), this.lastSearchStamp + 1);
    this.lastSearchStamp = stamp;

    await this.driver.execute(
      `INSERT INTO _search_history (query, searched_at) VALUES (?, ?)
       ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at`,
      [trimmed, new Date(stamp).toISOString()],
    );
    await this.driver.execute(
      `DELETE FROM _search_history WHERE query NOT IN (
         SELECT query FROM _search_history ORDER BY searched_at DESC LIMIT ?
       )`,
      [historySize],
    );
  }

  async searchHistory(limit = 10): Promise<string[]> {
    const rows = await this.driver.select<{ query: string }>(
      'SELECT query FROM _search_history ORDER BY searched_at DESC LIMIT ?',
      [limit],
    );
    return rows.map((row) => row.query);
  }

  async clearSearchHistory(): Promise<void> {
    await this.driver.execute('DELETE FROM _search_history');
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}
