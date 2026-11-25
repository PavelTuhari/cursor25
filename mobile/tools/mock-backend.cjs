/**
 * The mock UNA.md retail API as a pure request -> response function.
 *
 * It holds the whole contract the app talks to - delta pull, REST and batch
 * push, orders, sign-in by code, push tokens, remote config - and nothing that
 * ties it to a runtime: no `node:http`, no file system, no `Buffer`, no `URL`.
 * That is what lets the same code run in two places:
 *
 *   - `tools/mock-server.mjs` wraps it in an HTTP server for development, the
 *     browser preview, screenshots and the end-to-end tests;
 *   - the demo build of the app (`src/demo/`) calls it in place of the network,
 *     so a phone shows a full catalogue with no backend at all.
 *
 * One implementation means the demo cannot drift from what the tests exercise.
 *
 * CommonJS on purpose: Node (from an ES module), Metro and Jest all load it
 * as-is, without a build step and without experimental flags.
 */
'use strict';

/**
 * Demo sign-in: any well-formed Moldovan number receives the same code, which
 * the endpoint also returns as `dev_code` so nobody waits for an SMS.
 */
const DEV_CODE = '1234';

const CDN_PREFIX = 'https://cdn.una.md/';

const PLACEHOLDER_COLORS = ['#E10915', '#00723F', '#1F4E8C', '#B45309', '#6D28D9', '#0E7490'];

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
  // Corporate: the company is edited on the device, invoice requests are
  // pushed and the issued documents come back from the e-Factura service.
  { path: '/account/company', collection: 'company', writable: true, auth: true },
  { path: '/account/invoices', collection: 'fiscal_invoices', writable: true, auth: true },
  // Wallet: connected e-Factura accounts and payments against invoices.
  { path: '/account/connections', collection: 'connections', writable: true, auth: true, connect: true },
  { path: '/account/payments', collection: 'payments', writable: true, auth: true },
  { path: '/list/items', collection: 'shopping_list_items', writable: true },
  { path: '/account/favorites', collection: 'favorites', writable: true, batch: true, auth: true },
];

/** Stable small hash of a label, so the same image always gets the same colour. */
function labelHash(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return hash;
}

/** The file name of a CDN path without its extension: "milk-25.png" -> "milk-25". */
function imageLabel(path) {
  const last = path.split('/').pop() || '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch (_error) {
    // A malformed escape is still a usable label.
  }
  return decoded.replace(/\.(png|jpg|jpeg|webp)$/i, '');
}

function placeholderSvg(path) {
  const label = imageLabel(path);
  const color = PLACEHOLDER_COLORS[labelHash(label) % PLACEHOLDER_COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="${color}" opacity="0.10"/>
  <circle cx="300" cy="250" r="110" fill="${color}" opacity="0.28"/>
  <text x="300" y="470" font-family="system-ui, sans-serif" font-size="30" fill="${color}"
        text-anchor="middle">${label.slice(0, 22)}</text>
</svg>`;
}

/**
 * Splits "/path?x=1&y=2" (or a full URL) into a path and a query object.
 * Written out by hand because React Native's `URL` does not implement
 * `searchParams`, and this runs on a phone as well as in Node.
 */
function parseUrl(input) {
  let rest = String(input);
  const scheme = rest.indexOf('://');
  if (scheme >= 0) {
    const slash = rest.indexOf('/', scheme + 3);
    rest = slash >= 0 ? rest.slice(slash) : '/';
  }

  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);

  const questionMark = rest.indexOf('?');
  const rawPath = questionMark >= 0 ? rest.slice(0, questionMark) : rest;
  const rawQuery = questionMark >= 0 ? rest.slice(questionMark + 1) : '';

  const query = {};
  for (const pair of rawQuery.split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    const key = equals >= 0 ? pair.slice(0, equals) : pair;
    const value = equals >= 0 ? pair.slice(equals + 1) : '';
    const decode = (text) => {
      try {
        return decodeURIComponent(text.replace(/\+/g, ' '));
      } catch (_error) {
        return text;
      }
    };
    query[decode(key)] = decode(value);
  }

  return { path: rawPath.replace(/\/+$/, '') || '/', query };
}

/**
 * @param {object} options
 * @param {Record<string, object[]>} options.fixtures  collection name -> rows
 * @param {{ configVersion: number, features: Record<string, boolean> }} options.appConfig
 * @param {string} options.baseUrl  what `/app-config` tells the app to call
 * @param {(cdnUrl: string) => string} options.rewriteImage  where CDN images point
 * @param {string} [options.placeholderImage]  theme placeholder in `/app-config`
 * @param {() => string} [options.now]  ISO clock, injectable for tests
 */
function createMockBackend(options) {
  const now = options.now || (() => new Date().toISOString());

  // Every instance owns its data: two backends never share rows, and the
  // caller's fixture objects are never mutated.
  const collections = {};
  for (const name of Object.keys(options.fixtures)) {
    collections[name] = JSON.parse(JSON.stringify(options.fixtures[name]));
  }
  // Writable collections start empty: they are owned by the client.
  if (!collections.shopping_list_items) collections.shopping_list_items = [];
  if (!collections.favorites) collections.favorites = [];
  if (!collections.orders) collections.orders = [];

  const deletions = { shopping_list_items: [], favorites: [], coupons: [], orders: [] };
  const sessions = new Map();
  const pushTokens = new Map();
  let sessionCounter = 0;
  let orderCounter = 0;
  let connectionCounter = 0;

  function localizeImages(value) {
    if (typeof value === 'string') {
      return value.startsWith(CDN_PREFIX) ? options.rewriteImage(value) : value;
    }
    if (Array.isArray(value)) return value.map(localizeImages);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) out[key] = localizeImages(value[key]);
      return out;
    }
    return value;
  }

  function upsert(name, id, data) {
    const record = Object.assign({}, data, { id, updated_at: now() });
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
    if (!deletions[name]) deletions[name] = [];
    deletions[name].push(id);
    return true;
  }

  /** A real backend assigns the number and confirms the order; so does this one. */
  function acceptOrder(id, data) {
    const existing = collections.orders.find((item) => item.id === id);
    if (existing) {
      return upsert('orders', id, Object.assign({}, existing, data, { number: existing.number }));
    }
    orderCounter += 1;
    return upsert(
      'orders',
      id,
      Object.assign({}, data, {
        number: `A${String(orderCounter).padStart(6, '0')}`,
        status: data.status === 'cancelled' ? 'cancelled' : 'confirmed',
      }),
    );
  }

  function issueTokens(phone) {
    sessionCounter += 1;
    const access = `demo-access-${sessionCounter}`;
    const refresh = `demo-refresh-${sessionCounter}`;
    const user = (collections.profile && collections.profile[0]) || { id: 'usr-1001' };
    sessions.set(access, { refresh, phone });
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      user: {
        id: user.id,
        phone: phone != null ? phone : user.phone != null ? user.phone : null,
        email: user.email != null ? user.email : null,
        first_name: user.first_name != null ? user.first_name : null,
        last_name: user.last_name != null ? user.last_name : null,
      },
    };
  }

  function pullCollection(name, query) {
    const updatedSince = query.updated_since != null ? query.updated_since : null;
    const cursor = query.cursor != null ? query.cursor : null;
    const limit = Number(query.limit != null ? query.limit : 200);

    const from = updatedSince != null ? updatedSince : cursor;
    let items = collections[name] || [];
    if (from) items = items.filter((item) => String(item.updated_at || '') > from);
    items = items
      .slice()
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));

    const page = items.slice(0, limit);
    const hasMore = items.length > limit;
    const last = page.length > 0 ? page[page.length - 1] : undefined;

    return {
      items: page.map(localizeImages),
      deleted: from ? deletions[name] || [] : [],
      cursor: last && last.updated_at != null ? last.updated_at : from != null ? from : null,
      has_more: hasMore,
      server_time: now(),
    };
  }

  function appConfigPayload() {
    // Demonstrates remote configuration: the API base URL is rewritten to this
    // backend and one feature flag is toggled without rebuilding the app.
    const payload = {
      configVersion: options.appConfig.configVersion,
      app: {
        api: { baseUrl: options.baseUrl },
        features: Object.assign({}, options.appConfig.features, { productReviews: false }),
      },
    };
    if (options.placeholderImage) {
      payload.theme = { images: { placeholder: options.placeholderImage } };
    }
    return payload;
  }

  const json = (status, body) => ({ status, body, contentType: 'application/json' });

  /**
   * @param {{ method: string, url: string, authorization?: string | null, body?: any }} request
   * @returns {{ status: number, body?: any, text?: string, contentType: string }}
   */
  function handle(request) {
    const method = String(request.method || 'GET').toUpperCase();
    const { path, query } = parseUrl(request.url);
    const header = request.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const body = request.body;

    if (path.startsWith('/cdn/')) {
      return { status: 200, text: placeholderSvg(path), contentType: 'image/svg+xml' };
    }

    if (path === '/app-config') return json(200, appConfigPayload());
    if (path === '/health') return json(200, { ok: true });

    if (path === '/account/push-token' && method === 'POST') {
      const payload = body || {};
      if (!payload.token) return json(422, { error: 'token required' });
      pushTokens.set(payload.token, {
        platform: payload.platform,
        user_id: payload.user_id,
        locale: payload.locale,
      });
      return json(204);
    }

    if (path.startsWith('/account/push-token/') && method === 'DELETE') {
      pushTokens.delete(decodeURIComponent(path.slice('/account/push-token/'.length)));
      return json(204);
    }

    if (path.startsWith('/auth/')) {
      if (method !== 'POST') return json(405, { error: 'POST only' });
      const payload = body || {};

      if (path === '/auth/request-code') {
        if (!/^\+\d{8,15}$/.test(String(payload.phone != null ? payload.phone : ''))) {
          return json(422, { error: 'invalid phone' });
        }
        return json(200, {
          request_id: `req-${Date.now()}`,
          resend_after_seconds: 60,
          expires_in_seconds: 300,
          dev_code: DEV_CODE,
        });
      }

      if (path === '/auth/login') {
        const usingPassword = typeof payload.password === 'string';
        const valid = usingPassword
          ? payload.password.length >= 4
          : String(payload.code != null ? payload.code : '') === DEV_CODE;
        if (!valid) return json(422, { error: 'invalid credentials' });
        return json(200, issueTokens(payload.phone != null ? payload.phone : null));
      }

      if (path === '/auth/refresh') {
        let known;
        for (const session of sessions.values()) {
          if (session.refresh === payload.refresh_token) known = session;
        }
        if (!known) return json(401, { error: 'invalid refresh token' });
        return json(200, issueTokens(known.phone));
      }

      if (path === '/auth/logout') {
        if (bearer) sessions.delete(bearer);
        return json(204);
      }

      return json(404, { error: `no auth route ${path}` });
    }

    const route = ROUTES.find((item) => path === item.path || path.startsWith(`${item.path}/`));
    if (!route) return json(404, { error: `no route for ${path}` });

    if (route.auth && !bearer) return json(401, { error: 'authentication required' });

    const rest = path.slice(route.path.length).replace(/^\//, '');

    if (method === 'GET' && rest === '') {
      return json(200, pullCollection(route.collection, query));
    }

    if (!route.writable) return json(405, { error: 'read-only collection' });

    if (route.batch && method === 'POST' && rest === 'batch') {
      const operations = (body && body.operations) || [];
      const results = operations.map((operation) => {
        if (operation.op === 'delete') {
          remove(route.collection, operation.id);
          return { id: operation.id, status: 'ok' };
        }
        return {
          id: operation.id,
          status: 'ok',
          record: upsert(route.collection, operation.id, operation.data || {}),
        };
      });
      return json(200, { results });
    }

    // Connecting a company: the tax-service password is checked and dropped, it
    // is never stored or returned. "wrong" plays the part of a rejected one.
    if (route.connect && method === 'POST' && rest === '') {
      const draft = body || {};
      if (!draft.idno || !draft.sfsUsername || !draft.sfsPassword || draft.consentAccepted !== true) {
        return json(422, { error: 'incomplete connection' });
      }
      if (draft.sfsPassword === 'wrong') return json(422, { error: 'rejected by the tax service' });
      const known = collections.connections.find((item) => item.idno === draft.idno);
      connectionCounter += 1;
      const at = now();
      return json(
        201,
        upsert('connections', known ? known.id : `con-demo-${connectionCounter}`, {
          idno: draft.idno,
          title: known ? known.title : `IDNO ${draft.idno}`,
          actor_role: draft.actorRole != null ? draft.actorRole : 2,
          state: 'active',
          sfs_username: draft.sfsUsername,
          consent_at: at,
          consent_version: draft.consentVersion != null ? draft.consentVersion : null,
          last_poll_at: at,
          last_error: null,
        }),
      );
    }

    if (method === 'PUT' && rest) {
      const id = decodeURIComponent(rest);
      if (route.orders) return json(200, acceptOrder(id, body || {}));
      return json(200, upsert(route.collection, id, body || {}));
    }

    if (method === 'DELETE' && rest) {
      const removed = remove(route.collection, decodeURIComponent(rest));
      return removed ? json(204) : json(404, { error: 'not found' });
    }

    return json(405, { error: `method ${method} not allowed on ${path}` });
  }

  function counts() {
    return Object.keys(collections)
      .map((name) => `${name}=${collections[name].length}`)
      .join(' ');
  }

  return { handle, counts };
}

module.exports = { createMockBackend, parseUrl, imageLabel, labelHash, DEV_CODE, CDN_PREFIX };
