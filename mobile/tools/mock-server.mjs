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
collections.orders ??= [];

const deletions = { shopping_list_items: [], favorites: [], coupons: [], orders: [] };

let orderCounter = 0;

/** A real backend assigns the number and confirms the order; so does this one. */
function acceptOrder(id, data) {
  const existing = collections.orders.find((item) => item.id === id);
  if (existing) {
    return upsert('orders', id, { ...existing, ...data, number: existing.number });
  }
  orderCounter += 1;
  return upsert('orders', id, {
    ...data,
    number: `A${String(orderCounter).padStart(6, '0')}`,
    status: data.status === 'cancelled' ? 'cancelled' : 'confirmed',
  });
}

const ROUTES = [
  { path: '/catalog/categories', collection: 'categories' },
  { path: '/catalog/products', collection: 'products' },
  { path: '/content/banners', collection: 'banners' },
  { path: '/promo/flyers', collection: 'promotions' },
  { path: '/network/stores', collection: 'stores' },
  { path: '/loyalty/account', collection: 'loyalty_account', auth: true },
  { path: '/account/profile', collection: 'profile', writable: true, auth: true },
  { path: '/account/receipts', collection: 'receipts', auth: true },
  { path: '/account/coupons', collection: 'coupons', writable: true, batch: true, auth: true },
  { path: '/account/orders', collection: 'orders', writable: true, auth: true, orders: true },
  { path: '/list/items', collection: 'shopping_list_items', writable: true },
  { path: '/account/favorites', collection: 'favorites', writable: true, batch: true, auth: true },
];

/**
 * Demo sign-in: any well-formed Moldovan number receives the same code, which
 * the endpoint also returns as `dev_code` so QA never waits for an SMS.
 */
const DEV_CODE = '1234';
const sessions = new Map();
const pushTokens = new Map();
let sessionCounter = 0;

function issueTokens(phone) {
  sessionCounter += 1;
  const access = `demo-access-${sessionCounter}`;
  const refresh = `demo-refresh-${sessionCounter}`;
  const user = collections.profile?.[0] ?? { id: 'usr-1001' };
  sessions.set(access, { refresh, phone });
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    user: {
      id: user.id,
      phone: phone ?? user.phone ?? null,
      email: user.email ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
    },
  };
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4000);

// The app also runs in a browser (web target, screenshots, manual QA), so the
// mock backend answers cross-origin requests.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tenant, X-App-Platform',
  'Access-Control-Max-Age': '600',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Fixture images point at the production CDN, which a developer machine cannot
 * reach. The mock rewrites them to itself and serves a labelled placeholder, so
 * the app looks like the real thing during manual QA and screenshots.
 */
const CDN_PREFIX = 'https://cdn.una.md/';

function localizeImages(value) {
  if (typeof value === 'string') {
    return value.startsWith(CDN_PREFIX) ? `http://localhost:${port}/cdn/${value.slice(CDN_PREFIX.length)}` : value;
  }
  if (Array.isArray(value)) return value.map(localizeImages);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeImages(item)]));
  }
  return value;
}

const PLACEHOLDER_COLORS = ['#E10915', '#00723F', '#1F4E8C', '#B45309', '#6D28D9', '#0E7490'];

function placeholderSvg(path) {
  const label = decodeURIComponent(path.split('/').pop() ?? '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const color = PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="${color}" opacity="0.10"/>
  <circle cx="300" cy="250" r="110" fill="${color}" opacity="0.28"/>
  <text x="300" y="470" font-family="system-ui, sans-serif" font-size="30" fill="${color}"
        text-anchor="middle">${label.slice(0, 22)}</text>
</svg>`;
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
    items: page.map(localizeImages),
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
    theme: { images: { placeholder: `http://localhost:${port}/cdn/placeholder.png` } },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (path.startsWith('/cdn/')) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', ...CORS_HEADERS });
    res.end(placeholderSvg(path));
    return;
  }

  if (path === '/app-config') return send(res, 200, appConfigPayload());
  if (path === '/health') return send(res, 200, { ok: true });

  if (path === '/account/push-token' && req.method === 'POST') {
    const body = (await readBody(req)) ?? {};
    if (!body.token) return send(res, 422, { error: 'token required' });
    pushTokens.set(body.token, { platform: body.platform, user_id: body.user_id, locale: body.locale });
    return send(res, 204);
  }

  if (path.startsWith('/account/push-token/') && req.method === 'DELETE') {
    pushTokens.delete(decodeURIComponent(path.slice('/account/push-token/'.length)));
    return send(res, 204);
  }

  if (path.startsWith('/auth/')) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const body = (await readBody(req)) ?? {};

    if (path === '/auth/request-code') {
      if (!/^\+\d{8,15}$/.test(String(body.phone ?? ''))) {
        return send(res, 422, { error: 'invalid phone' });
      }
      return send(res, 200, {
        request_id: `req-${Date.now()}`,
        resend_after_seconds: 60,
        expires_in_seconds: 300,
        dev_code: DEV_CODE,
      });
    }

    if (path === '/auth/login') {
      const usingPassword = typeof body.password === 'string';
      const valid = usingPassword ? body.password.length >= 4 : String(body.code ?? '') === DEV_CODE;
      if (!valid) return send(res, 422, { error: 'invalid credentials' });
      return send(res, 200, issueTokens(body.phone ?? null));
    }

    if (path === '/auth/refresh') {
      const known = [...sessions.values()].find((item) => item.refresh === body.refresh_token);
      if (!known) return send(res, 401, { error: 'invalid refresh token' });
      return send(res, 200, issueTokens(known.phone));
    }

    if (path === '/auth/logout') {
      const token = bearer(req);
      if (token) sessions.delete(token);
      return send(res, 204);
    }

    return send(res, 404, { error: `no auth route ${path}` });
  }

  const route = ROUTES.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (!route) return send(res, 404, { error: `no route for ${path}` });

  if (route.auth && !bearer(req)) return send(res, 401, { error: 'authentication required' });

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
    const id = decodeURIComponent(rest);
    if (route.orders) return send(res, 200, acceptOrder(id, body ?? {}));
    return send(res, 200, upsert(route.collection, id, body ?? {}));
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
