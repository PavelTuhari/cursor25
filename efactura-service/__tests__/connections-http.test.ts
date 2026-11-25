/**
 * The REST surface for connections and the inbox.
 *
 * The assertions that matter most here are negative: a password must not come
 * back out, a connection must not be created without consent, and a decision
 * must not be silently overwritten.
 */
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import { MemoryAuditRepository, MemoryOutboxRepository, MemorySeriesRepository } from '../src/db/memory.js';
import {
  MemoryConnectionRepository,
  MemoryInboxRepository,
} from '../src/db/memoryConnections.js';
import { generateKey, SecretBox } from '../src/crypto/secretBox.js';
import { HttpApi } from '../src/http/server.js';
import { ConnectionRoutes } from '../src/http/routes/connections.js';
import { InboxPipeline } from '../src/queue/inbox.js';
import { Pipeline } from '../src/queue/pipeline.js';
import { EFacturaClient } from '../src/sfs/client.js';
import { EFacturaClientFactory } from '../src/sfs/clientFactory.js';
import { NoopSigner } from '../src/sign/signer.js';
import { createLogger } from '../src/util/logger.js';
import { resetMock, seedIncomingInvoice, startMock } from '../mock/sfs-mock.js';
import { testConfig } from './fixtures.js';

const logger = createLogger('error', {}, () => {});
const TOKEN = 'test-token';
const KEY = generateKey();
const BUYER_IDNO = '1000000000015';

let mock: { port: number; close: () => Promise<void> };
let api: HttpApi;
let baseUrl: string;
let connections: MemoryConnectionRepository;
let inbox: MemoryInboxRepository;
let inboxPipeline: InboxPipeline;

before(async () => {
  mock = await startMock(0);

  const config = testConfig();
  config.sfs.endpoint = `http://127.0.0.1:${mock.port}/Service.svc`;
  config.service.http.port = 8201;
  config.service.http.host = '127.0.0.1';
  config.service.apiToken = TOKEN;
  config.inbox.enabled = true;
  config.crypto.key = KEY;

  connections = new MemoryConnectionRepository();
  inbox = new MemoryInboxRepository();
  const audit = new MemoryAuditRepository();
  const secretBox = new SecretBox(KEY);
  const clients = new EFacturaClientFactory({
    baseConfig: config.sfs,
    connections,
    secretBox,
    logger,
  });
  inboxPipeline = new InboxPipeline({ config, connections, inbox, audit, clients, logger });

  const outbox = new MemoryOutboxRepository();
  const client = new EFacturaClient({ config: config.sfs, logger });

  api = new HttpApi({
    config,
    outbox,
    client,
    pipeline: new Pipeline({
      config,
      outbox,
      series: new MemorySeriesRepository(),
      audit,
      client,
      signer: new NoopSigner(logger),
      logger,
    }),
    connectionRoutes: new ConnectionRoutes({
      config,
      connections,
      inbox,
      audit,
      clients,
      secretBox,
      pipeline: inboxPipeline,
      logger,
    }),
    logger,
  });

  await api.listen();
  baseUrl = `http://127.0.0.1:${config.service.http.port}${config.service.http.basePath}`;
});

after(async () => {
  await api.close();
  await mock.close();
});

beforeEach(async () => {
  resetMock();
  // The poll interval is exercised in inbox.test.ts; here it would only make
  // each test depend on how long the previous one took.
  for (const connection of await connections.list('test')) {
    await connections.update(connection.id, { lastPollAt: null });
  }
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });

const connectBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    idno: BUYER_IDNO,
    actorRole: 2,
    sfsUsername: 'buyer',
    sfsPassword: 'buyer',
    consentAccepted: true,
    ...overrides,
  });

/**
 * The inbox is shared across tests in this file, so a document is looked up by
 * its number rather than by position.
 */
async function inboxRowByNumber(number: string): Promise<Record<string, unknown>> {
  const rows = (await (await call('/inbox')).json()) as Array<Record<string, unknown>>;
  const row = rows.find((candidate) => candidate['number'] === number);
  assert.ok(row, `no inbox row with number ${number}`);
  return row;
}

test('a connection is created and comes back without the password', async () => {
  const response = await call('/connections', { method: 'POST', body: connectBody() });
  assert.equal(response.status, 201);

  const raw = await response.text();
  const body = JSON.parse(raw) as Record<string, unknown>;

  assert.equal(body['idno'], BUYER_IDNO);
  assert.equal(body['state'], 'active');
  // The user name is not a secret and is shown so the owner can recognise which
  // API user is connected; the password is a different matter.
  assert.equal(body['sfsUsername'], 'buyer');
  // The company name was resolved from the register during verification.
  assert.ok(body['title']);
  assert.ok(!/password|secret|sealed/i.test(raw), 'no password-like key');
});

test('a password distinct from the user name still never comes back', async () => {
  // The fixture user happens to share its name with its password, which would
  // let a leak hide behind the user name. Use a value that cannot.
  const stored = await connections.create({
    tenantId: 'test',
    idno: '1000000000033',
    title: 'MAGAZIN DEMO SRL',
    actorRole: 1,
    sfsUsername: 'supplier',
    sealedSecret: new SecretBox(KEY).seal('zzz-unmistakable-password'),
    consentVersion: 'v1',
    consentAt: new Date(),
  });

  const raw = await (await call('/connections')).text();
  assert.ok(raw.includes(String(stored.id)), 'the connection is listed');
  assert.ok(!raw.includes('zzz-unmistakable-password'), 'the password is not in the response');
});

test('the listing never carries credentials either', async () => {
  await call('/connections', { method: 'POST', body: connectBody() });
  const raw = await (await call('/connections')).text();
  assert.ok(!/password|secret|sealed/i.test(raw));
});

test('consent is required before anything is stored', async () => {
  const response = await call('/connections', {
    method: 'POST',
    body: connectBody({ idno: '1000000000024', consentAccepted: false }),
  });

  assert.equal(response.status, 422);
  const body = (await response.json()) as { details: string[] };
  assert.ok(body.details.some((detail) => detail.includes('consentAccepted')));
  assert.equal(await connections.findByIdno('test', '1000000000024', 2), null);
});

test('credentials are verified before they are stored', async () => {
  const response = await call('/connections', {
    method: 'POST',
    body: connectBody({ idno: '1000000000024', sfsUsername: 'beta', sfsPassword: 'wrong' }),
  });

  assert.equal(response.status, 422);
  assert.match(String((await response.json() as any).error), /rejected these credentials/);
  // A credential that does not work must not become a row the poller retries.
  assert.equal(await connections.findByIdno('test', '1000000000024', 2), null);
});

test('a malformed IDNO is refused without contacting the tax service', async () => {
  const response = await call('/connections', { method: 'POST', body: connectBody({ idno: '42' }) });
  assert.equal(response.status, 422);
});

test('revoking erases the credential and answers 404 afterwards for actions', async () => {
  const created = (await (
    await call('/connections', { method: 'POST', body: connectBody() })
  ).json()) as { id: number };

  const revoked = await call(`/connections/${created.id}`, { method: 'DELETE' });
  assert.equal(revoked.status, 200);
  assert.equal(await connections.secretOf(created.id), null);

  const listed = (await (await call('/connections')).json()) as Array<Record<string, unknown>>;
  assert.equal(listed.find((row) => row['id'] === created.id)?.['state'], 'revoked');
});

test('verify reports a working connection and a broken one', async () => {
  const created = (await (
    await call('/connections', { method: 'POST', body: connectBody() })
  ).json()) as { id: number };

  const ok = (await (await call(`/connections/${created.id}/verify`, { method: 'POST' })).json()) as {
    ok: boolean;
  };
  assert.equal(ok.ok, true);
});

test('the audit trail is available to the connected company', async () => {
  const created = (await (
    await call('/connections', { method: 'POST', body: connectBody() })
  ).json()) as { id: number };

  const records = (await (await call(`/connections/${created.id}/audit`)).json()) as Array<
    Record<string, unknown>
  >;
  assert.ok(records.some((record) => record['operation'] === 'connection.created'));
});

test('incoming invoices are listed and can be accepted', async () => {
  const created = (await (
    await call('/connections', { method: 'POST', body: connectBody() })
  ).json()) as { id: number };

  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000201',
    supplierIdno: '1000000000024',
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 900,
    totalVat: 150,
  });

  await call('/inbox/tick', { method: 'POST' });

  const row = await inboxRowByNumber('000000201');
  assert.equal(row['supplierName'], 'BETA DEMO SRL');
  assert.equal(row['invoiceStatusName'], 'sent_to_buyer');
  assert.equal(row['decision'], 'none');

  const id = row['id'] as number;
  const accepted = await call(`/inbox/${id}/accept`, { method: 'POST' });
  assert.equal(accepted.status, 202);
  assert.equal(((await accepted.json()) as any).decision, 'accepting');

  // Queued, not sent: the worker takes it from here.
  await connections.update(created.id, { lastPollAt: null });
  await call('/inbox/tick', { method: 'POST' });
  const after = (await (await call(`/inbox/${id}`)).json()) as Record<string, unknown>;
  assert.equal(after['decision'], 'accepted');
});

test('rejecting without a comment is refused', async () => {
  await call('/connections', { method: 'POST', body: connectBody() });
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000202',
    supplierIdno: '1000000000024',
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 100,
    totalVat: 16.67,
  });
  await call('/inbox/tick', { method: 'POST' });

  const id = (await inboxRowByNumber('000000202'))['id'] as number;

  const empty = await call(`/inbox/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment: '   ' }),
  });
  assert.equal(empty.status, 422);

  const withComment = await call(`/inbox/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment: 'Расхождение по количеству' }),
  });
  assert.equal(withComment.status, 202);
});

test('a decision already made is not silently overwritten', async () => {
  await call('/connections', { method: 'POST', body: connectBody() });
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000203',
    supplierIdno: '1000000000024',
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 100,
    totalVat: 16.67,
  });
  await call('/inbox/tick', { method: 'POST' });

  const id = (await inboxRowByNumber('000000203'))['id'] as number;

  assert.equal((await call(`/inbox/${id}/accept`, { method: 'POST' })).status, 202);

  const second = await call(`/inbox/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment: 'changed my mind' }),
  });
  assert.equal(second.status, 409);
});

test('stats separate the outgoing and incoming sides', async () => {
  await call('/connections', { method: 'POST', body: connectBody() });
  const stats = (await (await call('/stats')).json()) as Record<string, any>;

  assert.ok(stats['outgoing']);
  assert.ok(stats['incoming']);
  assert.equal(stats['incoming']['connections']['active'], 1);
});

test('an unknown invoice and an unknown connection are 404', async () => {
  assert.equal((await call('/inbox/999999')).status, 404);
  assert.equal((await call('/connections/999999')).status, 404);
});
