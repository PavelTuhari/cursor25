import { ApiClient, ApiError } from '../src/api/client';
import { FetchStub, loadBundle, makeApiClient } from './helpers';

const bundle = loadBundle();

describe('api client', () => {
  it('builds URLs with the configured base and skips empty query values', () => {
    const client = makeApiClient(bundle.app, new FetchStub().fetch);
    const url = client.buildUrl('/catalog/products', { limit: 100, updated_since: undefined, q: 'lapte' });
    expect(url).toBe('https://api.una.md/retail/v1/catalog/products?limit=100&q=lapte');
  });

  it('sends configured headers and the bearer token', async () => {
    const stub = new FetchStub().on('GET /catalog/products', { body: { items: [] } });
    const captured: RequestInit[] = [];
    const client = new ApiClient({
      config: bundle.app.api,
      tokenProvider: { getToken: async () => 'token-123' },
      sleep: async () => undefined,
      fetchImpl: async (input, init) => {
        captured.push(init ?? {});
        return stub.fetch(input, init);
      },
    });

    await client.request('/catalog/products');
    const headers = captured[0]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-123');
    expect(headers['X-Tenant']).toBe('demo');
  });

  it('retries server errors up to the configured attempt count', async () => {
    const stub = new FetchStub().on(
      'GET /catalog/products',
      { status: 503, body: { error: 'unavailable' } },
      { status: 503, body: { error: 'unavailable' } },
      { body: { items: [{ id: 'p-1' }] } },
    );
    const client = makeApiClient(bundle.app, stub.fetch);

    const result = await client.request<{ items: unknown[] }>('/catalog/products');
    expect(result.items).toHaveLength(1);
    expect(stub.calls).toHaveLength(3);
  });

  it('does not retry a client error', async () => {
    const stub = new FetchStub().on('GET /catalog/products', { status: 422, body: { error: 'bad filter' } });
    const client = makeApiClient(bundle.app, stub.fetch);

    await expect(client.request('/catalog/products')).rejects.toBeInstanceOf(ApiError);
    expect(stub.calls).toHaveLength(1);
  });

  it('retries a network failure and reports it as a status-0 ApiError', async () => {
    const stub = new FetchStub().on(
      'GET /catalog/products',
      { networkError: true },
      { networkError: true },
      { networkError: true },
    );
    const client = makeApiClient(bundle.app, stub.fetch);

    await expect(client.request('/catalog/products')).rejects.toMatchObject({ status: 0 });
    expect(stub.calls).toHaveLength(bundle.app.api.retry.attempts);
  });

  it('refreshes the token once on 401 and replays the request', async () => {
    const stub = new FetchStub().on(
      'GET /loyalty/account',
      { status: 401, body: { error: 'expired' } },
      { body: { items: [] } },
    );
    let refreshes = 0;
    const client = new ApiClient({
      config: bundle.app.api,
      sleep: async () => undefined,
      fetchImpl: stub.fetch,
      tokenProvider: {
        getToken: async () => 'old-token',
        refresh: async () => {
          refreshes += 1;
          return 'new-token';
        },
      },
    });

    await client.request('/loyalty/account');
    expect(refreshes).toBe(1);
    expect(stub.calls).toHaveLength(2);
  });

  it('caps the backoff delay at maxBackoffMs', () => {
    const client = makeApiClient(bundle.app, new FetchStub().fetch);
    const { backoffMs, factor, maxBackoffMs } = bundle.app.api.retry;
    expect(client.backoffDelay(1)).toBe(backoffMs);
    expect(client.backoffDelay(2)).toBe(backoffMs * factor);
    expect(client.backoffDelay(20)).toBe(maxBackoffMs);
  });

  it('honours noRetry for user-initiated calls', async () => {
    const stub = new FetchStub().on('GET /catalog/products', { status: 500, body: {} });
    const client = makeApiClient(bundle.app, stub.fetch);
    await expect(client.request('/catalog/products', { noRetry: true })).rejects.toBeInstanceOf(ApiError);
    expect(stub.calls).toHaveLength(1);
  });
});
