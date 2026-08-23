import { BLOCK_TYPE_NAMES } from '../src/ui/blocks/blockTypes';
import { deepMerge, mergeConfigBundle } from '../src/config/merge';
import {
  collectTranslationKeys,
  validateAppConfig,
  validateConfigBundle,
  validateEntitiesConfig,
  validateNavigationConfig,
  validateThemeConfig,
} from '../src/config/validate';
import { loadBundle } from './helpers';

const blockTypes = [...BLOCK_TYPE_NAMES];

describe('bundled configuration', () => {
  const bundle = loadBundle();

  it('passes full validation', () => {
    const result = validateConfigBundle(bundle, blockTypes);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('translates every key referenced by navigation and screens', () => {
    const keys = collectTranslationKeys(bundle);
    expect(keys.length).toBeGreaterThan(10);
    for (const locale of bundle.app.app.locales) {
      const dictionary = bundle.translations[locale] ?? {};
      const missing = keys.filter((key) => dictionary[key] === undefined);
      expect({ locale, missing }).toEqual({ locale, missing: [] });
    }
  });

  it('only uses block types the app implements', () => {
    const used = new Set<string>();
    for (const screen of Object.values(bundle.screens)) {
      for (const block of screen.blocks) used.add(block.type);
    }
    for (const type of used) expect(blockTypes).toContain(type);
  });
});

describe('app config validation', () => {
  it('rejects a non-https base URL scheme and a bad currency position', () => {
    const bundle = loadBundle();
    const broken = structuredClone(bundle.app);
    broken.api.baseUrl = 'ftp://api.una.md';
    broken.app.currency.position = 'middle' as never;

    const result = validateAppConfig(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('api.baseUrl');
    expect(result.errors.join('\n')).toContain('currency.position');
  });

  it('rejects a default locale that is not offered', () => {
    const broken = structuredClone(loadBundle().app);
    broken.app.defaultLocale = 'de';
    expect(validateAppConfig(broken).errors.join()).toContain('app.defaultLocale');
  });

  it('rejects a min sync interval larger than the interval', () => {
    const broken = structuredClone(loadBundle().app);
    broken.sync.minIntervalMinutes = 120;
    expect(validateAppConfig(broken).errors.join()).toContain('minIntervalMinutes');
  });
});

describe('auth configuration', () => {
  it('requires the endpoints the configured flow needs', () => {
    const broken = structuredClone(loadBundle().app);
    delete broken.api.auth.requestCodeEndpoint;
    const errors = validateAppConfig(broken).errors.join('\n');
    expect(errors).toContain('requestCodeEndpoint');
  });

  it('rejects an unknown sign-in flow', () => {
    const broken = structuredClone(loadBundle().app);
    broken.api.auth.flow = 'magic-link' as never;
    expect(validateAppConfig(broken).errors.join()).toContain('api.auth.flow');
  });

  it('warns when no refresh endpoint is configured', () => {
    const config = structuredClone(loadBundle().app);
    delete config.api.auth.refreshEndpoint;
    expect(validateAppConfig(config).warnings.join()).toContain('refreshEndpoint');
  });

  it('checks the account section', () => {
    const broken = structuredClone(loadBundle().app);
    broken.account.receiptBarcodeFormat = 'qr' as never;
    broken.account.receiptsPageSize = 0;
    const errors = validateAppConfig(broken).errors.join('\n');
    expect(errors).toContain('receiptBarcodeFormat');
    expect(errors).toContain('receiptsPageSize');
  });
});

describe('theme validation', () => {
  it('requires the same colour keys in both schemes', () => {
    const theme = structuredClone(loadBundle().theme);
    delete (theme.dark.colors as unknown as Record<string, string>).accent;
    const result = validateThemeConfig(theme);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain('dark.colors.accent');
  });

  it('rejects malformed colours', () => {
    const theme = structuredClone(loadBundle().theme);
    theme.light.colors.primary = 'red' as never;
    expect(validateThemeConfig(theme).errors.join()).toContain('light.colors.primary');
  });
});

describe('entities validation', () => {
  it('rejects a cursor field that is not a column', () => {
    const entities = structuredClone(loadBundle().entities);
    entities.entities[0]!.cursorField = 'changed_at';
    expect(validateEntitiesConfig(entities).errors.join()).toContain('cursorField');
  });

  it('rejects reserved table names and duplicate entities', () => {
    const entities = structuredClone(loadBundle().entities);
    entities.entities[1]!.name = entities.entities[0]!.name;
    entities.entities[1]!.table = '_outbox';
    const errors = validateEntitiesConfig(entities).errors.join('\n');
    expect(errors).toContain('duplicate entity');
    expect(errors).toContain('reserved');
  });

  it('rejects a query in a screen block that references an unknown column', () => {
    const bundle = loadBundle();
    const broken = structuredClone(bundle);
    const home = broken.screens.home!;
    const deals = home.blocks.find((block) => block.id === 'home-deals')!;
    (deals.props!.source as { where: Array<{ field: string }> }).where[0]!.field = 'discount';
    const result = validateConfigBundle(broken, blockTypes);
    expect(result.errors.join()).toContain('is not a column of products');
  });
});

describe('navigation validation', () => {
  it('rejects a tab pointing at a screen that does not exist', () => {
    const bundle = loadBundle();
    const navigation = structuredClone(bundle.navigation);
    navigation.tabs[0]!.screen = 'dashboard';
    const result = validateNavigationConfig(navigation, bundle.screens, bundle.app.features);
    expect(result.errors.join()).toContain('unknown screen "dashboard"');
  });

  it('warns about a feature flag that is not declared', () => {
    const bundle = loadBundle();
    const navigation = structuredClone(bundle.navigation);
    navigation.tabs[1]!.visibleIf = { feature: 'coupons' };
    const result = validateNavigationConfig(navigation, bundle.screens, bundle.app.features);
    expect(result.warnings.join()).toContain('coupons');
  });
});

describe('remote config merging', () => {
  it('merges objects deeply and replaces arrays', () => {
    const base = { colors: { primary: '#000', text: '#111' }, tabs: ['a', 'b'] };
    const merged = deepMerge(base, { colors: { primary: '#f00' }, tabs: ['c'] });
    expect(merged).toEqual({ colors: { primary: '#f00', text: '#111' }, tabs: ['c'] });
  });

  it('lets a tenant override branding without losing the rest of the config', () => {
    const bundle = loadBundle();
    const merged = mergeConfigBundle(bundle, {
      app: { app: { name: 'Tenant Market' } as never, features: { loyalty: false } as never },
      theme: { light: { colors: { primary: '#0055AA' } } as never },
    });

    expect(merged.app.app.name).toBe('Tenant Market');
    expect(merged.app.app.currency.code).toBe(bundle.app.app.currency.code);
    expect(merged.app.features.loyalty).toBe(false);
    expect(merged.app.features.shoppingList).toBe(bundle.app.features.shoppingList);
    expect(merged.theme.light.colors.primary).toBe('#0055AA');
    expect(merged.theme.light.colors.surface).toBe(bundle.theme.light.colors.surface);
    expect(validateConfigBundle(merged, blockTypes).errors).toEqual([]);
  });

  it('keeps the bundled config when the remote payload is null', () => {
    const bundle = loadBundle();
    expect(mergeConfigBundle(bundle, null)).toBe(bundle);
  });
});
