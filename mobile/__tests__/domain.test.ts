import {
  ean13CheckDigit,
  encodeBarcode,
  encodeCode128,
  encodeEan13,
  isValidEan13,
  normalizeEan13,
} from '../src/domain/barcode';
import { isStale, shouldAutoSync } from '../src/domain/dates';
import { discountPercent, formatPrice, formatUnitPrice, unitPrice } from '../src/domain/price';
import { generateLocalId, listTotals, nextSortOrder, sortListItems } from '../src/domain/shoppingList';
import { distanceKm, isOpenAt, sortByDistance } from '../src/domain/stores';
import { createTranslator, interpolate, resolveLocale } from '../src/i18n';
import { resolveTheme } from '../src/ui/theme';
import { isVisible } from '../src/ui/visibility';
import { loadBundle } from './helpers';

const currency = { code: 'MDL', symbol: 'lei', decimals: 2, position: 'suffix' as const };

describe('price', () => {
  it('formats amounts with the configured currency', () => {
    // Prices use a no-break space before the symbol and a narrow one for grouping.
    expect(formatPrice(17.9, currency)).toBe('17,90\u00A0lei');
    expect(formatPrice(1234.5, currency)).toBe('1\u202F234,50\u00A0lei');
    expect(formatPrice(0, currency)).toBe('0,00\u00A0lei');
    expect(formatPrice(null, currency)).toBe('—');
    expect(formatPrice(9.99, { ...currency, symbol: '€', position: 'prefix' })).toBe('€\u00A09,99');
  });

  it('computes discounts and unit prices', () => {
    expect(discountPercent(17.9, 21.5)).toBe(17);
    expect(discountPercent(21.5, 21.5)).toBe(0);
    expect(discountPercent(10, null)).toBe(0);
    expect(unitPrice(34.5, 0.5)).toBe(69);
    expect(unitPrice(34.5, 0)).toBeNull();
    expect(formatUnitPrice(34.5, 0.5, 'kg', currency)).toBe('69,00\u00A0lei / kg');
    expect(formatUnitPrice(34.5, null, 'kg', currency)).toBeNull();
  });
});

describe('barcode', () => {
  it('computes EAN-13 check digits', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(ean13CheckDigit('484123450001')).toBe(2);
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('5901234123456')).toBe(false);
    expect(isValidEan13('12345')).toBe(false);
  });

  it('normalises card numbers of any length into a valid EAN-13', () => {
    expect(normalizeEan13('5901234123457')).toBe('5901234123457');
    expect(isValidEan13(normalizeEan13('590123412345'))).toBe(true);
    expect(isValidEan13(normalizeEan13('4711'))).toBe(true);
    expect(isValidEan13(normalizeEan13('4-84-1234 5000'))).toBe(true);
  });

  it('encodes EAN-13 into 95 modules with the expected guard bars', () => {
    const pattern = encodeEan13('5901234123457');
    expect(pattern.bars.reduce((sum, width) => sum + width, 0)).toBe(95);
    expect(pattern.bars.slice(0, 3)).toEqual([1, 1, 1]);
    expect(pattern.text).toBe('5901234123457');
  });

  it('encodes Code 128 with start, checksum and stop symbols', () => {
    const pattern = encodeCode128('UNA123');
    // start + 6 data + checksum + stop(7 modules): 8 symbols of 6 bars plus the 7-bar stop.
    expect(pattern.bars).toHaveLength(8 * 6 + 7);
    expect(pattern.format).toBe('code128');
    expect(() => encodeCode128('карта')).toThrow(/printable ASCII/);
  });

  it('dispatches on the configured format', () => {
    expect(encodeBarcode('4841234500017', 'ean13').format).toBe('ean13');
    expect(encodeBarcode('4841234500017', 'code128').format).toBe('code128');
  });
});

describe('shopping list', () => {
  const items = [
    { id: 'a', title: 'Lapte', product_id: 'p-1', quantity: 2, is_done: false, sort_order: 20 },
    { id: 'b', title: 'Pâine', product_id: 'p-2', quantity: 1, is_done: true, sort_order: 10 },
    { id: 'c', title: 'Notă', quantity: 3, is_done: false, sort_order: 30 },
  ];

  it('sums only the items whose price is known', () => {
    const totals = listTotals(items, (item) => (item.product_id === 'p-1' ? 17.9 : null), currency);
    expect(totals.items).toBe(3);
    expect(totals.pending).toBe(2);
    expect(totals.done).toBe(1);
    expect(totals.estimated).toBeCloseTo(35.8);
    expect(totals.estimatedText).toBe('35,80\u00A0lei');
  });

  it('moves checked items to the bottom, keeping manual order otherwise', () => {
    expect(sortListItems(items, true).map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortListItems(items, false).map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('appends new items after the last one', () => {
    expect(nextSortOrder(items)).toBe(40);
    expect(nextSortOrder([])).toBe(10);
  });

  it('generates unique offline ids', () => {
    const ids = new Set(Array.from({ length: 50 }, (_, i) => generateLocalId('sli', () => i / 50)));
    expect(ids.size).toBe(50);
    expect([...ids][0]).toMatch(/^sli_/);
  });
});

describe('stores', () => {
  const hours = {
    mon: '08:00-22:00',
    tue: '08:00-22:00',
    wed: '08:00-22:00',
    thu: '08:00-22:00',
    fri: '08:00-23:00',
    sat: '08:00-23:00',
    sun: null,
  };

  it('knows whether a store is open', () => {
    // 2026-08-24 is a Monday.
    expect(isOpenAt(hours, new Date(2026, 7, 24, 12, 0))).toEqual({ open: true, until: '22:00' });
    expect(isOpenAt(hours, new Date(2026, 7, 24, 7, 0))).toEqual({ open: false, until: '08:00' });
    expect(isOpenAt(hours, new Date(2026, 7, 24, 23, 30))).toEqual({ open: false, until: '08:00' });
  });

  it('reports the next opening on a closed day', () => {
    expect(isOpenAt(hours, new Date(2026, 7, 23, 12, 0))).toEqual({ open: false, until: '08:00' });
    expect(isOpenAt(null, new Date())).toEqual({ open: false, until: null });
  });

  it('handles a range that wraps past midnight', () => {
    const night = { ...hours, mon: '22:00-02:00' };
    expect(isOpenAt(night, new Date(2026, 7, 24, 23, 0)).open).toBe(true);
    expect(isOpenAt(night, new Date(2026, 7, 24, 1, 0)).open).toBe(true);
    expect(isOpenAt(night, new Date(2026, 7, 24, 12, 0)).open).toBe(false);
  });

  it('measures and sorts by distance, keeping unlocated stores last', () => {
    const chisinau = { latitude: 47.0245, longitude: 28.8322 };
    // Chișinău → Bălți is roughly 106 km as the crow flies.
    expect(distanceKm(chisinau, { latitude: 47.7615, longitude: 27.9286 })).toBeCloseTo(106.5, 0);
    expect(distanceKm(chisinau, { latitude: null, longitude: null })).toBeNull();

    const sorted = sortByDistance(
      [
        { id: 'far', latitude: 45.9075, longitude: 28.1944 },
        { id: 'unknown' },
        { id: 'near', latitude: 47.0246, longitude: 28.8323 },
      ],
      chisinau,
    );
    expect(sorted.map((store) => store.id)).toEqual(['near', 'far', 'unknown']);
  });
});

describe('dates', () => {
  const now = new Date('2026-08-23T12:00:00Z');

  it('detects stale data and due syncs', () => {
    expect(isStale(null, 720, now)).toBe(true);
    expect(isStale('2026-08-23T11:00:00Z', 720, now)).toBe(false);
    expect(isStale('2026-08-20T11:00:00Z', 720, now)).toBe(true);
    expect(shouldAutoSync('2026-08-23T11:00:00Z', 30, now)).toBe(true);
    expect(shouldAutoSync('2026-08-23T11:45:00Z', 30, now)).toBe(false);
    expect(shouldAutoSync('not-a-date', 30, now)).toBe(true);
  });
});

describe('i18n', () => {
  const bundle = loadBundle();

  it('interpolates parameters and leaves unknown ones alone', () => {
    expect(interpolate('{count} poziții', { count: 3 })).toBe('3 poziții');
    expect(interpolate('{missing}', {})).toBe('{missing}');
  });

  it('falls back to the default locale and then to the key itself', () => {
    const translator = createTranslator(
      { ro: { 'a.b': 'Salut', only_ro: 'Doar' }, ru: { 'a.b': 'Привет' } },
      'ru',
      'ro',
    );
    expect(translator.t('a.b')).toBe('Привет');
    expect(translator.t('only_ro')).toBe('Doar');
    expect(translator.t('nope')).toBe('nope');
  });

  it('translates the shipped dictionaries', () => {
    const translator = createTranslator(bundle.translations, 'ru', 'ro');
    expect(translator.t('tab.catalog')).toBe('Каталог');
    expect(translator.t('list.total', { total: '35,80 lei' })).toContain('35,80 lei');
  });

  it('resolves the device locale against the supported list', () => {
    expect(resolveLocale(['ru-MD', 'en'], ['ro', 'ru', 'en'], 'ro')).toBe('ru');
    expect(resolveLocale(['de-DE'], ['ro', 'ru'], 'ro')).toBe('ro');
    expect(resolveLocale(['en-GB'], ['ro', 'en'], 'ro')).toBe('en');
  });
});

describe('theme and visibility', () => {
  const bundle = loadBundle();

  it('resolves the scheme the viewer asked for', () => {
    expect(resolveTheme(bundle.theme, 'system', 'dark').colors.background).toBe(bundle.theme.dark.colors.background);
    expect(resolveTheme(bundle.theme, 'light', 'dark').mode).toBe('light');
    expect(resolveTheme(bundle.theme, 'dark', 'light').colors.primary).toBe(bundle.theme.dark.colors.primary);
  });

  it('applies feature, auth and locale gates', () => {
    const ctx = { features: { loyalty: true, cart: false }, isAuthenticated: false, locale: 'ro' };
    expect(isVisible(undefined, ctx)).toBe(true);
    expect(isVisible({ feature: 'loyalty' }, ctx)).toBe(true);
    expect(isVisible({ feature: 'cart' }, ctx)).toBe(false);
    expect(isVisible({ feature: 'unknown' }, ctx)).toBe(false);
    expect(isVisible({ auth: 'required' }, ctx)).toBe(false);
    expect(isVisible({ auth: 'anonymous' }, ctx)).toBe(true);
    expect(isVisible({ locales: ['ru'] }, ctx)).toBe(false);
  });
});
