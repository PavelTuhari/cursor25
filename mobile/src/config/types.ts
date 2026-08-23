/**
 * Type definitions for every JSON configuration file the app is driven by.
 *
 * The app ships bundled defaults in `config/`, and the same shapes can be
 * delivered at runtime by the UNA.md backend (`GET /app-config`), so a tenant
 * can rebrand, re-order screens or switch features on without a new release.
 */

export type Locale = string;

/** A value that is translated on the server: `{"ro": "Lapte", "ru": "Молоко"}`. */
export type LocalizedText = Record<Locale, string>;

export interface CurrencyConfig {
  code: string;
  symbol: string;
  decimals: number;
  position: 'prefix' | 'suffix';
}

export interface AppIdentityConfig {
  id: string;
  name: string;
  tenantId: string;
  defaultLocale: Locale;
  locales: Locale[];
  currency: CurrencyConfig;
  supportPhone?: string;
  supportEmail?: string;
}

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
  factor: number;
  maxBackoffMs?: number;
}

export interface ApiAuthConfig {
  mode: 'bearer' | 'none';
  loginEndpoint?: string;
  refreshEndpoint?: string;
  anonymousAllowed: boolean;
}

export interface ApiConfig {
  baseUrl: string;
  timeoutMs: number;
  pageSize: number;
  retry: RetryConfig;
  auth: ApiAuthConfig;
  headers?: Record<string, string>;
}

export interface OutboxConfig {
  maxAttempts: number;
  backoffMs: number;
  factor: number;
  maxBackoffMs?: number;
}

export interface SyncConfig {
  syncOnStart: boolean;
  intervalMinutes: number;
  minIntervalMinutes: number;
  staleAfterMinutes: number;
  outbox: OutboxConfig;
  maxPagesPerEntity: number;
}

export interface RemoteConfigConfig {
  enabled: boolean;
  endpoint: string;
  cacheTtlMinutes: number;
  /** When true a failing remote config never blocks start-up: bundled config is used. */
  failOpen: boolean;
}

export type FeatureFlags = Record<string, boolean>;

export interface LoyaltyConfig {
  barcodeFormat: 'ean13' | 'code128';
  cardTitleKey: string;
  showPoints: boolean;
  showTierProgress: boolean;
}

export interface CatalogConfig {
  productCard: {
    showUnitPrice: boolean;
    showDiscountBadge: boolean;
    showStockStatus: boolean;
    showFavoriteButton: boolean;
  };
  gridColumns: number;
  pageSize: number;
}

export interface SearchConfig {
  minChars: number;
  historySize: number;
  debounceMs: number;
}

export interface AppConfig {
  configVersion: number;
  app: AppIdentityConfig;
  api: ApiConfig;
  sync: SyncConfig;
  remoteConfig: RemoteConfigConfig;
  features: FeatureFlags;
  loyalty: LoyaltyConfig;
  catalog: CatalogConfig;
  search: SearchConfig;
}

/* ------------------------------------------------------------------ theme */

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primaryMuted: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  price: string;
  priceOld: string;
  badge: string;
  onBadge: string;
}

export interface ThemeScheme {
  colors: ThemeColors;
}

export interface ThemeConfig {
  light: ThemeScheme;
  dark: ThemeScheme;
  typography: {
    fontFamily: string | null;
    sizes: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl', number>;
    weights: Record<'regular' | 'medium' | 'bold', string>;
  };
  radius: Record<'sm' | 'md' | 'lg' | 'pill', number>;
  spacing: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl', number>;
  images: { placeholder: string };
}

/* ------------------------------------------------------------- navigation */

export interface VisibilityRule {
  /** Feature flag that must be enabled. */
  feature?: string;
  /** `required` hides the element for anonymous users, `anonymous` for signed-in ones. */
  auth?: 'required' | 'anonymous';
  /** Locale whitelist. */
  locales?: Locale[];
}

export interface TabConfig {
  id: string;
  screen: string;
  icon: string;
  titleKey: string;
  visibleIf?: VisibilityRule;
  /** Name of a counter exposed by the app state, rendered as a tab badge. */
  badge?: string;
}

export interface NavigationConfig {
  type: 'tabs';
  initialTab: string;
  tabs: TabConfig[];
  modals: string[];
}

/* ------------------------------------------------------- data query model */

export type ConditionOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'in'
  | 'is null'
  | 'is not null';

export type QueryValue = string | number | boolean | null | Array<string | number>;

export interface QueryCondition {
  field: string;
  op: ConditionOperator;
  /** Literal, or a context placeholder: `$now`, `$today`, `$locale`, `$storeId`, `$userId`, `$param.<name>`. */
  value?: QueryValue;
  /** When true the row also matches if the column is NULL (open-ended promo periods). */
  orNull?: boolean;
}

export interface QueryOrder {
  field: string;
  dir: 'asc' | 'desc';
}

export interface DataQuery {
  entity: string;
  select?: string[];
  where?: QueryCondition[];
  orderBy?: QueryOrder[];
  limit?: number;
  offset?: number;
  /** Free-text search applied to the entity's `searchColumns`. */
  search?: string;
}

/* ------------------------------------------------------------ screen/UI */

export type ActionConfig =
  | { type: 'navigate'; screen: string; params?: Record<string, unknown> }
  | { type: 'url'; url: string }
  | { type: 'addToList'; productId?: string }
  | { type: 'sync' }
  | { type: 'none' };

export interface BlockConfig {
  id: string;
  type: string;
  titleKey?: string;
  title?: LocalizedText;
  visibleIf?: VisibilityRule;
  props?: Record<string, unknown>;
}

export interface ScreenConfig {
  id: string;
  titleKey?: string;
  refreshable?: boolean;
  blocks: BlockConfig[];
}

/* ------------------------------------------------- entities / db / sync */

export type ColumnType =
  | 'text'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'json'
  | 'localized'
  | 'datetime';

export interface ColumnConfig {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;
  index?: boolean;
  notNull?: boolean;
  default?: string | number | boolean | null;
}

export interface IndexConfig {
  name: string;
  columns: string[];
  unique?: boolean;
}

export type SyncDirection = 'pull' | 'push' | 'bidirectional';
export type SyncMode = 'delta' | 'full';
export type ConflictPolicy = 'server_wins' | 'client_wins' | 'last_write_wins';

export interface EntityConfig {
  name: string;
  table: string;
  endpoint: string;
  direction: SyncDirection;
  syncMode: SyncMode;
  primaryKey: string;
  cursorField?: string;
  conflict?: ConflictPolicy;
  pushMode?: 'rest' | 'batch';
  requiresAuth?: boolean;
  /** Lower numbers sync first (parents before children). */
  order: number;
  columns: ColumnConfig[];
  indexes?: IndexConfig[];
  searchColumns?: string[];
}

export interface EntitiesConfig {
  schemaVersion: number;
  entities: EntityConfig[];
}

/* ----------------------------------------------------------- root bundle */

export interface Translations {
  [key: string]: string;
}

export interface ConfigBundle {
  app: AppConfig;
  theme: ThemeConfig;
  navigation: NavigationConfig;
  entities: EntitiesConfig;
  screens: Record<string, ScreenConfig>;
  translations: Record<Locale, Translations>;
}

/** Shape returned by `GET /app-config`; every section is optional (partial override). */
export interface RemoteConfigPayload {
  configVersion?: number;
  app?: Partial<AppConfig>;
  theme?: Partial<ThemeConfig>;
  navigation?: NavigationConfig;
  entities?: EntitiesConfig;
  screens?: Record<string, ScreenConfig>;
  translations?: Record<Locale, Translations>;
}
