/**
 * Conversion between SQLite rows and the typed records the UI works with.
 * `json`/`localized` columns are stored as TEXT and parsed here; `boolean`
 * columns are stored as 0/1.
 */
import type { ColumnConfig, EntityConfig, LocalizedText } from '../config/types';
import type { SqlValue } from './driver';

export type EntityRecord = Record<string, unknown>;

function parseJson(value: SqlValue, fallback: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    // A malformed cache row must not crash a list; the raw text is still useful.
    return fallback;
  }
}

export function decodeValue(column: ColumnConfig, value: SqlValue): unknown {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'boolean':
      return value === 1 || value === '1' || value === 'true';
    case 'json':
      return parseJson(value, null);
    case 'localized':
      return parseJson(value, typeof value === 'string' ? ({ '*': value } as LocalizedText) : null);
    case 'integer':
      return typeof value === 'number' ? value : Number(value);
    case 'real':
      return typeof value === 'number' ? value : Number(value);
    default:
      return value;
  }
}

export function encodeValue(column: ColumnConfig, value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case 'boolean':
      return value === true || value === 1 || value === '1' ? 1 : 0;
    case 'json':
    case 'localized':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'integer':
      return Math.trunc(Number(value));
    case 'real':
      return Number(value);
    case 'datetime':
      return value instanceof Date ? value.toISOString() : String(value);
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

export function decodeRow<T extends EntityRecord = EntityRecord>(
  entity: EntityConfig,
  row: Record<string, SqlValue>,
): T {
  const record: EntityRecord = {};
  for (const column of entity.columns) {
    if (!(column.name in row)) continue;
    record[column.name] = decodeValue(column, row[column.name] as SqlValue);
  }
  if ('_synced_at' in row) record._syncedAt = row._synced_at;
  if ('_dirty' in row) record._dirty = row._dirty === 1;
  return record as T;
}

export function decodeRows<T extends EntityRecord = EntityRecord>(
  entity: EntityConfig,
  rows: Record<string, SqlValue>[],
): T[] {
  return rows.map((row) => decodeRow<T>(entity, row));
}

export interface UpsertOptions {
  /** Marks the row as locally modified and pending push. */
  dirty?: boolean;
  syncedAt?: string | null;
}

export function buildUpsert(
  entity: EntityConfig,
  record: EntityRecord,
  options: UpsertOptions = {},
): { sql: string; params: SqlValue[] } {
  const columns: string[] = [];
  const params: SqlValue[] = [];

  for (const column of entity.columns) {
    if (!(column.name in record)) continue;
    columns.push(column.name);
    params.push(encodeValue(column, record[column.name]));
  }
  if (!columns.includes(entity.primaryKey)) {
    throw new Error(`record for "${entity.name}" is missing its primary key "${entity.primaryKey}"`);
  }

  columns.push('_synced_at', '_dirty');
  params.push(options.syncedAt ?? null, options.dirty ? 1 : 0);

  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== entity.primaryKey)
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  const sql =
    `INSERT INTO ${entity.table} (${columns.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(${entity.primaryKey}) DO UPDATE SET ${updates}`;
  return { sql, params };
}

/** Picks the best translation available for the current locale. */
export function translate(
  value: unknown,
  locale: string,
  fallbackLocale: string,
  fallback = '',
): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  const dictionary = value as Record<string, string>;
  const candidates = [locale, fallbackLocale, '*'];
  for (const candidate of candidates) {
    const text = dictionary[candidate];
    if (typeof text === 'string' && text.length > 0) return text;
  }
  const first = Object.values(dictionary).find((item) => typeof item === 'string' && item.length > 0);
  return first ?? fallback;
}
