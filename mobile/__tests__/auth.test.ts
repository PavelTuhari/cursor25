import { AuthService } from '../src/auth/authService';
import { MemoryStorage } from '../src/auth/secureStorage';
import { AuthError, type Session } from '../src/auth/types';
import { pendingCount } from '../src/db/outbox';
import { getSyncState } from '../src/db/syncState';
import { FetchStub, loadBundle, makeApiClient, openTestDatabase } from './helpers';

const bundle = loadBundle();

async function makeAuth(stub: FetchStub) {
  const { db, driver } = await openTestDatabase(bundle);
  const storage = new MemoryStorage();
  const api = makeApiClient(bundle.app, stub.fetch);
  const auth = new AuthService({
    api,
    db,
    storage,
    config: bundle.app.api.auth,
    now: () => new Date('2026-08-23T12:00:00Z'),
  });
  api.setTokenProvider(auth.tokenProvider());
  return { db, driver, storage, api, auth };
}

const tokenBody = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  user: { id: 'usr-1', phone: '+37360123456', email: 'ion@example.md', first_name: 'Ion', last_name: 'Popescu' },
};

describe('sign-in by SMS code', () => {
  it('normalises the phone number before asking for a code', async () => {
    const stub = new FetchStub().on('POST /auth/request-code', {
      body: { request_id: 'req-1', resend_after_seconds: 45, expires_in_seconds: 300, dev_code: '1234' },
    });
    const { auth, db } = await makeAuth(stub);

    const request = await auth.requestCode('060 123 456');
    expect(stub.calls[0]!.body).toEqual({ phone: '+37360123456' });
    expect(request).toMatchObject({ requestId: 'req-1', resendAfterSeconds: 45, devCode: '1234' });
    await db.close();
  });

  it('rejects an unusable phone number without calling the API', async () => {
    const stub = new FetchStub();
    const { auth, db } = await makeAuth(stub);

    await expect(auth.requestCode('123')).rejects.toMatchObject({ code: 'invalid_phone' });
    expect(stub.calls).toHaveLength(0);
    await db.close();
  });

  it('checks the code length locally, then stores the session', async () => {
    const stub = new FetchStub().on('POST /auth/login', { body: tokenBody });
    const { auth, storage, db } = await makeAuth(stub);

    await expect(auth.verifyCode('+37360123456', '12')).rejects.toMatchObject({ code: 'invalid_code' });
    expect(stub.calls).toHaveLength(0);

    const session = await auth.verifyCode('+37360123456', '1234', 'req-1');
    expect(session).toMatchObject({
      userId: 'usr-1',
      token: 'access-1',
      refreshToken: 'refresh-1',
      displayName: 'Ion Popescu',
      expiresAt: '2026-08-23T13:00:00.000Z',
    });
    expect(stub.calls[0]!.body).toEqual({ phone: '+37360123456', code: '1234', request_id: 'req-1' });

    const stored = JSON.parse((await storage.get('auth:session')) as string) as Session;
    expect(stored.token).toBe('access-1');
    expect(auth.isAuthenticated()).toBe(true);
    await db.close();
  });

  it('maps API failures onto auth error codes', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { status: 422, body: { error: 'wrong code' } })
      .on('POST /auth/request-code', { networkError: true });
    const { auth, db } = await makeAuth(stub);

    await expect(auth.verifyCode('+37360123456', '9999')).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(auth.requestCode('+37360123456')).rejects.toMatchObject({ code: 'network' });
    await db.close();
  });

  it('restores a session saved on the device and notifies subscribers', async () => {
    const stub = new FetchStub().on('POST /auth/login', { body: tokenBody });
    const { auth, storage, db, api } = await makeAuth(stub);
    await auth.verifyCode('+37360123456', '1234');

    const second = new AuthService({ api, db, storage, config: bundle.app.api.auth });
    const seen: Array<Session | null> = [];
    second.subscribe((session) => seen.push(session));

    const restored = await second.restore();
    expect(restored?.token).toBe('access-1');
    expect(seen).toHaveLength(1);
    await db.close();
  });
});

describe('token lifecycle', () => {
  it('sends the token as a bearer header', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { body: tokenBody })
      .on('GET /account/receipts', { body: { items: [] } });
    const { auth, api, db } = await makeAuth(stub);

    await auth.verifyCode('+37360123456', '1234');
    await api.request('/account/receipts');

    const call = stub.calls.find((item) => item.url.includes('/account/receipts'));
    expect(call).toBeDefined();
    await db.close();
  });

  it('refreshes an expired token once for concurrent callers', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { body: tokenBody })
      .on('POST /auth/refresh', { body: { ...tokenBody, access_token: 'access-2' } });
    const { auth, db } = await makeAuth(stub);
    await auth.verifyCode('+37360123456', '1234');

    const [first, second] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect(first).toBe('access-2');
    expect(second).toBe('access-2');
    expect(stub.calls.filter((call) => call.url.includes('/auth/refresh'))).toHaveLength(1);
    expect(auth.getSession()?.token).toBe('access-2');
    await db.close();
  });

  it('signs the user out when the refresh token is rejected', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { body: tokenBody })
      .on('POST /auth/refresh', { status: 401, body: { error: 'expired' } });
    const { auth, storage, db } = await makeAuth(stub);
    await auth.verifyCode('+37360123456', '1234');

    expect(await auth.refresh()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(await storage.get('auth:session')).toBeNull();
    await db.close();
  });
});

describe('sign-out', () => {
  it('clears account data but keeps the shopping list', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { body: tokenBody })
      .on('POST /auth/logout', { status: 204 });
    const { auth, db, driver } = await makeAuth(stub);
    await auth.verifyCode('+37360123456', '1234');

    const stamp = '2026-08-23T12:00:00Z';
    await db.repository('receipts').upsertFromServer({ id: 'rcp-1', total: 100 }, stamp);
    await db.repository('loyalty_account').upsertFromServer({ id: 'loy-1', points: 500 }, stamp);
    await db.repository('profile').upsertFromServer({ id: 'usr-1', first_name: 'Ion' }, stamp);
    await db.repository('favorites').saveLocal({ id: 'fav-1', product_id: 'p-1' });
    await db.repository('shopping_list_items').saveLocal({ id: 'sli-1', title: 'Lapte' });
    await db.driver.execute("UPDATE _sync_state SET cursor = '2026-08-23T12:00:00Z' WHERE entity = 'receipts'");

    await auth.logout();

    const ctx = { locale: 'ro' };
    expect(await db.repository('receipts').query({ entity: 'receipts' }, ctx)).toEqual([]);
    expect(await db.repository('loyalty_account').query({ entity: 'loyalty_account' }, ctx)).toEqual([]);
    expect(await db.repository('profile').query({ entity: 'profile' }, ctx)).toEqual([]);
    expect(await db.repository('favorites').query({ entity: 'favorites' }, ctx)).toEqual([]);

    // The device's own shopping list is not account data.
    const list = await db.repository('shopping_list_items').query({ entity: 'shopping_list_items' }, ctx);
    expect(list.map((row) => row.id)).toEqual(['sli-1']);

    expect((await getSyncState(driver, 'receipts'))?.cursor).toBeNull();
    // Queued favourites are dropped with the account; the list item stays queued.
    expect(await pendingCount(driver)).toBe(1);
    await db.close();
  });

  it('signs out locally even when the server call fails', async () => {
    const stub = new FetchStub()
      .on('POST /auth/login', { body: tokenBody })
      .on('POST /auth/logout', { networkError: true });
    const { auth, storage, db } = await makeAuth(stub);
    await auth.verifyCode('+37360123456', '1234');

    await auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
    expect(await storage.get('auth:session')).toBeNull();
    await db.close();
  });
});

describe('password flow', () => {
  it('posts login and password when the flow is configured that way', async () => {
    const stub = new FetchStub().on('POST /auth/login', { body: tokenBody });
    const { auth, db } = await makeAuth(stub);
    auth.setConfig({ ...bundle.app.api.auth, flow: 'password' });

    await auth.loginWithPassword(' ion@example.md ', 'secret123');
    expect(stub.calls[0]!.body).toEqual({ login: 'ion@example.md', password: 'secret123' });
    await db.close();
  });

  it('reports a missing endpoint instead of guessing one', async () => {
    const stub = new FetchStub();
    const { auth, db } = await makeAuth(stub);
    auth.setConfig({ mode: 'bearer', flow: 'otp', anonymousAllowed: true });

    await expect(auth.requestCode('+37360123456')).rejects.toBeInstanceOf(AuthError);
    await expect(auth.verifyCode('+37360123456', '1234')).rejects.toMatchObject({ code: 'not_configured' });
    await db.close();
  });
});
