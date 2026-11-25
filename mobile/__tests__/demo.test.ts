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

      await driver.close();
    } finally {
      global.fetch = realFetch;
    }

    expect(networkCalls).toEqual([]);
  }, 30_000);
});
