/**
 * Validation for the JSON configuration bundle.
 *
 * Runs in three places:
 *  - `npm run validate-config` in CI, before a config is published;
 *  - on app start against the bundled config;
 *  - on every remote config download, before it replaces the cached one.
 *
 * Nothing throws: the caller decides whether errors are fatal (bundled config)
 * or a reason to keep the previous config (remote config).
 */

import type {
  AppConfig,
  BlockConfig,
  ColumnType,
  ConditionOperator,
  ConfigBundle,
  DataQuery,
  EntitiesConfig,
  EntityConfig,
  NavigationConfig,
  ScreenConfig,
  ThemeConfig,
} from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const COLUMN_TYPES: ColumnType[] = [
  'text',
  'integer',
  'real',
  'boolean',
  'json',
  'localized',
  'datetime',
];

const OPERATORS: ConditionOperator[] = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'like',
  'in',
  'is null',
  'is not null',
];

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

class Collector {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  error(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  warn(path: string, message: string): void {
    this.warnings.push(`${path}: ${message}`);
  }

  require(path: string, ok: boolean, message: string): boolean {
    if (!ok) this.error(path, message);
    return ok;
  }

  result(): ValidationResult {
    return { valid: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/* -------------------------------------------------------------- app.json */

export function validateAppConfig(input: unknown, c = new Collector()): ValidationResult {
  const path = 'app.config.json';
  if (!isObject(input)) {
    c.error(path, 'expected an object');
    return c.result();
  }
  const cfg = input as unknown as AppConfig;

  c.require(`${path}.configVersion`, typeof cfg.configVersion === 'number', 'must be a number');

  if (c.require(`${path}.app`, isObject(cfg.app), 'missing section')) {
    c.require(`${path}.app.id`, isString(cfg.app.id), 'must be a non-empty string');
    c.require(`${path}.app.name`, isString(cfg.app.name), 'must be a non-empty string');
    c.require(
      `${path}.app.locales`,
      Array.isArray(cfg.app.locales) && cfg.app.locales.length > 0,
      'must list at least one locale',
    );
    if (Array.isArray(cfg.app.locales)) {
      c.require(
        `${path}.app.defaultLocale`,
        cfg.app.locales.includes(cfg.app.defaultLocale),
        `"${cfg.app.defaultLocale}" is not present in app.locales`,
      );
    }
    if (c.require(`${path}.app.currency`, isObject(cfg.app.currency), 'missing section')) {
      c.require(`${path}.app.currency.code`, isString(cfg.app.currency.code), 'required');
      c.require(
        `${path}.app.currency.decimals`,
        Number.isInteger(cfg.app.currency.decimals) && cfg.app.currency.decimals >= 0,
        'must be a non-negative integer',
      );
      c.require(
        `${path}.app.currency.position`,
        cfg.app.currency.position === 'prefix' || cfg.app.currency.position === 'suffix',
        'must be "prefix" or "suffix"',
      );
    }
  }

  if (c.require(`${path}.api`, isObject(cfg.api), 'missing section')) {
    const validUrl = isString(cfg.api.baseUrl) && /^https?:\/\//.test(cfg.api.baseUrl);
    c.require(`${path}.api.baseUrl`, validUrl, 'must be an absolute http(s) URL');
    if (isString(cfg.api.baseUrl) && cfg.api.baseUrl.startsWith('http://')) {
      c.warn(`${path}.api.baseUrl`, 'plain http is only acceptable for local development');
    }
    c.require(`${path}.api.timeoutMs`, isPositiveNumber(cfg.api.timeoutMs), 'must be > 0');
    c.require(`${path}.api.pageSize`, isPositiveNumber(cfg.api.pageSize), 'must be > 0');
    if (c.require(`${path}.api.retry`, isObject(cfg.api.retry), 'missing section')) {
      c.require(`${path}.api.retry.attempts`, isPositiveNumber(cfg.api.retry.attempts), 'must be > 0');
      c.require(`${path}.api.retry.backoffMs`, isPositiveNumber(cfg.api.retry.backoffMs), 'must be > 0');
      c.require(`${path}.api.retry.factor`, isPositiveNumber(cfg.api.retry.factor), 'must be > 0');
    }
    if (c.require(`${path}.api.auth`, isObject(cfg.api.auth), 'missing section')) {
      const auth = cfg.api.auth;
      c.require(`${path}.api.auth.mode`, auth.mode === 'bearer' || auth.mode === 'none', 'must be "bearer" or "none"');

      if (auth.mode === 'bearer') {
        const flow = auth.flow ?? 'password';
        c.require(`${path}.api.auth.flow`, flow === 'otp' || flow === 'password', 'must be "otp" or "password"');
        c.require(`${path}.api.auth.loginEndpoint`, isString(auth.loginEndpoint), 'required to sign a user in');
        if (flow === 'otp') {
          c.require(
            `${path}.api.auth.requestCodeEndpoint`,
            isString(auth.requestCodeEndpoint),
            'the otp flow needs an endpoint that sends the code',
          );
          c.require(
            `${path}.api.auth.otpLength`,
            Number.isInteger(auth.otpLength) && (auth.otpLength ?? 0) >= 3,
            'must be an integer of at least 3',
          );
        }
        if (!auth.refreshEndpoint) {
          c.warn(`${path}.api.auth.refreshEndpoint`, 'without it an expired token signs the user out');
        }
      }
    }
  }

  if (c.require(`${path}.sync`, isObject(cfg.sync), 'missing section')) {
    c.require(
      `${path}.sync.intervalMinutes`,
      isPositiveNumber(cfg.sync.intervalMinutes),
      'must be > 0',
    );
    c.require(
      `${path}.sync.minIntervalMinutes`,
      isPositiveNumber(cfg.sync.minIntervalMinutes),
      'must be > 0',
    );
    if (isPositiveNumber(cfg.sync.intervalMinutes) && isPositiveNumber(cfg.sync.minIntervalMinutes)) {
      c.require(
        `${path}.sync.minIntervalMinutes`,
        cfg.sync.minIntervalMinutes <= cfg.sync.intervalMinutes,
        'must not exceed sync.intervalMinutes',
      );
    }
    c.require(
      `${path}.sync.maxPagesPerEntity`,
      isPositiveNumber(cfg.sync.maxPagesPerEntity),
      'must be > 0 (guards against a server that never stops paginating)',
    );
    if (c.require(`${path}.sync.outbox`, isObject(cfg.sync.outbox), 'missing section')) {
      c.require(
        `${path}.sync.outbox.maxAttempts`,
        isPositiveNumber(cfg.sync.outbox.maxAttempts),
        'must be > 0',
      );
    }
  }

  c.require(`${path}.features`, isObject(cfg.features), 'missing section');
  if (isObject(cfg.features)) {
    for (const [flag, value] of Object.entries(cfg.features)) {
      c.require(`${path}.features.${flag}`, typeof value === 'boolean', 'must be a boolean');
    }
  }

  if (isObject(cfg.account)) {
    c.require(
      `${path}.account.editableFields`,
      Array.isArray(cfg.account.editableFields),
      'must be an array of profile column names',
    );
    c.require(
      `${path}.account.receiptsPageSize`,
      isPositiveNumber(cfg.account.receiptsPageSize),
      'must be > 0',
    );
    c.require(
      `${path}.account.receiptBarcodeFormat`,
      cfg.account.receiptBarcodeFormat === 'ean13' || cfg.account.receiptBarcodeFormat === 'code128',
      'must be "ean13" or "code128"',
    );
  }

  if (isObject(cfg.loyalty)) {
    c.require(
      `${path}.loyalty.barcodeFormat`,
      cfg.loyalty.barcodeFormat === 'ean13' || cfg.loyalty.barcodeFormat === 'code128',
      'must be "ean13" or "code128"',
    );
  }

  return c.result();
}

/* ------------------------------------------------------------ theme.json */

export function validateThemeConfig(input: unknown, c = new Collector()): ValidationResult {
  const path = 'theme.config.json';
  if (!isObject(input)) {
    c.error(path, 'expected an object');
    return c.result();
  }
  const theme = input as unknown as ThemeConfig;
  const colorPattern = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  for (const scheme of ['light', 'dark'] as const) {
    const value = theme[scheme];
    if (!c.require(`${path}.${scheme}`, isObject(value) && isObject(value.colors), 'missing colors')) {
      continue;
    }
    for (const [name, color] of Object.entries(value.colors)) {
      c.require(
        `${path}.${scheme}.colors.${name}`,
        typeof color === 'string' && colorPattern.test(color),
        'must be a #RRGGBB or #RRGGBBAA colour',
      );
    }
  }

  const light = isObject(theme.light) ? Object.keys(theme.light.colors ?? {}) : [];
  const dark = isObject(theme.dark) ? Object.keys(theme.dark.colors ?? {}) : [];
  for (const key of light) {
    if (!dark.includes(key)) c.error(`${path}.dark.colors.${key}`, 'defined in light but missing in dark');
  }
  for (const key of dark) {
    if (!light.includes(key)) c.error(`${path}.light.colors.${key}`, 'defined in dark but missing in light');
  }

  for (const section of ['radius', 'spacing'] as const) {
    if (!isObject(theme[section])) c.error(`${path}.${section}`, 'missing section');
  }

  return c.result();
}

/* ------------------------------------------------------- entities.json */

export function validateEntitiesConfig(input: unknown, c = new Collector()): ValidationResult {
  const path = 'entities.config.json';
  if (!isObject(input) || !Array.isArray((input as unknown as EntitiesConfig).entities)) {
    c.error(path, 'expected an object with an "entities" array');
    return c.result();
  }
  const cfg = input as unknown as EntitiesConfig;
  c.require(`${path}.schemaVersion`, typeof cfg.schemaVersion === 'number', 'must be a number');

  const seen = new Set<string>();
  cfg.entities.forEach((entity, i) => {
    const p = `${path}.entities[${i}]`;
    if (!isObject(entity)) {
      c.error(p, 'expected an object');
      return;
    }
    if (!c.require(`${p}.name`, isString(entity.name), 'required')) return;
    if (seen.has(entity.name)) c.error(`${p}.name`, `duplicate entity "${entity.name}"`);
    seen.add(entity.name);

    c.require(
      `${p}.table`,
      isString(entity.table) && SQL_IDENTIFIER.test(entity.table),
      'must be a lower_snake_case SQL identifier',
    );
    if (isString(entity.table) && entity.table.startsWith('_')) {
      c.error(`${p}.table`, 'the "_" prefix is reserved for internal tables');
    }
    c.require(`${p}.endpoint`, isString(entity.endpoint) && entity.endpoint.startsWith('/'), 'must start with "/"');
    c.require(
      `${p}.direction`,
      ['pull', 'push', 'bidirectional'].includes(entity.direction),
      'must be pull | push | bidirectional',
    );
    c.require(`${p}.syncMode`, ['delta', 'full'].includes(entity.syncMode), 'must be delta | full');
    c.require(`${p}.order`, typeof entity.order === 'number', 'must be a number');

    if (entity.syncMode === 'delta') {
      c.require(`${p}.cursorField`, isString(entity.cursorField), 'delta sync requires a cursorField');
    }

    if (!c.require(`${p}.columns`, Array.isArray(entity.columns) && entity.columns.length > 0, 'required')) {
      return;
    }

    const columnNames = new Set<string>();
    let primaryKeys = 0;
    entity.columns.forEach((column, j) => {
      const cp = `${p}.columns[${j}]`;
      if (!isObject(column)) {
        c.error(cp, 'expected an object');
        return;
      }
      if (!c.require(`${cp}.name`, isString(column.name) && SQL_IDENTIFIER.test(column.name), 'must be a lower_snake_case SQL identifier')) {
        return;
      }
      if (columnNames.has(column.name)) c.error(`${cp}.name`, `duplicate column "${column.name}"`);
      columnNames.add(column.name);
      c.require(`${cp}.type`, COLUMN_TYPES.includes(column.type), `must be one of ${COLUMN_TYPES.join(', ')}`);
      if (column.primaryKey) primaryKeys += 1;
    });

    c.require(`${p}.primaryKey`, columnNames.has(entity.primaryKey), `"${entity.primaryKey}" is not a declared column`);
    c.require(`${p}.columns`, primaryKeys === 1, `expected exactly one primaryKey column, found ${primaryKeys}`);

    if (entity.cursorField) {
      c.require(`${p}.cursorField`, columnNames.has(entity.cursorField), `"${entity.cursorField}" is not a declared column`);
    }
    if (entity.direction !== 'pull' && !entity.conflict) {
      c.warn(`${p}.conflict`, 'writable entity without a conflict policy defaults to server_wins');
    }
    (entity.searchColumns ?? []).forEach((column, j) => {
      c.require(`${p}.searchColumns[${j}]`, columnNames.has(column), `"${column}" is not a declared column`);
    });
    (entity.indexes ?? []).forEach((index, j) => {
      const ip = `${p}.indexes[${j}]`;
      c.require(`${ip}.name`, isString(index.name) && SQL_IDENTIFIER.test(index.name), 'must be a SQL identifier');
      if (!Array.isArray(index.columns) || index.columns.length === 0) {
        c.error(`${ip}.columns`, 'must list at least one column');
        return;
      }
      index.columns.forEach((column, k) => {
        c.require(`${ip}.columns[${k}]`, columnNames.has(column), `"${column}" is not a declared column`);
      });
    });
  });

  return c.result();
}

/* --------------------------------------------------------- data queries */

export function validateDataQuery(
  query: unknown,
  entities: EntityConfig[],
  path: string,
  c: Collector,
): void {
  if (!isObject(query)) {
    c.error(path, 'expected a query object');
    return;
  }
  const q = query as unknown as DataQuery;
  const entity = entities.find((e) => e.name === q.entity);
  if (!entity) {
    c.error(`${path}.entity`, `unknown entity "${String(q.entity)}"`);
    return;
  }
  const columns = new Set(entity.columns.map((column) => column.name));

  (q.select ?? []).forEach((field, i) => {
    c.require(`${path}.select[${i}]`, columns.has(field), `"${field}" is not a column of ${entity.name}`);
  });

  (q.where ?? []).forEach((condition, i) => {
    const p = `${path}.where[${i}]`;
    if (!isObject(condition)) {
      c.error(p, 'expected an object');
      return;
    }
    c.require(`${p}.field`, columns.has(condition.field), `"${condition.field}" is not a column of ${entity.name}`);
    c.require(`${p}.op`, OPERATORS.includes(condition.op), `must be one of ${OPERATORS.join(' | ')}`);
    const needsValue = condition.op !== 'is null' && condition.op !== 'is not null';
    if (needsValue && condition.value === undefined) {
      c.error(`${p}.value`, `operator "${condition.op}" requires a value`);
    }
    if (condition.op === 'in' && condition.value !== undefined && !Array.isArray(condition.value)) {
      c.error(`${p}.value`, 'operator "in" requires an array value');
    }
  });

  (q.orderBy ?? []).forEach((order, i) => {
    const p = `${path}.orderBy[${i}]`;
    c.require(`${p}.field`, columns.has(order.field), `"${order.field}" is not a column of ${entity.name}`);
    c.require(`${p}.dir`, order.dir === 'asc' || order.dir === 'desc', 'must be "asc" or "desc"');
  });

  if (q.limit !== undefined) {
    c.require(`${path}.limit`, Number.isInteger(q.limit) && q.limit > 0, 'must be a positive integer');
  }
  if (q.search !== undefined && (entity.searchColumns ?? []).length === 0) {
    c.error(`${path}.search`, `entity "${entity.name}" declares no searchColumns`);
  }
}

/* -------------------------------------------------------------- screens */

function validateBlock(
  block: BlockConfig,
  path: string,
  entities: EntityConfig[],
  knownBlockTypes: string[] | undefined,
  c: Collector,
): void {
  if (!isObject(block)) {
    c.error(path, 'expected an object');
    return;
  }
  c.require(`${path}.id`, isString(block.id), 'required');
  if (!c.require(`${path}.type`, isString(block.type), 'required')) return;
  if (knownBlockTypes && !knownBlockTypes.includes(block.type)) {
    c.error(`${path}.type`, `unknown block type "${block.type}" (known: ${knownBlockTypes.join(', ')})`);
  }

  const props = isObject(block.props) ? block.props : {};
  for (const key of ['source', 'suggestions']) {
    if (props[key] !== undefined) {
      validateDataQuery(props[key], entities, `${path}.props.${key}`, c);
    }
  }
}

export function validateScreenConfig(
  input: unknown,
  entities: EntityConfig[],
  knownBlockTypes?: string[],
  c = new Collector(),
): ValidationResult {
  if (!isObject(input)) {
    c.error('screen', 'expected an object');
    return c.result();
  }
  const screen = input as unknown as ScreenConfig;
  const path = `screens/${screen.id ?? '?'}.json`;
  c.require(`${path}.id`, isString(screen.id), 'required');
  if (!c.require(`${path}.blocks`, Array.isArray(screen.blocks), 'must be an array')) return c.result();

  const ids = new Set<string>();
  screen.blocks.forEach((block, i) => {
    if (isObject(block) && isString(block.id)) {
      if (ids.has(block.id)) c.error(`${path}.blocks[${i}].id`, `duplicate block id "${block.id}"`);
      ids.add(block.id);
    }
    validateBlock(block, `${path}.blocks[${i}]`, entities, knownBlockTypes, c);
  });

  return c.result();
}

/* ----------------------------------------------------------- navigation */

export function validateNavigationConfig(
  input: unknown,
  screens: Record<string, ScreenConfig>,
  features: Record<string, boolean>,
  c = new Collector(),
): ValidationResult {
  const path = 'navigation.config.json';
  if (!isObject(input)) {
    c.error(path, 'expected an object');
    return c.result();
  }
  const nav = input as unknown as NavigationConfig;
  c.require(`${path}.type`, nav.type === 'tabs', 'only "tabs" navigation is supported');
  if (!c.require(`${path}.tabs`, Array.isArray(nav.tabs) && nav.tabs.length > 0, 'at least one tab is required')) {
    return c.result();
  }

  const ids = new Set<string>();
  nav.tabs.forEach((tab, i) => {
    const p = `${path}.tabs[${i}]`;
    if (!isObject(tab)) {
      c.error(p, 'expected an object');
      return;
    }
    if (isString(tab.id)) {
      if (ids.has(tab.id)) c.error(`${p}.id`, `duplicate tab id "${tab.id}"`);
      ids.add(tab.id);
    } else {
      c.error(`${p}.id`, 'required');
    }
    c.require(`${p}.screen`, isString(tab.screen) && screens[tab.screen] !== undefined, `unknown screen "${String(tab.screen)}"`);
    c.require(`${p}.titleKey`, isString(tab.titleKey), 'required');
    if (tab.visibleIf?.feature && features[tab.visibleIf.feature] === undefined) {
      c.warn(`${p}.visibleIf.feature`, `feature flag "${tab.visibleIf.feature}" is not declared in app.config.json`);
    }
  });

  c.require(`${path}.initialTab`, ids.has(nav.initialTab), `"${nav.initialTab}" is not one of the declared tabs`);

  // A tab whose only gate is a permanently disabled feature would leave a dead entry.
  const reachable = nav.tabs.filter((tab) => !tab.visibleIf?.feature || features[tab.visibleIf.feature]);
  if (reachable.length === 0) c.error(`${path}.tabs`, 'every tab is hidden by feature flags');

  return c.result();
}

/* ---------------------------------------------------------- translations */

export function validateTranslations(
  translations: Record<string, Record<string, string>>,
  locales: string[],
  defaultLocale: string,
  usedKeys: string[],
  c = new Collector(),
): ValidationResult {
  const path = 'l10n';
  const base = translations[defaultLocale];
  if (!base) {
    c.error(`${path}/${defaultLocale}.json`, 'translations for the default locale are missing');
    return c.result();
  }

  for (const locale of locales) {
    const dictionary = translations[locale];
    if (!dictionary) {
      c.error(`${path}/${locale}.json`, 'declared in app.locales but not bundled');
      continue;
    }
    for (const key of Object.keys(base)) {
      if (dictionary[key] === undefined) c.error(`${path}/${locale}.json`, `missing key "${key}"`);
    }
    for (const key of Object.keys(dictionary)) {
      if (base[key] === undefined) c.warn(`${path}/${locale}.json`, `key "${key}" is absent from ${defaultLocale}`);
    }
  }

  for (const key of usedKeys) {
    if (base[key] === undefined) c.error(`${path}/${defaultLocale}.json`, `key "${key}" is referenced by a config but not translated`);
  }

  return c.result();
}

/* ------------------------------------------------------- whole bundle */

/** Collects every translation key referenced from navigation and screen configs. */
export function collectTranslationKeys(bundle: Pick<ConfigBundle, 'navigation' | 'screens' | 'app'>): string[] {
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Key') && typeof child === 'string') keys.add(child);
      else visit(child);
    }
  };
  visit(bundle.navigation);
  visit(bundle.screens);
  if (bundle.app?.loyalty?.cardTitleKey) keys.add(bundle.app.loyalty.cardTitleKey);
  return [...keys].sort();
}

export function validateConfigBundle(bundle: ConfigBundle, knownBlockTypes?: string[]): ValidationResult {
  const c = new Collector();
  validateAppConfig(bundle.app, c);
  validateThemeConfig(bundle.theme, c);
  validateEntitiesConfig(bundle.entities, c);

  const entities = Array.isArray(bundle.entities?.entities) ? bundle.entities.entities : [];
  for (const screen of Object.values(bundle.screens ?? {})) {
    validateScreenConfig(screen, entities, knownBlockTypes, c);
  }
  validateNavigationConfig(bundle.navigation, bundle.screens ?? {}, bundle.app?.features ?? {}, c);
  validateTranslations(
    bundle.translations ?? {},
    bundle.app?.app?.locales ?? [],
    bundle.app?.app?.defaultLocale ?? 'ro',
    collectTranslationKeys(bundle),
    c,
  );
  return c.result();
}
