import { pendingCount, readyJobs } from '../src/db/outbox';
import { getSyncState } from '../src/db/syncState';
import { SyncEngine } from '../src/sync/syncEngine';
import { FetchStub, loadBundle, makeApiClient, openTestDatabase } from './helpers';

const bundle = loadBundle();

async function makeEngine(fetchStub: FetchStub, options: { authenticated?: boolean; now?: Date } = {}) {
  const { db, driver } = await openTestDatabase(bundle);
  // Most tests want a live clock; the ones that exercise backoff drive it themselves.
  const clock: { value: Date | null } = { value: options.now ?? null };
  const engine = new SyncEngine({
    db,
    api: makeApiClient(bundle.app, fetchStub.fetch),
    config: bundle.app,
    now: () => clock.value ?? new Date(),
    isAuthenticated: () => options.authenticated ?? true,
  });
  return { db, driver, engine, clock };
}

describe('pull', () => {
  it('stores records, advances the cursor and applies deletions', async () => {
    const stub = new FetchStub();
    stub.on('GET /catalog/products', {
      body: {
        items: [
          { id: 'p-1', name: { ro: 'Lapte' }, price: 17.9, updated_at: '2026-08-23T10:00:00Z' },
          { id: 'p-2', name: { ro: 'Pâine' }, price: 9.5, updated_at: '2026-08-23T11:00:00Z' },
        ],
        deleted: [],
        cursor: '2026-08-23T11:00:00Z',
        has_more: false,
      },
    });
    for (const path of otherEndpoints('/catalog/products')) stub.on(path, { body: emptyPage });

    const { db, driver, engine } = await makeEngine(stub);
    const report = await engine.sync();

    expect(report.ok).toBe(true);
    expect(report.pulled).toBe(2);
    const state = await getSyncState(driver, 'products');
    expect(state?.cursor).toBe('2026-08-23T11:00:00Z');
    expect(state?.record_count).toBe(2);
    await db.close();
  });

  it('sends the stored cursor on the next run and keeps untouched rows', async () => {
    const stub = new FetchStub();
    stub.on(
      'GET /catalog/products',
      {
        body: {
          items: [{ id: 'p-1', price: 17.9, updated_at: '2026-08-23T10:00:00Z' }],
          cursor: '2026-08-23T10:00:00Z',
          has_more: false,
        },
      },
      {
        body: {
          items: [{ id: 'p-2', price: 9.5, updated_at: '2026-08-23T12:00:00Z' }],
          deleted: ['p-1'],
          cursor: '2026-08-23T12:00:00Z',
          has_more: false,
        },
      },
    );
    for (const path of otherEndpoints('/catalog/products')) stub.on(path, { body: emptyPage });

    const { db, engine } = await makeEngine(stub);
    await engine.sync({ entities: ['products'] });
    await engine.sync({ entities: ['products'] });

    const productCalls = stub.calls.filter((call) => call.url.includes('/catalog/products'));
    expect(productCalls[0]!.url).not.toContain('updated_since');
    expect(productCalls[1]!.url).toContain('updated_since=2026-08-23T10%3A00%3A00Z');

    const rows = await db.repository('products').query({ entity: 'products' }, { locale: 'ro' });
    expect(rows.map((row) => row.id)).toEqual(['p-2']);
    await db.close();
  });

  it('follows pagination until the server stops asking for more', async () => {
    const stub = new FetchStub();
    stub.on(
      'GET /catalog/products',
      {
        body: {
          items: [{ id: 'p-1', updated_at: '2026-08-23T10:00:00Z' }],
          cursor: '2026-08-23T10:00:00Z',
          has_more: true,
        },
      },
      {
        body: {
          items: [{ id: 'p-2', updated_at: '2026-08-23T11:00:00Z' }],
          cursor: '2026-08-23T11:00:00Z',
          has_more: false,
        },
      },
    );
    for (const path of otherEndpoints('/catalog/products')) stub.on(path, { body: emptyPage });

    const { db, engine } = await makeEngine(stub);
    const result = await engine.syncEntity(entity('products'));
    expect(result.pulled).toBe(2);
    expect(stub.calls.filter((call) => call.url.includes('/catalog/products'))).toHaveLength(2);
    await db.close();
  });

  it('refuses to loop forever when the server sets has_more without a cursor', async () => {
    const stub = new FetchStub();
    stub.on('GET /catalog/products', {
      body: { items: [{ id: 'p-1', updated_at: '2026-08-23T10:00:00Z' }], has_more: true },
    });

    const { db, engine } = await makeEngine(stub);
    const result = await engine.syncEntity(entity('products'));
    expect(result.error).toContain('no cursor');
    await db.close();
  });

  it('drops rows a full-sync entity no longer returns, but keeps local edits', async () => {
    const stub = new FetchStub();
    stub.on(
      'GET /network/stores',
      { body: { items: [{ id: 'st-1', code: 'A' }, { id: 'st-2', code: 'B' }], has_more: false } },
      { body: { items: [{ id: 'st-1', code: 'A' }], has_more: false } },
    );

    const { db, engine } = await makeEngine(stub);
    await engine.syncEntity(entity('stores'));
    await engine.syncEntity(entity('stores'));

    const rows = await db.repository('stores').query({ entity: 'stores' }, { locale: 'ro' });
    expect(rows.map((row) => row.id)).toEqual(['st-1']);
    await db.close();
  });

  it('falls back to the newest cursorField value when the API sends no cursor', async () => {
    const stub = new FetchStub();
    stub.on('GET /catalog/products', {
      body: {
        items: [
          { id: 'p-1', updated_at: '2026-08-23T10:00:00Z' },
          { id: 'p-2', updated_at: '2026-08-23T14:00:00Z' },
        ],
        has_more: false,
      },
    });

    const { db, driver, engine } = await makeEngine(stub);
    await engine.syncEntity(entity('products'));
    expect((await getSyncState(driver, 'products'))?.cursor).toBe('2026-08-23T14:00:00Z');
    await db.close();
  });

  it('skips entities that need a signed-in user when there is none', async () => {
    const stub = new FetchStub();
    const { db, engine } = await makeEngine(stub, { authenticated: false });
    const result = await engine.syncEntity(entity('loyalty_account'));
    expect(result.skipped).toBe('not_authenticated');
    expect(stub.calls).toHaveLength(0);
    await db.close();
  });

  it('records the error and keeps going when one entity fails', async () => {
    const stub = new FetchStub();
    stub.on('GET /catalog/categories', { body: emptyPage });
    stub.on('GET /catalog/products', { status: 500, body: { error: 'boom' } });
    for (const path of otherEndpoints('/catalog/products', '/catalog/categories')) {
      stub.on(path, { body: emptyPage });
    }

    const { db, driver, engine } = await makeEngine(stub);
    const report = await engine.sync();

    expect(report.ok).toBe(false);
    expect(report.errors.join()).toContain('products');
    expect((await getSyncState(driver, 'products'))?.last_error).toContain('500');
    expect(report.entities.find((item) => item.entity === 'stores')?.error).toBeUndefined();
    await db.close();
  });
});

describe('push', () => {
  it('sends queued list changes over REST and clears the queue', async () => {
    const stub = new FetchStub();
    stub.on('PUT /list/items/sli-1', { body: { id: 'sli-1', title: 'Lapte', quantity: 2, updated_at: '2026-08-23T12:00:05Z' } });
    stub.on('GET /list/items', { body: emptyPage });

    const { db, driver, engine } = await makeEngine(stub);
    await db.repository('shopping_list_items').saveLocal({ id: 'sli-1', title: 'Lapte', quantity: 2 });

    const result = await engine.syncEntity(entity('shopping_list_items'));
    expect(result.pushed).toBe(1);
    expect(await pendingCount(driver)).toBe(0);
    expect(await db.repository('shopping_list_items').dirtyCount()).toBe(0);
    await db.close();
  });

  it('treats a 404 on delete as success', async () => {
    const stub = new FetchStub();
    stub.on('DELETE /list/items/sli-1', { status: 404, body: { error: 'gone' } });
    stub.on('GET /list/items', { body: emptyPage });

    const { db, driver, engine } = await makeEngine(stub);
    await db.repository('shopping_list_items').saveLocal({ id: 'sli-1', title: 'Lapte' });
    await db.driver.execute('DELETE FROM _outbox');
    await db.repository('shopping_list_items').deleteLocal('sli-1');

    const result = await engine.syncEntity(entity('shopping_list_items'));
    expect(result.pushed).toBe(1);
    expect(await pendingCount(driver)).toBe(0);
    await db.close();
  });

  it('retries a failed job later with backoff and drops it after maxAttempts', async () => {
    const stub = new FetchStub();
    stub.on('PUT /list/items/sli-1', { status: 400, body: { error: 'invalid' } });
    stub.on('GET /list/items', { body: emptyPage });

    const { db, driver, engine, clock } = await makeEngine(stub);
    await db.repository('shopping_list_items').saveLocal({ id: 'sli-1', title: 'Lapte' });
    clock.value = new Date(Date.now() + 1000);

    const maxAttempts = bundle.app.sync.outbox.maxAttempts;
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      const result = await engine.syncEntity(entity('shopping_list_items'));
      expect(result.failed).toBe(1);
      // The job is not retried until its backoff window has passed.
      const readyNow = await readyJobs(driver, 'shopping_list_items', clock.value!);
      expect(readyNow).toHaveLength(0);
      clock.value = new Date(clock.value!.getTime() + 24 * 3600_000);
    }

    await engine.syncEntity(entity('shopping_list_items'));
    expect(await pendingCount(driver)).toBe(0);
    expect((await getSyncState(driver, 'shopping_list_items'))?.last_error).toContain('dropped');
    await db.close();
  });

  it('sends favourites as one batch and applies the echoed records', async () => {
    const stub = new FetchStub();
    stub.on('POST /account/favorites/batch', {
      body: {
        results: [
          { id: 'fav-1', status: 'ok', record: { id: 'fav-1', product_id: 'p-1', updated_at: '2026-08-23T12:00:09Z' } },
          { id: 'fav-2', status: 'error', error: 'unknown product' },
        ],
      },
    });
    stub.on('GET /account/favorites', { body: emptyPage });

    const { db, driver, engine } = await makeEngine(stub);
    const favorites = db.repository('favorites');
    await favorites.saveLocal({ id: 'fav-1', product_id: 'p-1' });
    await favorites.saveLocal({ id: 'fav-2', product_id: 'p-404' });

    const result = await engine.syncEntity(entity('favorites'));
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);

    const batchCalls = stub.calls.filter((call) => call.url.includes('/batch'));
    expect(batchCalls).toHaveLength(1);
    expect((batchCalls[0]!.body as { operations: unknown[] }).operations).toHaveLength(2);

    const rows = await favorites.query({ entity: 'favorites' }, { locale: 'ro' });
    expect(rows.find((row) => row.id === 'fav-1')?.updated_at).toBe('2026-08-23T12:00:09Z');
    expect(await pendingCount(driver)).toBe(1);
    await db.close();
  });

  it('pushes before pulling so a local change is not overwritten by a stale copy', async () => {
    const stub = new FetchStub();
    stub.on('PUT /list/items/sli-1', { body: { id: 'sli-1', title: 'Lapte', quantity: 2 } });
    stub.on('GET /list/items', { body: emptyPage });

    const { db, engine } = await makeEngine(stub);
    await db.repository('shopping_list_items').saveLocal({ id: 'sli-1', title: 'Lapte', quantity: 2 });
    await engine.syncEntity(entity('shopping_list_items'));

    const methods = stub.calls.map((call) => call.method);
    expect(methods.indexOf('PUT')).toBeLessThan(methods.indexOf('GET'));
    await db.close();
  });
});

describe('sync run', () => {
  it('joins a run that is already in flight instead of starting a second one', async () => {
    const stub = new FetchStub();
    for (const path of otherEndpoints()) stub.on(path, { body: emptyPage });

    const { db, engine } = await makeEngine(stub);
    const [first, second] = await Promise.all([engine.sync(), engine.sync()]);
    expect(first).toBe(second);
    expect(engine.isRunning).toBe(false);
    await db.close();
  });

  it('syncs entities in configured order', async () => {
    const stub = new FetchStub();
    for (const path of otherEndpoints()) stub.on(path, { body: emptyPage });

    const { db, engine } = await makeEngine(stub);
    const report = await engine.sync();
    expect(report.entities.map((item) => item.entity)).toEqual(
      [...bundle.entities.entities].sort((a, b) => a.order - b.order).map((item) => item.name),
    );
    await db.close();
  });
});

const emptyPage = { items: [], deleted: [], cursor: null, has_more: false };

function entity(name: string) {
  return bundle.entities.entities.find((item) => item.name === name)!;
}

/** Every pull endpoint except the ones a test stubs itself. */
function otherEndpoints(...excluded: string[]): string[] {
  return bundle.entities.entities
    .filter((item) => !excluded.includes(item.endpoint))
    .map((item) => `GET ${item.endpoint}`);
}
