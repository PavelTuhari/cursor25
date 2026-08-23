#!/usr/bin/env node
/**
 * Mock UNA.md retail API for local development and manual QA.
 *
 *   node tools/mock-server.mjs [--port 4000]
 *
 * Implements the contract described in docs/api-contract.md: delta pull with
 * `updated_since`/`cursor`, REST push for the shopping list and batch push for
 * favourites, plus the `/app-config` endpoint used for remote configuration.
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const configDir = join(here, '..', 'config');

const collections = {};
for (const file of readdirSync(fixturesDir)) {
  if (file.endsWith('.json')) {
    collections[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  }
}
// Writable collections start empty: they are owned by the client.
collections.shopping_list_items ??= [];
collections.favorites ??= [];

const deletions = { shopping_list_items: [], favorites: [] };

const ROUTES = [
  { path: '/catalog/categories', collection: 'categories' },
  { path: '/catalog/products', collection: 'products' },
  { path: '/content/banners', collection: 'banners' },
  { path: '/promo/flyers', collection: 'promotions' },
  { path: '/network/stores', collection: 'stores' },
  { path: '/loyalty/account', collection: 'loyalty_account' },
  { path: '/list/items', collection: 'shopping_list_items', writable: true },
  { path: '/account/favorites', collection: 'favorites', writable: true, batch: true },
];

const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4000);

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function pullCollection(name, url) {
  const updatedSince = url.searchParams.get('updated_since');
  const cursor = url.searchParams.get('cursor');
  const limit = Number(url.searchParams.get('limit') ?? 200);

  const from = updatedSince ?? cursor;
  let items = collections[name] ?? [];
  if (from) items = items.filter((item) => String(item.updated_at ?? '') > from);
  items = [...items].sort((a, b) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')));

  const page = items.slice(0, limit);
  const hasMore = items.length > limit;
  const last = page.at(-1);

  return {
    items: page,
    deleted: from ? deletions[name] ?? [] : [],
    cursor: last?.updated_at ?? from ?? null,
    has_more: hasMore,
    server_time: new Date().toISOString(),
  };
}

function upsert(name, id, data) {
  const record = { ...data, id, updated_at: new Date().toISOString() };
  const collection = collections[name];
  const index = collection.findIndex((item) => item.id === id);
  if (index >= 0) collection[index] = record;
  else collection.push(record);
  return record;
}

function remove(name, id) {
  const collection = collections[name];
  const index = collection.findIndex((item) => item.id === id);
  if (index < 0) return false;
  collection.splice(index, 1);
  (deletions[name] ??= []).push(id);
  return true;
}

function appConfigPayload() {
  // Demonstrates remote configuration: the API base URL is rewritten to this
  // server and one feature flag is toggled without rebuilding the app.
  const app = JSON.parse(readFileSync(join(configDir, 'app.config.json'), 'utf8'));
  return {
    configVersion: app.configVersion,
    app: {
      api: { baseUrl: `http://localhost:${port}` },
      features: { ...app.features, productReviews: false },
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/app-config') return send(res, 200, appConfigPayload());
  if (path === '/health') return send(res, 200, { ok: true });

  const route = ROUTES.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (!route) return send(res, 404, { error: `no route for ${path}` });

  const rest = path.slice(route.path.length).replace(/^\//, '');

  if (req.method === 'GET' && rest === '') {
    return send(res, 200, pullCollection(route.collection, url));
  }

  if (!route.writable) return send(res, 405, { error: 'read-only collection' });

  if (route.batch && req.method === 'POST' && rest === 'batch') {
    const body = await readBody(req);
    const results = (body?.operations ?? []).map((operation) => {
      if (operation.op === 'delete') {
        remove(route.collection, operation.id);
        return { id: operation.id, status: 'ok' };
      }
      return { id: operation.id, status: 'ok', record: upsert(route.collection, operation.id, operation.data ?? {}) };
    });
    return send(res, 200, { results });
  }

  if (req.method === 'PUT' && rest) {
    const body = await readBody(req);
    return send(res, 200, upsert(route.collection, decodeURIComponent(rest), body ?? {}));
  }

  if (req.method === 'DELETE' && rest) {
    const removed = remove(route.collection, decodeURIComponent(rest));
    return send(res, removed ? 204 : 404, removed ? undefined : { error: 'not found' });
  }

  return send(res, 405, { error: `method ${req.method} not allowed on ${path}` });
});

server.listen(port, () => {
  const counts = Object.entries(collections)
    .map(([name, rows]) => `${name}=${rows.length}`)
    .join(' ');
  process.stdout.write(`UNA.md mock retail API on http://localhost:${port}\n${counts}\n`);
});
