#!/usr/bin/env node
/**
 * Mock UNA.md retail API for local development and manual QA.
 *
 *   node tools/mock-server.mjs [--port 4000]
 *
 * Implements the contract described in docs/api-contract.md: delta pull with
 * `updated_since`/`cursor`, REST push for the shopping list and batch push for
 * favourites, plus the `/app-config` endpoint used for remote configuration.
 *
 * The behaviour lives in `mock-backend.cjs`, shared with the demo build of the
 * app; this file only puts it on HTTP.
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import mockBackend from './mock-backend.cjs';

const { createMockBackend, CDN_PREFIX } = mockBackend;

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const configDir = join(here, '..', 'config');

const fixtures = {};
for (const file of readdirSync(fixturesDir)) {
  if (file.endsWith('.json')) {
    fixtures[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  }
}

const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4000);
const origin = `http://localhost:${port}`;

/**
 * Fixture images point at the production CDN, which a developer machine cannot
 * reach. The mock rewrites them to itself and serves a labelled placeholder, so
 * the app looks like the real thing during manual QA and screenshots.
 */
const backend = createMockBackend({
  fixtures,
  appConfig: JSON.parse(readFileSync(join(configDir, 'app.config.json'), 'utf8')),
  baseUrl: origin,
  rewriteImage: (url) => `${origin}/cdn/${url.slice(CDN_PREFIX.length)}`,
  placeholderImage: `${origin}/cdn/placeholder.png`,
});

// The app also runs in a browser (web target, screenshots, manual QA), so the
// mock backend answers cross-origin requests.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tenant, X-App-Platform',
  'Access-Control-Max-Age': '600',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const response = backend.handle({
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    authorization: req.headers.authorization ?? null,
    body: await readBody(req),
  });

  const isJson = response.contentType === 'application/json';
  res.writeHead(response.status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : response.contentType,
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  });
  if (!isJson) res.end(response.text ?? '');
  else res.end(response.body === undefined ? '' : JSON.stringify(response.body));
});

server.listen(port, () => {
  process.stdout.write(`UNA.md mock retail API on ${origin}\n${backend.counts()}\n`);
});
