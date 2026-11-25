/**
 * The incoming side, end to end against the SOAP mock.
 *
 * This is where the wallet's promise is checked: a company connects, and its
 * invoices show up - including one from a supplier that never touched our
 * platform, and without the platform's own invoice appearing twice.
 */
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import { MemoryAuditRepository } from '../src/db/memory.js';
import {
  MemoryConnectionRepository,
  MemoryInboxRepository,
} from '../src/db/memoryConnections.js';
import { generateKey, SecretBox } from '../src/crypto/secretBox.js';
import { InboxPipeline } from '../src/queue/inbox.js';
import { EFacturaClientFactory } from '../src/sfs/clientFactory.js';
import { createLogger } from '../src/util/logger.js';
import { buildDocumentsXml } from '../src/invoice/xml.js';
import { EFacturaClient } from '../src/sfs/client.js';
import { resetMock, seedIncomingInvoice, setMockStatus, startMock } from '../mock/sfs-mock.js';
import { demoInvoice, testConfig } from './fixtures.js';

const logger = createLogger('error', {}, () => {});
const KEY = generateKey();

const BUYER_IDNO = '1000000000015';
const PLATFORM_SUPPLIER = '1000000000033';
const OUTSIDE_SUPPLIER = '1000000000024';

let mock: { port: number; close: () => Promise<void> };

before(async () => {
  mock = await startMock(0);
});

after(async () => {
  await mock.close();
});

beforeEach(() => resetMock());

function harness() {
  const config = testConfig();
  config.sfs.endpoint = `http://127.0.0.1:${mock.port}/Service.svc`;
  config.inbox.enabled = true;
  config.inbox.pollIntervalMs = 60_000;
  config.crypto.key = KEY;

  const connections = new MemoryConnectionRepository();
  const inbox = new MemoryInboxRepository();
  const audit = new MemoryAuditRepository();
  const secretBox = new SecretBox(KEY);
  const clients = new EFacturaClientFactory({
    baseConfig: config.sfs,
    connections,
    secretBox,
    logger,
  });
  const pipeline = new InboxPipeline({ config, connections, inbox, audit, clients, logger });

  return { config, connections, inbox, audit, secretBox, clients, pipeline };
}

async function connectBuyer(
  h: ReturnType<typeof harness>,
  password = 'buyer',
): Promise<number> {
  const connection = await h.connections.create({
    tenantId: 'test',
    idno: BUYER_IDNO,
    title: 'ALFA DEMO SRL',
    actorRole: 2,
    sfsUsername: 'buyer',
    sealedSecret: h.secretBox.seal(password),
    consentVersion: '2026-08-25',
    consentAt: new Date(),
  });
  await h.connections.update(connection.id, { state: 'active' });
  return connection.id;
}

/** Issues an invoice the way a seller on the platform does. */
async function issueFromPlatform(h: ReturnType<typeof harness>, seria: string, number: string) {
  const client = new EFacturaClient({
    config: { ...h.config.sfs, username: 'supplier', password: 'supplier' },
    logger,
  });
  const xml = buildDocumentsXml([demoInvoice({ seria, number })]);
  await client.postInvoices(xml, { signed: true });
  // Signed by the supplier and handed to the buyer - the point at which it
  // becomes the buyer's business.
  setMockStatus(seria, number, 7);
}

test('a connected company sees invoices addressed to it', async () => {
  const h = harness();
  await connectBuyer(h);
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000101',
    supplierIdno: OUTSIDE_SUPPLIER,
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 1200,
    totalVat: 200,
  });

  const result = await h.pipeline.tick();
  assert.equal(result.connections, 1);
  assert.equal(result.ingested, 1);

  const rows = await h.inbox.list('test', { limit: 50 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.supplierIdno, OUTSIDE_SUPPLIER);
  assert.equal(rows[0]!.supplierName, 'BETA DEMO SRL');
  assert.equal(rows[0]!.total, 1200);
  assert.equal(rows[0]!.source, 'sfs');
});

test('an invoice from a supplier outside the platform still arrives', async () => {
  const h = harness();
  await connectBuyer(h);

  await issueFromPlatform(h, 'EAA', '000005001');
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000102',
    supplierIdno: OUTSIDE_SUPPLIER,
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 500,
    totalVat: 83.33,
  });

  await h.pipeline.tick();
  const rows = await h.inbox.list('test', { limit: 50 });
  const suppliers = new Set(rows.map((row) => row.supplierIdno));

  // The whole point of the wallet: both are here, and the one we did not issue
  // is indistinguishable in capability from the one we did.
  assert.ok(suppliers.has(OUTSIDE_SUPPLIER), 'invoice from outside the platform');
  assert.ok(suppliers.has(PLATFORM_SUPPLIER), 'invoice issued through the platform');
});

test('a document that arrives twice stays one row', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h);
  await issueFromPlatform(h, 'EAA', '000005002');

  // First the seller hands it to us directly, then the tax service reports it.
  await h.inbox.upsert({
    tenantId: 'test',
    connectionId,
    seria: 'EAA',
    number: '000005002',
    supplierIdno: PLATFORM_SUPPLIER,
    buyerIdno: BUYER_IDNO,
    source: 'platform',
    total: 270.94,
  });

  await h.pipeline.tick();
  await h.pipeline.tick();
  await h.pipeline.tick();

  const rows = await h.inbox.list('test', { limit: 50 });
  const matching = rows.filter((row) => row.seria === 'EAA' && row.number === '000005002');
  assert.equal(matching.length, 1, 'one document, one row');
});

test('a wrong password stops the connection instead of being retried', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h, 'definitely-wrong');

  await h.pipeline.tick();

  const connection = await h.connections.findById('test', connectionId);
  assert.equal(connection?.state, 'invalid');
  assert.match(connection?.lastError ?? '', /Authentication/i);

  // A connection in this state is not picked up again until its owner fixes it.
  const due = await h.connections.duePolling('test', 2, 0, new Date(), 10);
  assert.equal(due.length, 0);
});

test('an unreachable service does not invalidate the connection', async () => {
  const h = harness();
  h.config.sfs.endpoint = 'http://127.0.0.1:1/Service.svc';
  const connectionId = await connectBuyer(h);

  await h.pipeline.tick();

  const connection = await h.connections.findById('test', connectionId);
  // An outage is not a rejected credential, and treating it as one would make
  // every customer re-enter their password after a network blip.
  assert.equal(connection?.state, 'active');
  assert.ok(connection?.lastError);
});

test('accepting a document reaches the tax service', async () => {
  const h = harness();
  await connectBuyer(h);
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000103',
    supplierIdno: OUTSIDE_SUPPLIER,
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 300,
    totalVat: 50,
  });
  await h.pipeline.tick();

  const [row] = await h.inbox.list('test', { limit: 1 });
  await h.inbox.update(row!.id, { decision: 'accepting', decisionAt: new Date() });

  const sent = await h.pipeline.pushDecisions();
  assert.equal(sent, 1);

  const updated = await h.inbox.findById('test', row!.id);
  assert.equal(updated?.decision, 'accepted');

  // And the change is visible on the next status refresh. The poll interval is
  // cleared so the tick is not skipped as too soon.
  await h.connections.update(row!.connectionId, { lastPollAt: null });
  await h.pipeline.tick();
  const refreshed = await h.inbox.findById('test', row!.id);
  assert.equal(refreshed?.invoiceStatus, 3);
});

test('rejecting carries the comment to the supplier', async () => {
  const h = harness();
  await connectBuyer(h);
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000104',
    supplierIdno: OUTSIDE_SUPPLIER,
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 300,
    totalVat: 50,
  });
  await h.pipeline.tick();

  const [row] = await h.inbox.list('test', { limit: 1 });
  await h.inbox.update(row!.id, {
    decision: 'rejecting',
    decisionNote: 'Расхождение по количеству',
    decisionAt: new Date(),
  });

  await h.pipeline.pushDecisions();
  const updated = await h.inbox.findById('test', row!.id);
  assert.equal(updated?.decision, 'rejected');

  await h.connections.update(row!.connectionId, { lastPollAt: null });
  await h.pipeline.tick();
  const refreshed = await h.inbox.findById('test', row!.id);
  assert.equal(refreshed?.invoiceStatus, 2);
});

test('a revoked connection can no longer act', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h);
  seedIncomingInvoice({
    seria: 'EBB',
    number: '000000105',
    supplierIdno: OUTSIDE_SUPPLIER,
    supplierName: 'BETA DEMO SRL',
    buyerIdno: BUYER_IDNO,
    buyerName: 'ALFA DEMO SRL',
    total: 100,
    totalVat: 16.67,
  });
  await h.pipeline.tick();

  const [row] = await h.inbox.list('test', { limit: 1 });
  await h.inbox.update(row!.id, { decision: 'accepting', decisionAt: new Date() });

  await h.connections.revoke(connectionId);
  h.clients.forget(connectionId);

  await h.pipeline.pushDecisions();
  const updated = await h.inbox.findById('test', row!.id);
  assert.equal(updated?.decision, 'failed');
  assert.match(updated?.lastError ?? '', /no longer available/);
});

test('revoking erases the credential, not just a flag', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h);
  assert.ok(await h.connections.secretOf(connectionId));

  await h.connections.revoke(connectionId);

  assert.equal(await h.connections.secretOf(connectionId), null);
  const connection = await h.connections.findById('test', connectionId);
  assert.equal(connection?.state, 'revoked');
  assert.equal(connection?.sfsUsername, null);
});

test('a connection object never carries the sealed secret', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h);

  const connection = await h.connections.findById('test', connectionId);
  const serialised = JSON.stringify(connection);

  assert.ok(!('sealedSecret' in (connection as object)));
  assert.ok(!serialised.includes('buyer-password'));
  assert.ok(!/secret/i.test(serialised));
});

test('polling is skipped until the interval has elapsed', async () => {
  const h = harness();
  await connectBuyer(h);

  const first = await h.pipeline.tick();
  assert.equal(first.connections, 1);

  // Same tenant, same connection, called again immediately.
  const second = await h.pipeline.tick();
  assert.equal(second.connections, 0, 'the interval is respected');
});

test('every poll is written to the audit trail', async () => {
  const h = harness();
  const connectionId = await connectBuyer(h);
  await h.pipeline.tick();

  const records = await h.audit.listByConnection('test', connectionId, 10);
  assert.ok(records.length > 0);
  assert.ok(records.some((record) => record.operation === 'inbox.poll'));
});
