/**
 * Corporate option: company validation, invoice status mapping and the shape of
 * the configuration that switches the whole thing on.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  canRequestInvoice,
  withinRequestWindow,
  EFACTURA_STATUS,
  invoiceBadge,
  invoiceLabel,
  invoiceView,
  isValidIdno,
  isValidMdIban,
  isValidVatCode,
  isVatRegistered,
  normaliseFiscalCode,
  normaliseIban,
  validateCompany,
  type CompanyRecord,
  type FiscalInvoiceRecord,
} from '../src/domain/company';
import { BLOCK_TYPE_NAMES } from '../src/ui/blocks/blockTypes';

const configDir = join(__dirname, '..', 'config');
const readJson = (path: string): any => JSON.parse(readFileSync(join(configDir, path), 'utf8'));

function company(overrides: Partial<CompanyRecord> = {}): Partial<CompanyRecord> {
  return {
    id: 'cmp-1',
    idno: '1000000000015',
    name: 'ALFA DEMO SRL',
    vat_code: '0305678',
    legal_address: 'mun. Chisinau, bd. Dacia 47/2',
    ...overrides,
  };
}

describe('fiscal identifiers', () => {
  it('accepts a 13-digit IDNO and rejects anything else', () => {
    expect(isValidIdno('1000000000015')).toBe(true);
    expect(isValidIdno('100260000381')).toBe(false);
    expect(isValidIdno('10000000000150')).toBe(false);
    expect(isValidIdno('100260000381X')).toBe(false);
    expect(isValidIdno('')).toBe(false);
  });

  it('ignores spaces and dashes people paste from documents', () => {
    expect(normaliseFiscalCode('1000-0000-00015')).toBe('1000000000015');
    expect(isValidIdno('1000 0000 00015')).toBe(true);
  });

  it('checks the VAT code length', () => {
    expect(isValidVatCode('0305678')).toBe(true);
    expect(isValidVatCode('12345')).toBe(false);
    expect(isValidVatCode('123456789')).toBe(false);
  });

  it('checks a Moldovan IBAN', () => {
    expect(isValidMdIban('MD24AG000225100013104168')).toBe(true);
    expect(isValidMdIban('md24ag000225100013104168')).toBe(true);
    expect(isValidMdIban('MD24AG00022510001310416')).toBe(false);
    expect(isValidMdIban('RO24AG000225100013104168')).toBe(false);
    expect(normaliseIban('MD24 AG00 0225 1000 1310 4168')).toBe('MD24AG000225100013104168');
  });
});

describe('company validation', () => {
  it('passes a complete company', () => {
    expect(validateCompany(company())).toEqual({});
  });

  it('requires IDNO, name and registered address', () => {
    const errors = validateCompany({ id: 'cmp-1' });
    expect(errors['idno']).toBe('corporate.error_idno');
    expect(errors['name']).toBe('corporate.error_name');
    expect(errors['legal_address']).toBe('corporate.error_address');
  });

  it('treats VAT registration as optional but validates it when present', () => {
    expect(validateCompany(company({ vat_code: null }))).toEqual({});
    expect(validateCompany(company({ vat_code: '12' }))['vat_code']).toBe('corporate.error_vat');
  });

  it('validates the IBAN and the contact email only when filled in', () => {
    expect(validateCompany(company({ bank_account: 'nonsense' }))['bank_account']).toBe(
      'corporate.error_iban',
    );
    expect(validateCompany(company({ contact_email: 'not-an-email' }))['contact_email']).toBe(
      'corporate.error_email',
    );
    expect(validateCompany(company({ bank_account: null, contact_email: null }))).toEqual({});
  });

  it('reports VAT registration from the code', () => {
    expect(isVatRegistered({ vat_code: '0305678' })).toBe(true);
    expect(isVatRegistered({ vat_code: null })).toBe(false);
    expect(isVatRegistered({ vat_code: 'x' })).toBe(false);
  });

  it('every error key it can produce exists in all locales', () => {
    const keys = new Set(
      Object.values({
        ...validateCompany({ id: 'x' }),
        ...validateCompany(company({ vat_code: '1', bank_account: 'x', contact_email: 'y' })),
      }),
    );
    expect(keys.size).toBeGreaterThan(0);

    for (const locale of ['ro', 'ru', 'en']) {
      const translations = readJson(`l10n/${locale}.json`);
      for (const key of keys) expect(translations[key]).toBeTruthy();
    }
  });
});

describe('invoice status', () => {
  const invoice = (overrides: Partial<FiscalInvoiceRecord> = {}): FiscalInvoiceRecord => ({
    id: 'inv-1',
    ...overrides,
  });

  it('maps the e-Factura codes to what the customer is shown', () => {
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.draft }))).toBe('requested');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.signedBySupplier }))).toBe('issued');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.sentToBuyer }))).toBe('issued');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.acceptedByBuyer }))).toBe('signed');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.signedByBuyer }))).toBe('signed');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.delivered }))).toBe('delivered');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.rejectedByBuyer }))).toBe('rejected');
    expect(invoiceView(invoice({ efactura_status: EFACTURA_STATUS.canceledBySupplier }))).toBe('rejected');
  });

  it('falls back to the service state while e-Factura has no status yet', () => {
    expect(invoiceView(invoice({ state: 'pending' }))).toBe('requested');
    expect(invoiceView(invoice({ state: 'posted' }))).toBe('requested');
    expect(invoiceView(invoice({ state: 'confirmed' }))).toBe('issued');
    expect(invoiceView(invoice({ state: 'failed' }))).toBe('failed');
  });

  it('a failed document stays failed whatever the last known status was', () => {
    expect(invoiceView(invoice({ state: 'failed', efactura_status: EFACTURA_STATUS.acceptedByBuyer }))).toBe(
      'failed',
    );
  });

  it('gives every view a translated badge with a sensible tone', () => {
    const cases: Array<[Partial<FiscalInvoiceRecord>, string]> = [
      [{ efactura_status: EFACTURA_STATUS.acceptedByBuyer }, 'positive'],
      [{ efactura_status: EFACTURA_STATUS.delivered }, 'positive'],
      [{ efactura_status: EFACTURA_STATUS.rejectedByBuyer }, 'danger'],
      [{ state: 'failed' }, 'danger'],
      [{ efactura_status: EFACTURA_STATUS.sentToBuyer }, 'neutral'],
      [{ state: 'pending' }, 'warning'],
    ];

    const translations = readJson('l10n/ro.json');
    for (const [overrides, tone] of cases) {
      const badge = invoiceBadge(invoice(overrides));
      expect(badge.tone).toBe(tone);
      expect(translations[badge.labelKey]).toBeTruthy();
    }
  });

  it('shows the series and number, or a dash before one is assigned', () => {
    expect(invoiceLabel(invoice({ seria: 'EAA', number: '000005948' }))).toBe('EAA 000005948');
    expect(invoiceLabel(invoice({ seria: null, number: null }))).toBe('—');
    expect(invoiceLabel(invoice({ seria: 'EAA', number: null }))).toBe('—');
  });

  it('allows one request per receipt, and again after a failure', () => {
    expect(canRequestInvoice('rcp-1', [])).toBe(true);
    expect(canRequestInvoice('rcp-1', [invoice({ receipt_id: 'rcp-1', state: 'pending' })])).toBe(false);
    expect(canRequestInvoice('rcp-1', [invoice({ receipt_id: 'rcp-2', state: 'pending' })])).toBe(true);
    // A failed attempt must not lock the customer out of their invoice.
    expect(canRequestInvoice('rcp-1', [invoice({ receipt_id: 'rcp-1', state: 'failed' })])).toBe(true);
  });
});

describe('configuration', () => {
  it('exposes the corporate feature flags', () => {
    const app = readJson('app.config.json');
    expect(app.features.corporate).toBe(true);
    expect(app.features.eFactura).toBe(true);
    expect(app.corporate.enabled).toBe(true);
    expect(app.corporate.companyEndpoint).toBe('/account/company');
    expect(app.corporate.invoicesEndpoint).toBe('/account/invoices');
    expect(app.corporate.efactura.portalUrl).toContain('efactura');
  });

  it('declares the company and fiscal_invoices entities', () => {
    const entities = readJson('entities.config.json').entities as Array<Record<string, any>>;
    const byName = Object.fromEntries(entities.map((entity) => [entity.name, entity]));

    expect(byName['company']).toBeDefined();
    expect(byName['company'].direction).toBe('bidirectional');
    expect(byName['company'].requiresAuth).toBe(true);

    const invoices = byName['fiscal_invoices'];
    expect(invoices).toBeDefined();
    expect(invoices.cursorField).toBe('updated_at');
    const columns = invoices.columns.map((column: Record<string, unknown>) => column['name']);
    // The screen reads all of these; losing one would break it silently.
    for (const column of ['receipt_id', 'seria', 'number', 'state', 'efactura_status', 'qr_text', 'pdf_url']) {
      expect(columns).toContain(column);
    }
  });

  it('registers the corporate screen and its blocks', () => {
    const screen = readJson('screens/corporate.json');
    expect(screen.id).toBe('corporate');

    const types = screen.blocks.map((block: Record<string, unknown>) => block['type']);
    expect(types).toContain('company_card');
    expect(types).toContain('fiscal_invoice_list');
    for (const type of types) expect(BLOCK_TYPE_NAMES).toContain(type);
  });

  it('reaches the corporate screen from the profile menu, for signed-in users only', () => {
    const profile = readJson('screens/profile.json');
    const menu = profile.blocks.find((block: any) => block.type === 'menu_list');
    const item = menu.props.items.find((entry: any) => entry.id === 'corporate');

    expect(item).toBeDefined();
    expect(item.action).toEqual({ type: 'navigate', screen: 'corporate' });
    expect(item.visibleIf).toEqual({ feature: 'corporate', auth: 'required' });
  });

  it('the corporate screen title is translated everywhere', () => {
    for (const locale of ['ro', 'ru', 'en']) {
      const translations = readJson(`l10n/${locale}.json`);
      expect(translations['screen.corporate']).toBeTruthy();
      expect(translations['menu.corporate']).toBeTruthy();
      expect(translations['corporate.request_invoice']).toBeTruthy();
    }
  });
});

describe('requesting an invoice from a receipt', () => {
  it('closes after the configured number of days', () => {
    const now = new Date('2026-08-25T10:00:00Z');
    expect(withinRequestWindow('2026-08-22T18:42:00Z', 30, now)).toBe(true);
    expect(withinRequestWindow('2026-07-21T12:09:00Z', 30, now)).toBe(false);
    expect(withinRequestWindow('2026-07-21T12:09:00Z', 0, now)).toBe(true);
    expect(withinRequestWindow(null, 30, now)).toBe(false);
  });
});

describe('navigation', () => {
  it('has a route for every screen the configuration navigates to', () => {
    const root = join(__dirname, '..');
    const navigator = readFileSync(join(root, 'src', 'ui', 'navigation', 'RootNavigator.tsx'), 'utf8');
    const routes = new Set([...navigator.matchAll(/<Stack\.Screen\s+name="(\w+)"/g)].map((match) => match[1]));
    const tabs = JSON.parse(readFileSync(join(root, 'config', 'navigation.config.json'), 'utf8')) as {
      tabs: Array<{ id: string }>;
    };
    tabs.tabs.forEach((tab) => routes.add(tab.id));

    const missing: string[] = [];
    const walk = (value: unknown, file: string): void => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, file));
      else if (value && typeof value === 'object') {
        const action = value as { type?: unknown; screen?: unknown };
        if (action.type === 'navigate' && typeof action.screen === 'string' && !routes.has(action.screen)) {
          missing.push(`${file}: ${action.screen}`);
        }
        Object.values(value).forEach((item) => walk(item, file));
      }
    };
    const dir = join(root, 'config', 'screens');
    for (const file of readdirSync(dir)) walk(JSON.parse(readFileSync(join(dir, file), 'utf8')), file);
    expect(missing).toEqual([]);
  });
});
