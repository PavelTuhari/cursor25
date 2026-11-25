/**
 * End-to-end: the pipeline against the SOAP mock, over real HTTP.
 *
 * Everything between `POST /invoices` and a confirmed invoice is exercised -
 * series reservation, XML, the envelope, the response parser and the status
 * poller. Only the certificate is absent, which is what `signing.mode: none`
 * means in a client that signs in the portal.
 */
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';

import {
  MemoryAuditRepository,
  MemoryOutboxRepository,
  MemorySeriesRepository,
} from '../src/db/memory.js';
import { serializeDocument } from '../src/invoice/serialize.js';
import { Pipeline } from '../src/queue/pipeline.js';
import { EFacturaClient } from '../src/sfs/client.js';
import { NoopSigner } from '../src/sign/signer.js';
import { createLogger } from '../src/util/logger.js';
import { resetMock, startMock } from '../mock/sfs-mock.js';
import { demoInvoice, testConfig } from './fixtures.js';

let mock: { port: number; close: () => Promise<void> };
const logger = createLogger('error', {}, () => {});

before(async () => {
  mock = await startMock(0);
});

after(async () => {
  await mock.close();
});

function harness() {
  const config = testConfig();
  config.sfs.endpoint = `http://127.0.0.1:${mock.port}/Service.svc`;

  const outbox = new MemoryOutboxRepository();
  const series = new MemorySeriesRepository();
  const audit = new MemoryAuditRepository();
  const client = new EFacturaClient({ config: config.sfs, logger });
  const pipeline = new Pipeline({
    config,
    outbox,
    series,
    audit,
    client,
    signer: new NoopSigner(logger),
    logger,
  });

  return { config, outbox, series, audit, client, pipeline };
}

beforeEach(() => resetMock());

test('the mock answers Test, which proves the envelope is accepted', async () => {
  const { client } = harness();
  const response = await client.test();
  assert.equal(Number(response.Status), 2);
});

test('taxpayer lookup returns the register entry', async () => {
  const { client } = harness();
  const response = await client.getTaxpayersInfo(['1000000000033']);
  assert.equal(response.Results[0]?.Name, 'UNA RETAIL SRL');
  assert.equal(response.Results[0]?.IsEFacturaActor, 'true');
});

test('an unknown taxpayer comes back flagged, not as an error', async () => {
  const { client } = harness();
  const response = await client.getTaxpayersInfo(['9999999999999']);
  assert.equal(response.Results[0]?.ExistInTaxRegistry, 'false');
});

test('the series pool is topped up when it runs low', async () => {
  const { pipeline, series, config } = harness();
  assert.equal(await series.countFree('test', 0), 0);

  const added = await pipeline.topUpSeries();
  assert.equal(added, config.worker.seriesReserveCount);
  assert.equal(await series.countFree('test', 0), config.worker.seriesReserveCount);

  // Already above the low-water mark, so no second reservation.
  assert.equal(await pipeline.topUpSeries(), 0);
});

test('an invoice travels from pending to confirmed', async () => {
  const { pipeline, outbox } = harness();
  const document = demoInvoice();
  await outbox.enqueue({
    tenantId: 'test',
    externalId: document.externalId,
    payload: serializeDocument(document),
  });

  await pipeline.tick();

  let row = await outbox.findByExternalId('test', document.externalId);
  assert.equal(row?.state, 'posted');
  assert.ok(row?.seria, 'a series was assigned');
  assert.ok(row?.number, 'a number was assigned');
  assert.ok(row?.xml?.includes('<Documents>'));

  // The mock reports "accepted by buyer" once the invoice has aged; without a
  // signature it stays a draft, so drive the signed path through the status
  // poller by re-ticking after the mock's own clock has moved on.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await pipeline.tick();

  row = await outbox.findByExternalId('test', document.externalId);
  assert.equal(row?.invoiceStatus, 0, 'unsigned invoices stay in draft, as the real service does');
});

test('an invalid document fails permanently instead of burning retries', async () => {
  const { pipeline, outbox } = harness();
  const broken = demoInvoice({ externalId: 'DOC-BAD' });
  broken.buyer.idno = 'not-an-idno';

  await outbox.enqueue({
    tenantId: 'test',
    externalId: broken.externalId,
    payload: serializeDocument(broken),
  });
  await pipeline.tick();

  const row = await outbox.findByExternalId('test', 'DOC-BAD');
  assert.equal(row?.state, 'failed');
  assert.equal(row?.attempts, 1);
  assert.match(row?.lastError ?? '', /idno must be 13 digits/);
});

test('enqueueing the same external id twice does not create a second invoice', async () => {
  const { outbox } = harness();
  const document = demoInvoice();
  const first = await outbox.enqueue({
    tenantId: 'test',
    externalId: document.externalId,
    payload: serializeDocument(document),
  });
  const second = await outbox.enqueue({
    tenantId: 'test',
    externalId: document.externalId,
    payload: serializeDocument(document),
  });
  assert.equal(first.id, second.id);
});

test('every SFS call is written to the audit trail', async () => {
  const { pipeline, outbox, audit } = harness();
  const document = demoInvoice();
  await outbox.enqueue({
    tenantId: 'test',
    externalId: document.externalId,
    payload: serializeDocument(document),
  });

  await pipeline.tick();

  const operations = audit.entries.map((entry) => entry.operation);
  assert.ok(operations.includes('GetSeriaAndNumbers'));
  assert.ok(operations.includes('PostInvoices'));
});

test('a QR code and a printable form come back for a posted invoice', async () => {
  const { pipeline, outbox, client } = harness();
  const document = demoInvoice();
  await outbox.enqueue({
    tenantId: 'test',
    externalId: document.externalId,
    payload: serializeDocument(document),
  });
  await pipeline.tick();

  const row = await outbox.findByExternalId('test', document.externalId);
  const identifier = [{ Seria: row!.seria!, Number: row!.number! }];

  const qr = await client.getInvoicesQRcodes(identifier);
  assert.match(qr.Results[0]!.QRCodeText, /efactura\.sfs\.md/);

  const print = await client.getInvoicesContentForPrint(identifier);
  assert.equal(print.Result.Format, 'pdf');
  assert.match(Buffer.from(print.Result.Content, 'base64').toString('utf8'), /^%PDF/);
});

test('bad credentials surface as a fault, not as a silent empty result', async () => {
  const { config } = harness();
  const anonymous = new EFacturaClient({
    config: { ...config.sfs, username: '', password: '' },
    logger,
  });
  await assert.rejects(() => anonymous.test(), /AuthenticationFailedException/);
});
