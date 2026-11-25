/**
 * The demo build: the real runtime over the in-app mock backend, no network.
 * If this passes, a phone with the demo APK shows the same data the
 * end-to-end tests see from the development server.
 */
import { bootstrap } from '../src/bootstrap';
import { NodeSqlDriver } from '../src/db/nodeDriver';
import { pendingCount } from '../src/db/outbox';
import { createDemoFetch, DEMO_BASE_URL } from '../src/demo/demoBackend';

describe('demo build', () => {
  it('fills the app from the built-in backend, signs in with 1234 and places an order', async () => {
    const realFetch = global.fetch;
    const networkCalls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      networkCalls.push(String(input));
      throw new Error('the demo must not touch the network');
    }) as typeof fetch;

    try {
      const driver = new NodeSqlDriver(':memory:');
      const runtime = await bootstrap({
        driver,
        deviceLocales: ['ro-MD'],
        fetchImpl: createDemoFetch(),
        apiBaseUrl: DEMO_BASE_URL,
      });
      expect(await runtime.refreshRemoteConfig()).not.toBeNull();

      const ctx = { locale: 'ro' };
      const anonymous = await runtime.sync.sync();
      expect(anonymous.entities.find((item) => item.entity === 'receipts')?.skipped).toBe('not_authenticated');

      const products = await runtime.db.repository('products').query({ entity: 'products' }, ctx);
      expect(products.length).toBeGreaterThan(10);
      // CDN images become inline PNGs: nothing to download, nothing broken.
      expect(String(products[0]!.image_url)).toMatch(/^data:image\/png;base64,/);
      for (const entity of ['categories', 'banners', 'promotions', 'stores']) {
        expect((await runtime.db.repository(entity).query({ entity }, ctx)).length).toBeGreaterThan(0);
      }

      const request = await runtime.auth.requestCode('060 123 456');
      expect(request.devCode).toBe('1234');
      const session = await runtime.auth.verifyCode('060 123 456', '1234', request.requestId);
      expect(session.displayName).toBe('Ion Popescu');

      const signedIn = await runtime.sync.sync();
      expect(signedIn.ok).toBe(true);
      expect(await runtime.db.repository('receipts').query({ entity: 'receipts' }, ctx)).toHaveLength(6);

      await runtime.db.repository('orders').saveLocal({
        id: 'ord-demo-1',
        status: 'new',
        fulfillment: 'pickup',
        store_id: 'st-01',
        phone: '+37360123456',
        items: [{ product_id: 'p-1001', title: 'Lapte', quantity: 1, price: 17.9, total: 17.9 }],
        item_count: 1,
        subtotal: 17.9,
        total: 17.9,
        placed_at: '2026-09-26T12:00:00Z',
        updated_at: '2026-09-26T12:00:00Z',
      });
      expect((await runtime.sync.sync({ entities: ['orders'] })).pushed).toBe(1);
      expect(await pendingCount(driver)).toBe(0);
      const orders = await runtime.db.repository('orders').query(
        { entity: 'orders', where: [{ field: 'id', op: '=', value: 'ord-demo-1' }] },
        ctx,
      );
      expect(orders[0]).toMatchObject({ status: 'confirmed' });

      // The corporate area and the wallet are part of the demo too.
      for (const entity of ['company', 'fiscal_invoices', 'connections']) {
        expect((await runtime.db.repository(entity).query({ entity }, ctx)).length).toBeGreaterThan(0);
      }

      await driver.close();
    } finally {
      global.fetch = realFetch;
    }

    expect(networkCalls).toEqual([]);
  }, 30_000);

  it('connects a company without keeping or returning the tax-service password', async () => {
    const send = createDemoFetch();
    const post = (url: string, body: unknown, token?: string) =>
      send(`${DEMO_BASE_URL}${url}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      });

    const login = (await (await post('/auth/login', { phone: '+37360123456', code: '1234' })).json()) as {
      access_token: string;
    };
    const draft = { idno: '1000000000099', sfsUsername: 'api-user', consentAccepted: true, actorRole: 2 };

    expect((await post('/account/connections', { ...draft, sfsPassword: 'x' })).status).toBe(401);
    const rejected = await post('/account/connections', { ...draft, sfsPassword: 'wrong' }, login.access_token);
    expect(rejected.status).toBe(422);

    const created = await post('/account/connections', { ...draft, sfsPassword: 'kept-nowhere' }, login.access_token);
    expect(created.status).toBe(201);
    const listed = await send(`${DEMO_BASE_URL}/account/connections`, {
      headers: { Authorization: `Bearer ${login.access_token}` },
    });
    const text = (await created.text()) + (await listed.text());
    expect(text).toContain('1000000000099');
    expect(text).not.toContain('kept-nowhere');
  });
});
