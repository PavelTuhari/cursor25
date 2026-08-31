/**
 * Translates the JSON `DataQuery` objects used by screen blocks into SQL.
 *
 * Every identifier is checked against the entity's declared columns before it
 * reaches the statement, and every value travels as a bound parameter, so a
 * configuration file — bundled or downloaded — can never inject SQL.
 */
import type { DataQuery, EntityConfig, QueryCondition, QueryValue } from '../config/types';
import type { SqlValue } from './driver';

export interface QueryContext {
  locale: string;
  now?: Date;
  storeId?: string | null;
  userId?: string | null;
  params?: Record<string, unknown>;
}

export class QueryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryConfigError';
  }
}

/** Local bookkeeping columns that configuration may filter on. */
const INTERNAL_COLUMNS = ['_synced_at', '_dirty'];

export interface CompiledQuery {
  sql: string;
  params: SqlValue[];
}

function assertColumn(entity: EntityConfig, name: string): string {
  const known =
    entity.columns.some((column) => column.name === name) || INTERNAL_COLUMNS.includes(name);
  if (!known) {
    throw new QueryConfigError(`unknown column "${name}" for entity "${entity.name}"`);
  }
  return name;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveValue(value: QueryValue | undefined, ctx: QueryContext): QueryValue | undefined {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  const now = ctx.now ?? new Date();
  switch (value) {
    case '$now':
      return now.toISOString();
    case '$today':
      return isoDate(now);
    case '$locale':
      return ctx.locale;
    case '$storeId':
      return ctx.storeId ?? null;
    case '$userId':
      return ctx.userId ?? null;
    default:
      break;
  }
  if (value.startsWith('$param.')) {
    const key = value.slice('$param.'.length);
    const resolved = ctx.params?.[key];
    if (resolved === undefined) return null;
    return resolved as QueryValue;
  }
  throw new QueryConfigError(`unknown placeholder "${value}"`);
}

function toSqlValue(value: QueryValue | undefined): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) throw new QueryConfigError('array values are only valid with the "in" operator');
  return value;
}

function compileCondition(
  entity: EntityConfig,
  condition: QueryCondition,
  ctx: QueryContext,
  params: SqlValue[],
): string {
  const column = assertColumn(entity, condition.field);
  let expression: string;

  switch (condition.op) {
    case 'is null':
      expression = `${column} IS NULL`;
      break;
    case 'is not null':
      expression = `${column} IS NOT NULL`;
      break;
    case 'in': {
      const value = resolveValue(condition.value, ctx);
      if (!Array.isArray(value)) {
        throw new QueryConfigError(`operator "in" on "${column}" requires an array value`);
      }
      if (value.length === 0) return '0 = 1';
      expression = `${column} IN (${value.map(() => '?').join(', ')})`;
      for (const item of value) params.push(toSqlValue(item));
      break;
    }
    case 'like': {
      expression = `LOWER(${column}) LIKE ?`;
      params.push(String(resolveValue(condition.value, ctx) ?? '').toLowerCase());
      break;
    }
    default: {
      expression = `${column} ${condition.op} ?`;
      params.push(toSqlValue(resolveValue(condition.value, ctx)));
      break;
    }
  }

  // Open-ended periods: a NULL `ends_at` means "no end date", not "excluded".
  return condition.orNull ? `(${expression} OR ${column} IS NULL)` : expression;
}

function compileSearch(entity: EntityConfig, search: string, params: SqlValue[]): string | null {
  const columns = entity.searchColumns ?? [];
  if (columns.length === 0) {
    throw new QueryConfigError(`entity "${entity.name}" declares no searchColumns`);
  }
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  // Every term must appear in at least one searchable column (AND of ORs).
  const clauses = terms.map((term) => {
    const perColumn = columns.map((column) => {
      params.push(`%${term}%`);
      return `LOWER(COALESCE(${assertColumn(entity, column)}, '')) LIKE ?`;
    });
    return `(${perColumn.join(' OR ')})`;
  });
  return clauses.join(' AND ');
}

export function buildSelect(entity: EntityConfig, query: DataQuery, ctx: QueryContext): CompiledQuery {
  if (query.entity !== entity.name) {
    throw new QueryConfigError(`query targets "${query.entity}" but entity "${entity.name}" was given`);
  }

  const params: SqlValue[] = [];
  const columns = query.select?.length
    ? query.select.map((column) => assertColumn(entity, column)).join(', ')
    : '*';

  const conditions: string[] = [];
  for (const condition of query.where ?? []) {
    conditions.push(compileCondition(entity, condition, ctx, params));
  }
  if (query.search) {
    const clause = compileSearch(entity, query.search, params);
    if (clause) conditions.push(clause);
  }

  let sql = `SELECT ${columns} FROM ${entity.table}`;
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;

  const order = (query.orderBy ?? []).map(
    (item) => `${assertColumn(entity, item.field)} ${item.dir === 'desc' ? 'DESC' : 'ASC'}`,
  );
  if (order.length > 0) sql += ` ORDER BY ${order.join(', ')}`;

  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit <= 0) {
      throw new QueryConfigError(`invalid limit "${String(query.limit)}"`);
    }
    sql += ` LIMIT ${query.limit}`;
    if (query.offset !== undefined) {
      if (!Number.isInteger(query.offset) || query.offset < 0) {
        throw new QueryConfigError(`invalid offset "${String(query.offset)}"`);
      }
      sql += ` OFFSET ${query.offset}`;
    }
  }

  return { sql, params };
}

export function buildCount(entity: EntityConfig, query: DataQuery, ctx: QueryContext): CompiledQuery {
  const { sql, params } = buildSelect(entity, { ...query, limit: undefined, offset: undefined, orderBy: [] }, ctx);
  return { sql: sql.replace(/^SELECT .*? FROM/, 'SELECT COUNT(*) AS count FROM'), params };
}
