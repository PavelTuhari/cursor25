import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrap } from '../src/bootstrap';
import { getKv } from '../src/db/migrator';
import { NodeSqlDriver } from '../src/db/nodeDriver';
import { BLOCK_TYPE_NAMES } from '../src/ui/blocks/blockTypes';
import { FetchStub } from './helpers';

describe('bootstrap', () => {
  it('starts on the bundled config and migrates the database', async () => {
    const stub = new FetchStub().on('GET /app-config', { body: {} });
    const runtime = await bootstrap({
      driver: new NodeSqlDriver(':memory:'),
      deviceLocales: ['ru-MD'],
      fetchImpl: stub.fetch,
    });

    expect(runtime.locale).toBe('ru');
    expect(runtime.themeMode).toBe('system');
    expect(runtime.db.migration.created).toContain('products');
    expect(runtime.config.app.app.name).toBe('UNA Market');
    await runtime.db.close();
  });

  it('applies a remote config and caches it for the next start', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const payload = {
      app: { app: { name: 'Tenant Market' }, features: { promoFlyers: false } },
      theme: { light: { colors: { primary: '#0055AA' } } },
    };
    const stub = new FetchStub().on('GET /app-config', { body: payload });

    const runtime = await bootstrap({ driver, deviceLocales: ['ro'], fetchImpl: stub.fetch });
    const applied = await runtime.refreshRemoteConfig();

    expect(applied?.app.app.name).toBe('Tenant Market');
    expect(applied?.app.features.promoFlyers).toBe(false);
    expect(applied?.theme.light.colors.primary).toBe('#0055AA');
    expect(await getKv(driver, 'config:remote')).toContain('Tenant Market');

    // A restart on the same database picks the cached config up again.
    const second = await bootstrap({ driver, deviceLocales: ['ro'], fetchImpl: stub.fetch });
    expect(second.config.app.app.name).toBe('Tenant Market');
    await driver.close();
  });

  it('keeps running on the bundled config when the remote one is invalid', async () => {
    const stub = new FetchStub().on('GET /app-config', {
      body: { app: { api: { baseUrl: 'not-a-url' } } },
    });
    const runtime = await bootstrap({
      driver: new NodeSqlDriver(':memory:'),
      deviceLocales: ['ro'],
      fetchImpl: stub.fetch,
    });

    expect(await runtime.refreshRemoteConfig()).toBeNull();
    expect(runtime.config.app.api.baseUrl).toBe('https://api.una.md/retail/v1');
    expect(runtime.warnings.join()).toContain('remote config rejected');
    await runtime.db.close();
  });

  it('keeps running when the remote config cannot be downloaded', async () => {
    const stub = new FetchStub().on('GET /app-config', { networkError: true });
    const runtime = await bootstrap({
      driver: new NodeSqlDriver(':memory:'),
      deviceLocales: ['ro'],
      fetchImpl: stub.fetch,
    });

    expect(await runtime.refreshRemoteConfig()).toBeNull();
    expect(runtime.warnings.join()).toContain('remote config download failed');
    await runtime.db.close();
  });

  it('rebuilds the schema when a remote config changes an entity', async () => {
    const driver = new NodeSqlDriver(':memory:');
    const entities = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'entities.config.json'), 'utf8'));
    entities.entities
      .find((entity: { name: string }) => entity.name === 'products')
      .columns.push({ name: 'loyalty_price', type: 'real' });

    const stub = new FetchStub().on('GET /app-config', { body: { entities } });
    const runtime = await bootstrap({ driver, deviceLocales: ['ro'], fetchImpl: stub.fetch });
    await runtime.refreshRemoteConfig();

    const columns = await driver.select<{ name: string }>('PRAGMA table_info(products)');
    expect(columns.map((column) => column.name)).toContain('loyalty_price');
    await driver.close();
  });
});

describe('block registry', () => {
  it('registers exactly the block types the validator knows about', () => {
    // The registry file imports React Native, so it is inspected as source here.
    const source = readFileSync(join(__dirname, '..', 'src', 'ui', 'blocks', 'index.tsx'), 'utf8');
    const body = source.slice(source.indexOf('BLOCK_REGISTRY'), source.indexOf('export const BLOCK_TYPES'));
    const registered = [...body.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    expect(registered.sort()).toEqual([...BLOCK_TYPE_NAMES].sort());
  });
});
