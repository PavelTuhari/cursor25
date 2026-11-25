import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import { MemoryAuditRepository, MemoryOutboxRepository, MemorySeriesRepository } from '../src/db/memory.js';
import { HttpApi } from '../src/http/server.js';
import { Pipeline } from '../src/queue/pipeline.js';
import { EFacturaClient } from '../src/sfs/client.js';
import { NoopSigner } from '../src/sign/signer.js';
import { createLogger } from '../src/util/logger.js';
import { resetMock, startMock } from '../mock/sfs-mock.js';
import { demoInvoice, testConfig } from './fixtures.js';

const logger = createLogger('error', {}, () => {});
let mock: { port: number; close: () => Promise<void> };
let api: HttpApi;
let outbox: MemoryOutboxRepository;
let baseUrl: string;
const TOKEN = 'test-token';

before(async () => {
  mock = await startMock(0);

  const config = testConfig();
  config.sfs.endpoint = `http://127.0.0.1:${mock.port}/Service.svc`;
  config.service.http.port = 8199;
  config.service.http.host = '127.0.0.1';
  config.service.apiToken = TOKEN;

  outbox = new MemoryOutboxRepository();
  const client = new EFacturaClient({ config: config.sfs, logger });
  const pipeline = new Pipeline({
    config,
    outbox,
    series: new MemorySeriesRepository(),
    audit: new MemoryAuditRepository(),
    client,
    signer: new NoopSigner(logger),
    logger,
  });

  api = new HttpApi({ config, outbox, client, pipeline, logger });
  await api.listen();
  baseUrl = `http://127.0.0.1:${config.service.http.port}${config.service.http.basePath}`;
});

after(async () => {
  await api.close();
  await mock.close();
});

beforeEach(() => resetMock());

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

test('health needs no token, everything else does', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);

  const stats = await fetch(`${baseUrl}/stats`);
  assert.equal(stats.status, 401);

  const wrongToken = await fetch(`${baseUrl}/stats`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrongToken.status, 401);

  assert.equal((await authed('/stats')).status, 200);
});

test('a valid invoice is accepted for processing', async () => {
  const response = await authed('/invoices', {
    method: 'POST',
    body: JSON.stringify(demoInvoice({ externalId: 'HTTP-1' })),
  });

  assert.equal(response.status, 202);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body['externalId'], 'HTTP-1');
  assert.equal(body['state'], 'pending');
});

test('an invalid invoice is refused with the reasons, not queued', async () => {
  const broken = demoInvoice({ externalId: 'HTTP-BAD' });
  broken.buyer.idno = '42';

  const response = await authed('/invoices', { method: 'POST', body: JSON.stringify(broken) });
  assert.equal(response.status, 422);

  const body = (await response.json()) as { error: string; details: string[] };
  assert.equal(body.error, 'invalid document');
  assert.ok(body.details.some((detail) => detail.includes('buyer.idno')));
  assert.equal(await outbox.findByExternalId('test', 'HTTP-BAD'), null);
});

test('posting the same invoice twice returns the same row', async () => {
  const payload = JSON.stringify(demoInvoice({ externalId: 'HTTP-DUP' }));
  const first = (await (await authed('/invoices', { method: 'POST', body: payload })).json()) as any;
  const second = (await (await authed('/invoices', { method: 'POST', body: payload })).json()) as any;
  assert.equal(first.externalId, second.externalId);
  assert.equal((await outbox.list('test', { limit: 100 })).filter((r) => r.externalId === 'HTTP-DUP').length, 1);
});

test('an unknown invoice is a 404', async () => {
  const response = await authed('/invoices/NOPE');
  assert.equal(response.status, 404);
});

test('asking for a PDF before the invoice has a number is a 409, not a crash', async () => {
  await authed('/invoices', { method: 'POST', body: JSON.stringify(demoInvoice({ externalId: 'HTTP-2' })) });
  const response = await authed('/invoices/HTTP-2/pdf');
  assert.equal(response.status, 409);
});

test('a taxpayer lookup is proxied to SFS', async () => {
  const response = await authed('/taxpayers/1000000000033');
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body['Name'], 'UNA RETAIL SRL');
});

test('a malformed IDNO does not reach SFS', async () => {
  assert.equal((await authed('/taxpayers/123')).status, 404);
});

test('a manual tick drives the queue and the invoice becomes retrievable', async () => {
  await authed('/invoices', { method: 'POST', body: JSON.stringify(demoInvoice({ externalId: 'HTTP-3' })) });
  const tick = await authed('/tick', { method: 'POST' });
  assert.equal(tick.status, 200);

  const view = (await (await authed('/invoices/HTTP-3')).json()) as Record<string, unknown>;
  assert.equal(view['state'], 'posted');
  assert.ok(view['seria']);

  const pdf = (await (await authed('/invoices/HTTP-3/pdf')).json()) as Record<string, unknown>;
  assert.equal(pdf['format'], 'pdf');

  const qr = (await (await authed('/invoices/HTTP-3/qr')).json()) as Record<string, unknown>;
  assert.match(String(qr['text']), /efactura\.sfs\.md/);
});

test('malformed JSON is a 400 rather than a 500', async () => {
  const response = await authed('/invoices', { method: 'POST', body: '{not json' });
  assert.equal(response.status, 400);
});
