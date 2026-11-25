/**
 * Configuration validation. Runs at start-up and from `npm run validate-config`,
 * so a bad deployment fails immediately and loudly instead of at the first
 * invoice.
 */

type Json = Record<string, unknown>;

function at(root: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (!node || typeof node !== 'object') return undefined;
    return (node as Json)[key];
  }, root);
}

interface Rule {
  path: string;
  check: (value: unknown, root: Json) => string | null;
}

const nonEmptyString = (label: string) => (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? null : `${label} must be a non-empty string`;

const positiveInt = (label: string) => (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? null
    : `${label} must be a positive integer`;

const oneOf = (label: string, values: readonly unknown[]) => (value: unknown) =>
  values.includes(value) ? null : `${label} must be one of ${values.map(String).join(', ')}`;

const RULES: Rule[] = [
  { path: 'service.name', check: nonEmptyString('service.name') },
  { path: 'service.tenantId', check: nonEmptyString('service.tenantId') },
  { path: 'service.http.port', check: positiveInt('service.http.port') },
  { path: 'service.http.host', check: nonEmptyString('service.http.host') },
  {
    path: 'service.http.basePath',
    check: (v) =>
      typeof v === 'string' && v.startsWith('/')
        ? null
        : 'service.http.basePath must start with "/"',
  },
  {
    path: 'service.logLevel',
    check: oneOf('service.logLevel', ['debug', 'info', 'warn', 'error']),
  },

  {
    path: 'sfs.endpoint',
    check: (v) => {
      if (typeof v !== 'string' || v.trim() === '') return 'sfs.endpoint must be a non-empty string';
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        return 'sfs.endpoint must be a valid URL';
      }
      // The published binding is TransportWithMessageCredential: the username
      // token is only protected by TLS, so plain http would leak it.
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
        return 'sfs.endpoint must use https (plain http is only allowed for a local mock)';
      return null;
    },
  },
  { path: 'sfs.soapNamespace', check: nonEmptyString('sfs.soapNamespace') },
  { path: 'sfs.modelNamespace', check: nonEmptyString('sfs.modelNamespace') },
  { path: 'sfs.timeoutMs', check: positiveInt('sfs.timeoutMs') },
  {
    path: 'sfs.retries',
    check: (v) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0
        ? null
        : 'sfs.retries must be a non-negative integer',
  },
  { path: 'sfs.actorRole', check: oneOf('sfs.actorRole', [1, 2, 3]) },
  { path: 'sfs.invoiceType', check: oneOf('sfs.invoiceType', [0, 1]) },

  { path: 'oracle.connectString', check: nonEmptyString('oracle.connectString') },
  { path: 'oracle.user', check: nonEmptyString('oracle.user') },
  { path: 'oracle.schema', check: nonEmptyString('oracle.schema') },
  { path: 'oracle.poolMax', check: positiveInt('oracle.poolMax') },
  {
    path: 'oracle.poolMin',
    check: (v, root) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        return 'oracle.poolMin must be a non-negative integer';
      const max = at(root, 'oracle.poolMax');
      if (typeof max === 'number' && v > max) return 'oracle.poolMin must not exceed oracle.poolMax';
      return null;
    },
  },

  { path: 'erp.source', check: oneOf('erp.source', ['views', 'none']) },

  { path: 'signing.mode', check: oneOf('signing.mode', ['none', 'pkcs12', 'pkiserver']) },
  {
    path: 'signing.pkcs12.digest',
    check: oneOf('signing.pkcs12.digest', ['sha1', 'sha256']),
  },

  { path: 'crypto.consentVersion', check: nonEmptyString('crypto.consentVersion') },

  { path: 'inbox.connectionsPerTick', check: positiveInt('inbox.connectionsPerTick') },
  { path: 'inbox.batchSize', check: positiveInt('inbox.batchSize') },
  { path: 'inbox.maxAttempts', check: positiveInt('inbox.maxAttempts') },
  { path: 'inbox.backfillMonths', check: positiveInt('inbox.backfillMonths') },
  {
    path: 'inbox.pollIntervalMs',
    check: (value) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return 'inbox.pollIntervalMs must be a positive integer';
      }
      // Polling the tax service harder than this is both pointless and rude;
      // published rate limits do not exist, so the floor is ours to keep.
      if (value < 60_000) return 'inbox.pollIntervalMs must be at least 60000 (one minute)';
      return null;
    },
  },
  {
    path: 'inbox.trackedStatuses',
    check: (value) => {
      if (!Array.isArray(value) || value.length === 0) {
        return 'inbox.trackedStatuses must be a non-empty array';
      }
      const known = [0, 1, 2, 3, 5, 7, 8, 10];
      const bad = value.filter((status) => !known.includes(status as number));
      return bad.length === 0
        ? null
        : `inbox.trackedStatuses contains unknown invoice statuses: ${bad.join(', ')}`;
    },
  },

  { path: 'worker.pollIntervalMs', check: positiveInt('worker.pollIntervalMs') },
  { path: 'worker.batchSize', check: positiveInt('worker.batchSize') },
  { path: 'worker.maxAttempts', check: positiveInt('worker.maxAttempts') },
  { path: 'worker.statusPollIntervalMs', check: positiveInt('worker.statusPollIntervalMs') },
  { path: 'worker.seriesReserveCount', check: positiveInt('worker.seriesReserveCount') },
];

export function validateConfig(config: Json): string[] {
  const errors: string[] = [];

  for (const rule of RULES) {
    const value = at(config, rule.path);
    if (value === undefined) {
      errors.push(`${rule.path} is missing`);
      continue;
    }
    const message = rule.check(value, config);
    if (message) errors.push(message);
  }

  // Cross-field rules: a signing mode is only usable with its own settings.
  const mode = at(config, 'signing.mode');
  if (mode === 'pkcs12' && !at(config, 'signing.pkcs12.file')) {
    errors.push('signing.pkcs12.file is required when signing.mode is "pkcs12"');
  }
  if (mode === 'pkiserver') {
    if (!at(config, 'signing.pkiServer.url'))
      errors.push('signing.pkiServer.url is required when signing.mode is "pkiserver"');
    if (!at(config, 'signing.pkiServer.keyAlias'))
      errors.push('signing.pkiServer.keyAlias is required when signing.mode is "pkiserver"');
  }

  // Incoming invoices mean storing other companies' credentials, which is only
  // permissible sealed - so the key is required exactly when the inbox is on.
  if (at(config, 'inbox.enabled') === true) {
    const key = at(config, 'crypto.key');
    if (typeof key !== 'string' || key.trim() === '') {
      errors.push(
        'crypto.key is required when inbox.enabled is true ' +
          '(generate one with: openssl rand -base64 32)',
      );
    } else {
      const bytes = /^[0-9a-fA-F]{64}$/.test(key)
        ? key.length / 2
        : Buffer.from(key, 'base64').length;
      if (bytes !== 32) errors.push(`crypto.key must decode to 32 bytes, got ${bytes}`);
    }
  }

  if (at(config, 'erp.source') === 'views') {
    for (const view of ['documents', 'lines', 'partners']) {
      if (!at(config, `erp.views.${view}`))
        errors.push(`erp.views.${view} is required when erp.source is "views"`);
    }
  }

  return errors;
}
