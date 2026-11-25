/**
 * Entry point: wire everything together, serve, and shut down cleanly.
 *
 * `oracle.connectString` of `memory` selects the in-memory store, which is how
 * the service is demonstrated against the SFS mock before a database exists.
 */
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config/load.js';
import { OracleDriver } from './db/oracle.js';
import {
  MemoryAuditRepository,
  MemoryOutboxRepository,
  MemorySeriesRepository,
} from './db/memory.js';
import {
  OracleAuditRepository,
  OracleOutboxRepository,
  OracleSeriesRepository,
  type AuditRepository,
  type OutboxRepository,
  type SeriesRepository,
} from './db/repositories.js';
import {
  MemoryConnectionRepository,
  MemoryInboxRepository,
} from './db/memoryConnections.js';
import {
  OracleConnectionRepository,
  OracleInboxRepository,
} from './db/connectionRepo.js';
import { SecretBox } from './crypto/secretBox.js';
import { HttpApi } from './http/server.js';
import { ConnectionRoutes } from './http/routes/connections.js';
import { InboxPipeline } from './queue/inbox.js';
import { Pipeline } from './queue/pipeline.js';
import { Worker } from './queue/worker.js';
import { EFacturaClient } from './sfs/client.js';
import { EFacturaClientFactory } from './sfs/clientFactory.js';
import { createSigner } from './sign/index.js';
import { createLogger } from './util/logger.js';

export async function start() {
  const { config, path, appliedEnv, unknownEnv } = loadConfig();
  const logger = createLogger(config.service.logLevel, {
    service: config.service.name,
    tenant: config.service.tenantId,
  });

  logger.info('config.loaded', { path, appliedEnv: appliedEnv.length });
  // A misspelled variable is silent otherwise, and the operator would only
  // notice when the wrong endpoint was called.
  if (unknownEnv.length > 0) logger.warn('config.env.unknown', { names: unknownEnv });

  const inMemory = config.oracle.connectString === 'memory';
  let driver: OracleDriver | null = null;
  let outbox: OutboxRepository;
  let series: SeriesRepository;
  let audit: AuditRepository;

  if (inMemory) {
    logger.warn('db.memory', { reason: 'oracle.connectString is "memory" - nothing is persisted' });
    outbox = new MemoryOutboxRepository();
    series = new MemorySeriesRepository();
    audit = new MemoryAuditRepository();
  } else {
    driver = await OracleDriver.connect(config.oracle, logger);
    outbox = new OracleOutboxRepository(driver);
    series = new OracleSeriesRepository(driver);
    audit = new OracleAuditRepository(driver);
  }

  const client = new EFacturaClient({ config: config.sfs, logger });
  const signer = createSigner(config.signing, logger);
  logger.info('sign.mode', { mode: signer.mode, available: signer.isAvailable() });

  const pipeline = new Pipeline({ config, outbox, series, audit, client, signer, logger });
  const worker = new Worker(pipeline, config.worker, logger);

  // The incoming side is optional: a deployment that only issues invoices never
  // stores anyone else's credentials, and so needs neither key nor tables.
  let connectionRoutes: ConnectionRoutes | undefined;
  let inboxWorker: Worker | undefined;

  if (config.inbox.enabled) {
    const secretBox = new SecretBox(config.crypto.key);
    const connections = inMemory
      ? new MemoryConnectionRepository()
      : new OracleConnectionRepository(driver!);
    const inbox = inMemory ? new MemoryInboxRepository() : new OracleInboxRepository(driver!);

    const clients = new EFacturaClientFactory({
      baseConfig: config.sfs,
      connections,
      secretBox,
      logger,
    });

    const inboxPipeline = new InboxPipeline({ config, connections, inbox, audit, clients, logger });
    connectionRoutes = new ConnectionRoutes({
      config,
      connections,
      inbox,
      audit,
      clients,
      secretBox,
      pipeline: inboxPipeline,
      logger,
    });

    inboxWorker = new Worker(
      { tick: () => inboxPipeline.tick() },
      { ...config.worker, enabled: true, pollIntervalMs: config.inbox.pollIntervalMs },
      logger.child({ component: 'inbox' }),
    );
    logger.info('inbox.enabled', {
      pollIntervalMs: config.inbox.pollIntervalMs,
      backfillMonths: config.inbox.backfillMonths,
    });
  }

  const api = new HttpApi({
    config,
    outbox,
    client,
    pipeline,
    logger,
    connectionRoutes,
    ping: driver ? () => driver!.ping() : undefined,
  });

  await api.listen();
  worker.start();
  inboxWorker?.start();

  const shutdown = async (signal: string) => {
    logger.info('shutdown.begin', { signal });
    await worker.stop();
    await inboxWorker?.stop();
    await api.close();
    await driver?.close();
    logger.info('shutdown.done');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { api, worker, pipeline, logger };
}

// Only auto-start when run directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error: Error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}
