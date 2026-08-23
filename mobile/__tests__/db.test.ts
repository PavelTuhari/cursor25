import type { EntitiesConfig } from '../src/config/types';
import { getKv } from '../src/db/migrator';
import { NodeSqlDriver } from '../src/db/nodeDriver';
import { Database } from '../src/db/database';
import { buildSelect, QueryConfigError, resolveValue } from '../src/db/queryBuilder';
import { buildUpsert, decodeRow, encodeValue, translate } from '../src/db/records';
import { pendingCount } from '../src/db/outbox';
import { getSyncState } from '../src/db/syncState';
import { loadBundle, openTestDatabase } from './helpers';

const bundle = loadBundle();
const productsEntity = bundle.entities.entities.find((entity) => entity.name === 'products')!;

describe('migrations from entity config', () => {
  it('creates a table per entity plus the internal tables', async () => {
    const { db, driver } = await openTestDatabase();
    const tables = await driver.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = tables.map((row) => row.name);

    for (const entity of bundle.entities.entities) expect(names).toContain(entity.table);
    for (const internal of ['_kv', '_sync_state', '_outbox', '_search_history']) {
      expect(names).toContain(internal);
    }
    expect(db.migration.created).toContain('products');
    await db.close();
  });

  it('leaves tables untouched when the config did not change', async () => {
    const driver = new NodeSqlDriver(':memory:');
    await Database.open(driver, bundle.entities);
    const second = await Database.open(driver, bundle.entities);
    expect(second.migration.rebuilt).toEqual([]);
    expect(second.migration.unchanged).toContain('products');
    await driver.close();
  });

  it('rebuilds a table when a column is added and resets its cursor', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const first = await Database.open(driver, bundle.entities);
    await driver.execute(
      "INSERT INTO products (id, price, updated_at) VALUES ('p-1', 10, '2026-01-01T00:00:00Z')",
    );
    await driver.execute("UPDATE _sync_state SET cursor = '2026-01-01T00:00:00Z' WHERE entity = 'products'");

    const changed: EntitiesConfig = structuredClone(bundle.entities);
    changed.entities
      .find((entity) => entity.name === 'products')!
      .columns.push({ name: 'energy_kcal', type: 'integer' });

    const report = await first.applyConfig(changed);
    expect(report.rebuilt).toContain('products');

    const rows = await driver.select('SELECT * FROM products');
    expect(rows).toEqual([]);
    const state = await getSyncState(driver, 'products');
    expect(state?.cursor).toBeNull();
    await driver.close();
  });

  it('drops tables of entities a new config no longer declares', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const db = await Database.open(driver, bundle.entities);
    const reduced: EntitiesConfig = structuredClone(bundle.entities);
    reduced.entities = reduced.entities.filter((entity) => entity.name !== 'banners');

    const report = await db.applyConfig(reduced);
    expect(report.removed).toContain('banners');
    const tables = await driver.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.map((row) => row.name)).not.toContain('banners');
    expect(await getSyncState(driver, 'banners')).toBeNull();
    await driver.close();
  });

  it('records a fingerprint per table', async () => {
    const { db, driver } = await openTestDatabase();
    expect(await getKv(driver, 'schema:products')).toMatch(/^[0-9a-f]{8}$/);
    await db.close();
  });
});

describe('query builder', () => {
  const ctx = { locale: 'ro', now: new Date('2026-08-23T10:00:00Z'), storeId: 'st-01', userId: null };

  it('compiles conditions, ordering and limits into bound SQL', () => {
    const compiled = buildSelect(
      productsEntity,
      {
        entity: 'products',
        select: ['id', 'price'],
        where: [
          { field: 'category_id', op: '=', value: 'cat-dairy' },
          { field: 'discount_percent', op: '>', value: 0 },
        ],
        orderBy: [{ field: 'price', dir: 'asc' }],
        limit: 10,
        offset: 20,
      },
      ctx,
    );
    expect(compiled.sql).toBe(
      'SELECT id, price FROM products WHERE category_id = ? AND discount_percent > ? ORDER BY price ASC LIMIT 10 OFFSET 20',
    );
    expect(compiled.params).toEqual(['cat-dairy', 0]);
  });

  it('supports IS NULL, IN and the orNull escape hatch for open-ended periods', () => {
    const compiled = buildSelect(
      bundle.entities.entities.find((entity) => entity.name === 'promotions')!,
      {
        entity: 'promotions',
        where: [
          { field: 'ends_at', op: '>=', value: '$today', orNull: true },
          { field: 'id', op: 'in', value: ['a', 'b'] },
        ],
      },
      ctx,
    );
    expect(compiled.sql).toContain('(ends_at >= ? OR ends_at IS NULL)');
    expect(compiled.sql).toContain('id IN (?, ?)');
    expect(compiled.params).toEqual(['2026-08-23', 'a', 'b']);
  });

  it('resolves context placeholders', () => {
    expect(resolveValue('$now', ctx)).toBe('2026-08-23T10:00:00.000Z');
    expect(resolveValue('$today', ctx)).toBe('2026-08-23');
    expect(resolveValue('$storeId', ctx)).toBe('st-01');
    expect(resolveValue('$param.categoryId', { ...ctx, params: { categoryId: 'cat-1' } })).toBe('cat-1');
    expect(resolveValue('$param.missing', ctx)).toBeNull();
    expect(() => resolveValue('$nope', ctx)).toThrow(QueryConfigError);
  });

  it('refuses identifiers that are not declared columns', () => {
    expect(() =>
      buildSelect(productsEntity, { entity: 'products', where: [{ field: 'price; DROP TABLE products', op: '=', value: 1 }] }, ctx),
    ).toThrow(QueryConfigError);
    expect(() =>
      buildSelect(productsEntity, { entity: 'products', orderBy: [{ field: '(SELECT 1)', dir: 'asc' }] }, ctx),
    ).toThrow(QueryConfigError);
  });

  it('binds search terms instead of interpolating them', () => {
    const compiled = buildSelect(productsEntity, { entity: 'products', search: "lapte' OR 1=1 --" }, ctx);
    expect(compiled.sql).not.toContain('OR 1=1');
    expect(compiled.params.every((param) => typeof param === 'string' && param.startsWith('%'))).toBe(true);
  });

  it('requires each search term to match some searchable column', () => {
    const compiled = buildSelect(productsEntity, { entity: 'products', search: 'lapte jlc' }, ctx);
    expect(compiled.sql.match(/AND/g)?.length).toBe(1);
    expect(compiled.params).toHaveLength(productsEntity.searchColumns!.length * 2);
  });
});

describe('record conversion', () => {
  it('round-trips localized, json and boolean columns', () => {
    const record = {
      id: 'p-1',
      name: { ro: 'Lapte', ru: 'Молоко' },
      images: ['a.png', 'b.png'],
      is_active: true,
      price: 17.9,
    };
    const { sql, params } = buildUpsert(productsEntity, record, { syncedAt: '2026-08-23T10:00:00Z' });
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(params).toContain(JSON.stringify(record.name));
    expect(params).toContain(1);

    const decoded = decodeRow(productsEntity, {
      id: 'p-1',
      name: JSON.stringify(record.name),
      images: JSON.stringify(record.images),
      is_active: 1,
      price: 17.9,
    });
    expect(decoded).toMatchObject({ id: 'p-1', name: record.name, images: record.images, is_active: true, price: 17.9 });
  });

  it('survives a malformed json cell instead of throwing', () => {
    const decoded = decodeRow(productsEntity, { id: 'p-1', images: '{not json' });
    expect(decoded.images).toBeNull();
  });

  it('refuses to upsert a record without its primary key', () => {
    expect(() => buildUpsert(productsEntity, { price: 1 })).toThrow(/primary key/);
  });

  it('encodes booleans and dates for storage', () => {
    expect(encodeValue({ name: 'is_active', type: 'boolean' }, false)).toBe(0);
    expect(encodeValue({ name: 'updated_at', type: 'datetime' }, new Date('2026-08-23T10:00:00Z'))).toBe(
      '2026-08-23T10:00:00.000Z',
    );
  });

  it('falls back through locales when translating', () => {
    const value = { ru: 'Молоко' };
    expect(translate(value, 'ro', 'en', 'fallback')).toBe('Молоко');
    expect(translate({ ro: 'Lapte', ru: 'Молоко' }, 'ru', 'ro')).toBe('Молоко');
    expect(translate(null, 'ro', 'en', 'fallback')).toBe('fallback');
  });
});

describe('repository', () => {
  it('queries what the server wrote', async () => {
    const { db } = await openTestDatabase();
    const products = db.repository('products');
    await products.upsertManyFromServer(
      [
        { id: 'p-1', name: { ro: 'Lapte' }, price: 17.9, discount_percent: 20, is_active: true },
        { id: 'p-2', name: { ro: 'Pâine' }, price: 9.5, discount_percent: 0, is_active: true },
      ],
      '2026-08-23T10:00:00Z',
    );

    const discounted = await products.query(
      { entity: 'products', where: [{ field: 'discount_percent', op: '>', value: 0 }] },
      { locale: 'ro' },
    );
    expect(discounted).toHaveLength(1);
    expect(discounted[0]!.id).toBe('p-1');
    expect(await products.count({ entity: 'products' }, { locale: 'ro' })).toBe(2);
    await db.close();
  });

  it('queues an outbox job for a locally created record', async () => {
    const { db, driver } = await openTestDatabase();
    const list = db.repository('shopping_list_items');
    await list.saveLocal({ id: 'sli-1', title: 'Lapte', quantity: 2 });

    expect(await pendingCount(driver)).toBe(1);
    expect(await list.dirtyCount()).toBe(1);

    await list.saveLocal({ id: 'sli-1', title: 'Lapte', quantity: 3 });
    // A newer change replaces the queued one instead of stacking up.
    expect(await pendingCount(driver)).toBe(1);

    await list.deleteLocal('sli-1');
    const jobs = await driver.select<{ op: string }>('SELECT op FROM _outbox');
    expect(jobs).toEqual([{ op: 'delete' }]);
    await db.close();
  });

  it('never lets a server deletion drop a pending local change', async () => {
    const { db } = await openTestDatabase();
    const list = db.repository('shopping_list_items');
    await list.saveLocal({ id: 'sli-1', title: 'Local' });
    await list.upsertFromServer({ id: 'sli-2', title: 'Server' }, '2026-08-23T10:00:00Z');

    const removed = await list.deleteFromServer(['sli-1', 'sli-2']);
    expect(removed).toBe(1);
    const remaining = await list.query({ entity: 'shopping_list_items' }, { locale: 'ro' });
    expect(remaining.map((row) => row.id)).toEqual(['sli-1']);
    await db.close();
  });

  it('keeps a bounded search history', async () => {
    const { db } = await openTestDatabase();
    for (const query of ['lapte', 'pâine', 'cafea', 'apă']) {
      await db.rememberSearch(query, 3);
    }
    const history = await db.searchHistory(10);
    expect(history).toHaveLength(3);
    expect(history[0]).toBe('apă');
    await db.close();
  });
});
