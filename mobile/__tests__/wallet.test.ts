/**
 * The wallet: incoming invoices, connected companies and the buyer's decision.
 *
 * The rules here decide what a buyer is allowed to do with somebody else's
 * document, so most of these tests are about when an action must *not* be
 * offered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EFACTURA_STATUS } from '../src/domain/company';
import {
  canDecide,
  connectionBadge,
  groupBySupplier,
  incomingBadge,
  incomingView,
  isIncoming,
  isPaid,
  needsAttention,
  outstanding,
  summarise,
  validateConnection,
  type ConnectionRecord,
  type WalletInvoice,
} from '../src/domain/wallet';
import { BLOCK_TYPE_NAMES } from '../src/ui/blocks/blockTypes';

const configDir = join(__dirname, '..', 'config');
const readJson = (path: string): any => JSON.parse(readFileSync(join(configDir, path), 'utf8'));

function incoming(overrides: Partial<WalletInvoice> = {}): WalletInvoice {
  return {
    id: 'inv-1',
    direction: 'in',
    supplier_idno: '1000000000024',
    supplier_name: 'BETA DEMO SRL',
    buyer_idno: '1000000000015',
    efactura_status: EFACTURA_STATUS.sentToBuyer,
    decision: 'none',
    total: 1200,
    source: 'sfs',
    ...overrides,
  };
}

describe('incoming invoice status', () => {
  it('collapses the tax service codes into what a buyer needs to know', () => {
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.sentToBuyer }))).toBe('awaiting');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.draft }))).toBe('awaiting');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.acceptedByBuyer }))).toBe('accepted');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.signedByBuyer }))).toBe('accepted');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.delivered }))).toBe('accepted');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.rejectedByBuyer }))).toBe('rejected');
    expect(incomingView(incoming({ efactura_status: EFACTURA_STATUS.canceledBySupplier }))).toBe('canceled');
  });

  it('shows a decision in flight rather than the stale server status', () => {
    // Without this the row would snap back to "awaiting" right after the tap,
    // until the next sync - which reads as the button having done nothing.
    expect(incomingView(incoming({ decision: 'accepting' }))).toBe('sending');
    expect(incomingView(incoming({ decision: 'rejecting' }))).toBe('sending');
    expect(incomingView(incoming({ decision: 'failed' }))).toBe('failed');
  });

  it('gives every state a translated badge', () => {
    const translations = readJson('l10n/ro.json');
    const cases: Array<Partial<WalletInvoice>> = [
      { efactura_status: EFACTURA_STATUS.sentToBuyer },
      { efactura_status: EFACTURA_STATUS.acceptedByBuyer },
      { efactura_status: EFACTURA_STATUS.rejectedByBuyer },
      { efactura_status: EFACTURA_STATUS.canceledBySupplier },
      { decision: 'accepting' },
      { decision: 'failed' },
    ];

    for (const overrides of cases) {
      const badge = incomingBadge(incoming(overrides));
      expect(translations[badge.labelKey]).toBeTruthy();
    }
  });
});

describe('what the buyer may decide', () => {
  it('allows a decision only on a document sent to them', () => {
    expect(canDecide(incoming({ efactura_status: EFACTURA_STATUS.sentToBuyer }))).toBe(true);
    expect(canDecide(incoming({ efactura_status: EFACTURA_STATUS.signedBySupplier }))).toBe(true);
    expect(canDecide(incoming({ efactura_status: EFACTURA_STATUS.draft }))).toBe(false);
    expect(canDecide(incoming({ efactura_status: EFACTURA_STATUS.acceptedByBuyer }))).toBe(false);
  });

  it('does not offer a second decision on the same document', () => {
    // In the tax service this is a legally meaningful act, not a toggle.
    expect(canDecide(incoming({ decision: 'accepting' }))).toBe(false);
    expect(canDecide(incoming({ decision: 'accepted' }))).toBe(false);
    expect(canDecide(incoming({ decision: 'rejected' }))).toBe(false);
  });

  it('lets a failed attempt be retried', () => {
    expect(canDecide(incoming({ decision: 'failed' }))).toBe(true);
  });

  it('never offers a decision on an invoice the user issued themselves', () => {
    expect(canDecide(incoming({ direction: 'out' }))).toBe(false);
    expect(isIncoming(incoming({ direction: 'out' }))).toBe(false);
  });
});

describe('connections', () => {
  const connection = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
    id: 'con-1',
    idno: '1000000000015',
    state: 'active',
    ...overrides,
  });

  it('marks a rejected credential as needing the owner', () => {
    expect(needsAttention(connection({ state: 'invalid' }))).toBe(true);
    // An outage leaves the connection active, so it must not look broken.
    expect(needsAttention(connection({ state: 'active' }))).toBe(false);
    expect(needsAttention(connection({ state: 'pending' }))).toBe(false);
  });

  it('gives every connection state a translated badge', () => {
    const translations = readJson('l10n/ru.json');
    for (const state of ['pending', 'active', 'invalid', 'revoked'] as const) {
      const badge = connectionBadge(connection({ state }));
      expect(translations[badge.labelKey]).toBeTruthy();
    }
  });

  it('requires IDNO, credentials and consent', () => {
    expect(validateConnection({})).toEqual({
      idno: 'corporate.error_idno',
      sfsUsername: 'wallet.error_username',
      sfsPassword: 'wallet.error_password',
      consentAccepted: 'wallet.error_consent',
    });

    expect(
      validateConnection({
        idno: '1000000000015',
        sfsUsername: 'buyer',
        sfsPassword: 'x',
        consentAccepted: true,
      }),
    ).toEqual({});
  });

  it('treats missing consent as an error, not a disabled button', () => {
    const errors = validateConnection({
      idno: '1000000000015',
      sfsUsername: 'buyer',
      sfsPassword: 'x',
      consentAccepted: false,
    });
    // The reason has to be visible; a greyed-out button explains nothing.
    expect(errors['consentAccepted']).toBe('wallet.error_consent');
  });

  it('every validation key exists in all locales', () => {
    const keys = new Set(Object.values(validateConnection({})));
    for (const locale of ['ro', 'ru', 'en']) {
      const translations = readJson(`l10n/${locale}.json`);
      for (const key of keys) expect(translations[key]).toBeTruthy();
    }
  });
});

describe('totals', () => {
  it('summarises only the incoming side', () => {
    const summary = summarise([
      incoming({ id: 'a', total: 100 }),
      incoming({ id: 'b', total: 200, efactura_status: EFACTURA_STATUS.acceptedByBuyer }),
      incoming({ id: 'c', total: 999, direction: 'out' }),
    ]);

    expect(summary.documents).toBe(2);
    expect(summary.awaiting).toBe(1);
    expect(summary.total).toBe(300);
  });

  it('counts a partially paid document by what is still owed', () => {
    const summary = summarise([incoming({ total: 100, paid_amount: 40 })]);
    expect(summary.unpaid).toBe(60);
    expect(outstanding(incoming({ total: 100, paid_amount: 40 }))).toBe(60);
    expect(isPaid(incoming({ total: 100, paid_amount: 40 }))).toBe(false);
    expect(isPaid(incoming({ total: 100, paid_amount: 100 }))).toBe(true);
  });

  it('does not count a rejected or withdrawn document as money owed', () => {
    const rejected = summarise([
      incoming({ id: 'a', total: 100 }),
      incoming({ id: 'b', total: 4820, efactura_status: EFACTURA_STATUS.rejectedByBuyer }),
      incoming({ id: 'c', total: 900, efactura_status: EFACTURA_STATUS.canceledBySupplier }),
    ]);

    // All three are still documents the company holds...
    expect(rejected.documents).toBe(3);
    // ...but only the live one is a liability.
    expect(rejected.unpaid).toBe(100);
  });

  it('never reports a negative outstanding amount', () => {
    // An overpayment is a matter for the accountant, not a negative badge.
    expect(outstanding(incoming({ total: 100, paid_amount: 150 }))).toBe(0);
  });

  it('groups by supplier, largest exposure first', () => {
    const groups = groupBySupplier([
      incoming({ id: 'a', supplier_idno: '1', supplier_name: 'Small', total: 50 }),
      incoming({ id: 'b', supplier_idno: '2', supplier_name: 'Big', total: 500 }),
      incoming({ id: 'c', supplier_idno: '2', supplier_name: 'Big', total: 100 }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['Big', 'Small']);
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.total).toBe(600);
    expect(groups[0]!.awaiting).toBe(2);
  });
});

describe('configuration', () => {
  it('declares the wallet feature flags and section', () => {
    const app = readJson('app.config.json');
    expect(app.features.wallet).toBe(true);
    expect(app.features.incomingInvoices).toBe(true);
    // Payments are stage three and must stay off until the legal review lands.
    expect(app.features.payments).toBe(false);
    expect(app.wallet.payments.enabled).toBe(false);
    expect(app.wallet.consentVersion).toBeTruthy();
    expect(app.wallet.refreshIntervalMinutes).toBeGreaterThanOrEqual(15);
  });

  it('declares the connections entity without any password column', () => {
    const entities = readJson('entities.config.json').entities as Array<Record<string, any>>;
    const connections = entities.find((entity) => entity.name === 'connections');

    expect(connections).toBeDefined();
    const columns = connections!.columns.map((column: Record<string, unknown>) => column['name']);
    expect(columns).toContain('state');
    expect(columns).toContain('sfs_username');
    // The credential is posted straight to the API; nothing password-shaped may
    // exist in the local schema or in the sync queue's payloads.
    for (const column of columns) {
      expect(String(column)).not.toMatch(/password|secret/i);
    }
  });

  it('extends fiscal_invoices for both directions', () => {
    const entities = readJson('entities.config.json').entities as Array<Record<string, any>>;
    const invoices = entities.find((entity) => entity.name === 'fiscal_invoices');
    expect(invoices).toBeDefined();
    const columns = invoices!.columns.map((column: Record<string, unknown>) => column['name']);

    for (const column of ['direction', 'supplier_idno', 'supplier_name', 'decision', 'source']) {
      expect(columns).toContain(column);
    }
  });

  it('registers the wallet screens and their blocks', () => {
    for (const screen of ['wallet', 'connections']) {
      const config = readJson(`screens/${screen}.json`);
      expect(config.id).toBe(screen);
      for (const block of config.blocks) {
        expect(BLOCK_TYPE_NAMES).toContain(block.type);
      }
    }

    const wallet = readJson('screens/wallet.json');
    const types = wallet.blocks.map((block: Record<string, unknown>) => block['type']);
    expect(types).toContain('wallet_list');
    expect(types).toContain('connection_list');
  });

  it('reaches the wallet from the profile menu', () => {
    const profile = readJson('screens/profile.json');
    const menu = profile.blocks.find((block: any) => block.type === 'menu_list');
    const item = menu.props.items.find((entry: any) => entry.id === 'wallet');

    expect(item.action).toEqual({ type: 'navigate', screen: 'wallet' });
    expect(item.visibleIf).toEqual({ feature: 'wallet', auth: 'required' });
  });
});
