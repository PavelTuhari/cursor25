/**
 * End-to-end check against the mock API: boot the app runtime, pull the
 * catalogue into SQLite, then create a list item offline and push it back.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { bootstrap, type Runtime } from '../src/bootstrap';
import { NodeSqlDriver } from '../src/db/nodeDriver';
import { pendingCount } from '../src/db/outbox';

const PORT = 4599;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess;

async function waitForServer(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('mock server did not start');
}

beforeAll(async () => {
  server = spawn('node', [join(__dirname, '..', 'tools', 'mock-server.mjs'), '--port', String(PORT)], {
    stdio: 'ignore',
  });
  await waitForServer();
}, 20_000);

afterAll(() => {
  server?.kill();
});

async function startApp(driver: NodeSqlDriver): Promise<Runtime> {
  // A dev build points the app at the local mock backend.
  const runtime = await bootstrap({ driver, deviceLocales: ['ro-MD'], apiBaseUrl: BASE });
  await runtime.refreshRemoteConfig();
  return runtime;
}

describe('account area against the mock API', () => {
  it('signs in by SMS code and pulls the account data', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const runtime = await startApp(driver);

    // Anonymous: the account entities are skipped, the catalogue still syncs.
    const anonymous = await runtime.sync.sync();
    expect(anonymous.entities.find((item) => item.entity === 'receipts')?.skipped).toBe('not_authenticated');

    const request = await runtime.auth.requestCode('060 123 456');
    expect(request.devCode).toBe('1234');

    const session = await runtime.auth.verifyCode('060 123 456', request.devCode ?? '', request.requestId);
    expect(session.userId).toBe('usr-1001');
    expect(session.displayName).toBe('Ion Popescu');

    const report = await runtime.sync.sync();
    expect(report.ok).toBe(true);

    const ctx = { locale: 'ro' };
    const receipts = await runtime.db
      .repository('receipts')
      .query({ entity: 'receipts', orderBy: [{ field: 'purchased_at', dir: 'desc' }] }, ctx);
    expect(receipts).toHaveLength(6);
    expect(Array.isArray(receipts[0]!.items)).toBe(true);

    const profile = await runtime.db.repository('profile').query({ entity: 'profile' }, ctx);
    expect(profile[0]?.phone).toBe('+37360123456');

    const loyalty = await runtime.db.repository('loyalty_account').query({ entity: 'loyalty_account' }, ctx);
    expect(loyalty).toHaveLength(1);

    await driver.close();
  }, 30_000);

  it('saves a profile change offline and pushes it, then clears everything on sign-out', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const runtime = await startApp(driver);
    const request = await runtime.auth.requestCode('+37360123456');
    await runtime.auth.verifyCode('+37360123456', request.devCode ?? '', request.requestId);
    await runtime.sync.sync();

    await runtime.db.repository('profile').saveLocal({
      id: 'usr-1001',
      first_name: 'Ionel',
      email: 'ionel@example.md',
      marketing_opt_in: false,
    });
    expect(await pendingCount(driver)).toBe(1);

    const report = await runtime.sync.sync({ entities: ['profile'] });
    expect(report.pushed).toBe(1);
    expect(await pendingCount(driver)).toBe(0);

    const stored = await runtime.db.repository('profile').query({ entity: 'profile' }, { locale: 'ro' });
    expect(stored[0]?.first_name).toBe('Ionel');

    await runtime.auth.logout();
    expect(runtime.auth.isAuthenticated()).toBe(false);
    for (const entity of ['profile', 'receipts', 'loyalty_account']) {
      expect(await runtime.db.repository(entity).query({ entity }, { locale: 'ro' })).toEqual([]);
    }
    // The catalogue is not account data and survives the sign-out.
    const products = await runtime.db.repository('products').query({ entity: 'products', limit: 5 }, { locale: 'ro' });
    expect(products.length).toBeGreaterThan(0);

    await driver.close();
  }, 30_000);
});

describe('app against the mock API', () => {
  it('fills the offline database from the API and serves screen queries from it', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const runtime = await startApp(driver);
    expect(runtime.config.app.api.baseUrl).toBe(BASE);

    const report = await runtime.sync.sync();
    expect(report.ok).toBe(true);
    expect(report.pulled).toBeGreaterThan(30);

    const ctx = { locale: 'ro' };
    const deals = await runtime.db.repository('products').query(
      {
        entity: 'products',
        where: [{ field: 'discount_percent', op: '>', value: 0 }],
        orderBy: [{ field: 'discount_percent', dir: 'desc' }],
        limit: 5,
      },
      ctx,
    );
    expect(deals.length).toBeGreaterThan(0);
    expect(Number(deals[0]!.discount_percent)).toBeGreaterThan(0);

    const roots = await runtime.db.repository('categories').query(
      { entity: 'categories', where: [{ field: 'parent_id', op: 'is null' }] },
      ctx,
    );
    expect(roots).toHaveLength(8);

    const search = await runtime.db
      .repository('products')
      .query({ entity: 'products', search: 'lapte' }, ctx);
    expect(search.length).toBeGreaterThan(0);

    // A second sync sends the cursor: delta entities pull nothing new, while
    // the small `full` collections (banners, stores, loyalty) are re-fetched.
    const second = await runtime.sync.sync();
    expect(second.ok).toBe(true);
    for (const name of ['products', 'categories', 'promotions']) {
      expect(second.entities.find((item) => item.entity === name)?.pulled).toBe(0);
    }
    expect(second.pulled).toBeLessThan(report.pulled);

    await driver.close();
  }, 30_000);

  it('pushes an offline shopping-list change once the API is reachable', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const runtime = await startApp(driver);

    await runtime.db.repository('shopping_list_items').saveLocal({
      id: 'sli-e2e-1',
      title: 'Lapte 2.5%',
      quantity: 2,
      is_done: false,
    });
    expect(await pendingCount(driver)).toBe(1);

    const report = await runtime.sync.sync({ entities: ['shopping_list_items'] });
    expect(report.pushed).toBe(1);
    expect(await pendingCount(driver)).toBe(0);

    const response = await fetch(`${BASE}/list/items?updated_since=2000-01-01T00:00:00Z`);
    const body = (await response.json()) as { items: Array<{ id: string; title: string }> };
    expect(body.items.find((item) => item.id === 'sli-e2e-1')?.title).toBe('Lapte 2.5%');

    // The deletion travels the same way.
    await runtime.db.repository('shopping_list_items').deleteLocal('sli-e2e-1');
    const deleteReport = await runtime.sync.sync({ entities: ['shopping_list_items'] });
    expect(deleteReport.pushed).toBe(1);

    const after = await fetch(`${BASE}/list/items?updated_since=2000-01-01T00:00:00Z`);
    const afterBody = (await after.json()) as { items: unknown[]; deleted: string[] };
    expect(afterBody.deleted).toContain('sli-e2e-1');

    await driver.close();
  }, 30_000);
});
