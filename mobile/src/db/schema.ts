/**
 * The SQLite schema is generated from `config/entities.config.json`, so adding
 * a catalogue field on the backend is a configuration change, not a release:
 * the migrator (see `migrator.ts`) rebuilds the affected table and re-pulls it.
 */
import type { ColumnConfig, ColumnType, EntityConfig } from '../config/types';

export const SQLITE_TYPES: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'INTEGER',
  json: 'TEXT',
  localized: 'TEXT',
  datetime: 'TEXT',
};

/** Tables owned by the app itself; the "_" prefix is reserved for them. */
export const INTERNAL_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS _kv (
     key TEXT PRIMARY KEY,
     value TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS _sync_state (
     entity TEXT PRIMARY KEY,
     cursor TEXT,
     last_sync_at TEXT,
     last_full_sync_at TEXT,
     last_error TEXT,
     record_count INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS _outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity TEXT NOT NULL,
     op TEXT NOT NULL,
     record_id TEXT NOT NULL,
     payload TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     next_attempt_at TEXT NOT NULL,
     last_error TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_ready ON _outbox (next_attempt_at, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_record ON _outbox (entity, record_id, op)`,
  `CREATE TABLE IF NOT EXISTS _search_history (
     query TEXT PRIMARY KEY,
     searched_at TEXT NOT NULL
   )`,
];

function columnDefinition(column: ColumnConfig): string {
  const parts = [`${column.name} ${SQLITE_TYPES[column.type]}`];
  if (column.primaryKey) parts.push('PRIMARY KEY');
  if (column.notNull && !column.primaryKey) parts.push('NOT NULL');
  if (column.default !== undefined && column.default !== null) {
    const value =
      typeof column.default === 'string'
        ? `'${column.default.replace(/'/g, "''")}'`
        : typeof column.default === 'boolean'
          ? column.default ? '1' : '0'
          : String(column.default);
    parts.push(`DEFAULT ${value}`);
  }
  return parts.join(' ');
}

export function createTableSql(entity: EntityConfig): string {
  const columns = entity.columns.map(columnDefinition);
  // Local bookkeeping columns, present on every synced table.
  columns.push('_synced_at TEXT');
  columns.push('_dirty INTEGER NOT NULL DEFAULT 0');
  return `CREATE TABLE IF NOT EXISTS ${entity.table} (\n  ${columns.join(',\n  ')}\n)`;
}

export function createIndexStatements(entity: EntityConfig): string[] {
  const statements: string[] = [];
  for (const column of entity.columns) {
    if (column.index && !column.primaryKey) {
      statements.push(
        `CREATE INDEX IF NOT EXISTS idx_${entity.table}_${column.name} ON ${entity.table} (${column.name})`,
      );
    }
  }
  for (const index of entity.indexes ?? []) {
    const unique = index.unique ? 'UNIQUE ' : '';
    statements.push(
      `CREATE ${unique}INDEX IF NOT EXISTS ${index.name} ON ${entity.table} (${index.columns.join(', ')})`,
    );
  }
  statements.push(`CREATE INDEX IF NOT EXISTS idx_${entity.table}_dirty ON ${entity.table} (_dirty)`);
  return statements;
}

export function dropTableSql(entity: EntityConfig): string {
  return `DROP TABLE IF EXISTS ${entity.table}`;
}

/**
 * Stable fingerprint of one entity's storage shape. Only the parts that affect
 * the physical table are hashed, so re-ordering endpoints or changing the sync
 * interval never triggers a rebuild.
 */
export function entityFingerprint(entity: EntityConfig): string {
  const shape = {
    table: entity.table,
    primaryKey: entity.primaryKey,
    columns: entity.columns.map((column) => ({
      name: column.name,
      type: column.type,
      primaryKey: column.primaryKey === true,
      notNull: column.notNull === true,
      index: column.index === true,
      default: column.default ?? null,
    })),
    indexes: (entity.indexes ?? []).map((index) => ({
      name: index.name,
      columns: index.columns,
      unique: index.unique === true,
    })),
  };
  return fnv1a(JSON.stringify(shape));
}

/** FNV-1a — a dependency-free hash; this is a change detector, not a digest. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
