import { PushService, type PermissionStatus, type PushAdapter } from '../src/push/pushService';
import { resolveNotificationRoute } from '../src/push/routing';
import { isLoyaltyCode, looksLikeProductCode, normalizeScannedCode, scanCandidates, withCheckDigit } from '../src/domain/scan';
import { getKv } from '../src/db/migrator';
import { FetchStub, loadBundle, makeApiClient, openTestDatabase } from './helpers';

const bundle = loadBundle();

class FakeAdapter implements PushAdapter {
  platform = 'android';
  isDevice = true;
  requests = 0;

  constructor(
    private status: PermissionStatus,
    private token: string | null = 'ExponentPushToken[abc]',
  ) {}

  async getPermissionStatus(): Promise<PermissionStatus> {
    return this.status;
  }

  async requestPermission(): Promise<PermissionStatus> {
    this.requests += 1;
    this.status = 'granted';
    return this.status;
  }

  async getToken(): Promise<string | null> {
    return this.token;
  }
}

async function makeService(adapter: PushAdapter, userId: string | null = 'usr-1', stub = new FetchStub()) {
  const { db, driver } = await openTestDatabase(bundle);
  stub.on('POST /account/push-token', { status: 204 });
  const service = new PushService({
    api: makeApiClient(bundle.app, stub.fetch),
    driver,
    config: bundle.app.push,
    adapter,
    locale: () => 'ro',
    userId: () => userId,
  });
  return { db, driver, service, stub };
}

describe('push registration', () => {
  it('registers the token once and skips the repeat', async () => {
    const { service, stub, driver, db } = await makeService(new FakeAdapter('granted'));

    const first = await service.register(false);
    expect(first).toMatchObject({ status: 'granted', sent: true });
    expect(stub.calls[0]!.body).toMatchObject({
      token: 'ExponentPushToken[abc]',
      platform: 'android',
      locale: 'ro',
      user_id: 'usr-1',
    });
    expect(await getKv(driver, 'push:token')).toBe('ExponentPushToken[abc]');

    const second = await service.register(false);
    expect(second.sent).toBe(false);
    expect(stub.calls).toHaveLength(1);
    await db.close();
  });

  it('re-registers when the signed-in user changes', async () => {
    const adapter = new FakeAdapter('granted');
    const { service, stub, db } = await makeService(adapter, 'usr-1');
    await service.register(false);

    const other = new PushService({
      api: makeApiClient(bundle.app, stub.fetch),
      driver: db.driver,
      config: bundle.app.push,
      adapter,
      locale: () => 'ro',
      userId: () => 'usr-2',
    });
    const result = await other.register(false);
    expect(result.sent).toBe(true);
    expect(stub.calls).toHaveLength(2);
    await db.close();
  });

  it('does not ask for permission on a silent registration', async () => {
    const adapter = new FakeAdapter('undetermined');
    const { service, stub, db } = await makeService(adapter);

    const silent = await service.register(false);
    expect(silent).toMatchObject({ status: 'undetermined', sent: false });
    expect(adapter.requests).toBe(0);
    expect(stub.calls).toHaveLength(0);

    const asked = await service.register(true);
    expect(adapter.requests).toBe(1);
    expect(asked.sent).toBe(true);
    await db.close();
  });

  it('stays quiet when permission was denied, on a simulator, or with push disabled', async () => {
    const denied = await makeService(new FakeAdapter('denied'));
    expect(await denied.service.register(true)).toMatchObject({ status: 'denied', sent: false });
    expect(denied.stub.calls).toHaveLength(0);
    await denied.db.close();

    const simulator = await makeService(Object.assign(new FakeAdapter('granted'), { isDevice: false }));
    expect((await simulator.service.register(true)).status).toBe('unsupported');
    await simulator.db.close();

    const off = await makeService(new FakeAdapter('granted'));
    off.service.setConfig({ ...bundle.app.push, enabled: false });
    expect((await off.service.register(true)).status).toBe('disabled');
    await off.db.close();
  });

  it('tells the backend to forget the device on sign-out', async () => {
    const { service, stub, db } = await makeService(new FakeAdapter('granted'));
    stub.on('DELETE /account/push-token/ExponentPushToken[abc]', { status: 204 });
    await service.register(false);

    await service.unregister();
    expect(stub.calls.some((call) => call.method === 'DELETE')).toBe(true);

    // After a sign-out the next registration must reach the server again.
    await service.register(false);
    expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    await db.close();
  });

  it('survives a backend that rejects the unregister call', async () => {
    const { service, stub, db } = await makeService(new FakeAdapter('granted'));
    stub.on('DELETE /account/push-token/ExponentPushToken[abc]', { status: 500, body: {} });
    await service.register(false);
    await expect(service.unregister()).resolves.toBeUndefined();
    await db.close();
  });
});

describe('notification routing', () => {
  it('follows an explicit screen with parameters', () => {
    expect(resolveNotificationRoute({ screen: 'product', params: { productId: 'p-1001' } })).toEqual({
      screen: 'product',
      params: { productId: 'p-1001' },
    });
    expect(resolveNotificationRoute({ screen: 'promos' })).toEqual({ screen: 'promos' });
  });

  it('maps the payload types the backend sends', () => {
    expect(resolveNotificationRoute({ type: 'order', order_id: 'ord-1' })).toEqual({
      screen: 'order',
      params: { orderId: 'ord-1' },
    });
    expect(resolveNotificationRoute({ type: 'product', id: 42 })).toEqual({
      screen: 'product',
      params: { productId: '42' },
    });
    expect(resolveNotificationRoute({ type: 'coupon' })).toEqual({ screen: 'coupons' });
  });

  it('refuses screens it does not know and payloads without an id', () => {
    expect(resolveNotificationRoute({ screen: 'admin' })).toBeNull();
    expect(resolveNotificationRoute({ screen: '../../etc/passwd' })).toBeNull();
    expect(resolveNotificationRoute({ type: 'order' })).toBeNull();
    expect(resolveNotificationRoute({ type: 'unknown', id: '1' })).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute('product')).toBeNull();
  });

  it('drops non-string parameters instead of passing them through', () => {
    expect(resolveNotificationRoute({ screen: 'category', params: { categoryId: { $ne: 1 } } })).toEqual({
      screen: 'category',
    });
  });
});

describe('scanned codes', () => {
  it('normalises what the camera returns', () => {
    expect(normalizeScannedCode('  4841234500017 ')).toBe('4841234500017');
    expect(normalizeScannedCode('484 123 450 0017')).toBe('4841234500017');
  });

  it('looks a product up by every equivalent form of the code', () => {
    expect(scanCandidates('012345678905')).toEqual(['012345678905', '0012345678905']);
    expect(scanCandidates('0012345678905')).toEqual(['0012345678905', '012345678905', '12345678905']);
    expect(scanCandidates('12345670')).toEqual(['12345670', '0000012345670']);
    expect(scanCandidates('  ')).toEqual([]);
  });

  it('separates product codes from anything else', () => {
    expect(looksLikeProductCode('4841234500017')).toBe(true);
    expect(looksLikeProductCode('https://una.md/p/1')).toBe(false);
    expect(looksLikeProductCode('1234')).toBe(false);
  });

  it('recognises a loyalty card by prefix and check digit', () => {
    const card = withCheckDigit('484123450001');
    expect(isLoyaltyCode(card, '484')).toBe(true);
    expect(isLoyaltyCode('4841234500019', '484')).toBe(false);
    expect(isLoyaltyCode(card, '999')).toBe(false);
  });
});
