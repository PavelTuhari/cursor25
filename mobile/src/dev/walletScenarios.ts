/**
 * Scenarios for the wallet preview window.
 *
 * Each one is a complete, self-consistent state of the wallet, so the screen can
 * be looked at in the condition that matters rather than whatever the demo data
 * happens to be in. They exist because the interesting states - nothing
 * connected, credentials rejected, a decision in flight - are exactly the ones
 * that are awkward to reach by hand.
 */
import type { EntityRecord } from '../db/records';

export interface Scenario {
  id: string;
  /** Shown in the preview header, in English: this window is for developers. */
  title: string;
  note: string;
  connections: EntityRecord[];
  invoices: EntityRecord[];
}

const BUYER = '1000000000015';
const PLATFORM_SUPPLIER = '1000000000033';
const OUTSIDE_SUPPLIER = '1000000000024';
const TELECOM = '1000000000042';

function connection(overrides: EntityRecord = {}): EntityRecord {
  return {
    id: 'con-1',
    idno: BUYER,
    title: 'ALFA DEMO SRL',
    actor_role: 2,
    state: 'active',
    sfs_username: 'buyer',
    consent_at: '2026-08-24T08:30:00Z',
    consent_version: '2026-08-25',
    last_poll_at: '2026-08-25T09:45:00Z',
    last_error: null,
    updated_at: '2026-08-25T09:45:00Z',
    ...overrides,
  };
}

function incoming(overrides: EntityRecord = {}): EntityRecord {
  return {
    id: 'inv-in-1',
    direction: 'in',
    seria: 'EBB',
    number: '000000871',
    supplier_idno: OUTSIDE_SUPPLIER,
    supplier_name: 'BETA DEMO SRL',
    buyer_idno: BUYER,
    issued_at: '2026-08-21T10:15:00Z',
    total: 4820,
    total_vat: 803.33,
    state: 'confirmed',
    efactura_status: 7,
    decision: 'none',
    decision_note: null,
    source: 'sfs',
    paid_amount: 0,
    qr_text: 'https://efactura.sfs.md/EFactura.aspx?id=EBB-000000871',
    pdf_url: null,
    updated_at: '2026-08-21T10:20:00Z',
    ...overrides,
  };
}

function outgoing(overrides: EntityRecord = {}): EntityRecord {
  return {
    id: 'inv-out-1',
    direction: 'out',
    seria: 'EAA',
    number: '000005948',
    supplier_idno: PLATFORM_SUPPLIER,
    supplier_name: 'MAGAZIN DEMO SRL',
    buyer_idno: BUYER,
    issued_at: '2026-07-21T12:40:00Z',
    total: 811,
    total_vat: 135.17,
    state: 'confirmed',
    efactura_status: 3,
    decision: 'none',
    source: 'platform',
    paid_amount: 0,
    updated_at: '2026-07-22T08:15:00Z',
    ...overrides,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'default',
    title: 'Connected, documents from two suppliers',
    note: 'One invoice awaits a decision; one is accepted and half paid.',
    connections: [connection()],
    invoices: [
      incoming(),
      incoming({
        id: 'inv-in-2',
        seria: 'ECC',
        number: '000004412',
        supplier_idno: TELECOM,
        supplier_name: 'TELECOM DEMO SA',
        issued_at: '2026-08-12T14:05:00Z',
        total: 1150,
        total_vat: 191.67,
        efactura_status: 3,
        decision: 'accepted',
        paid_amount: 500,
      }),
      outgoing(),
    ],
  },
  {
    id: 'empty',
    title: 'Nothing connected yet',
    note: 'The first thing a new business customer sees.',
    connections: [],
    invoices: [],
  },
  {
    id: 'invalid',
    title: 'Credentials rejected',
    note: 'The API user was changed in the e-Factura portal; only the owner can fix it.',
    connections: [
      connection({
        state: 'invalid',
        last_error: 'AuthenticationFailedException: invalid user name or password',
      }),
    ],
    invoices: [incoming()],
  },
  {
    id: 'sending',
    title: 'Decision in flight',
    note: 'Accepted while offline: queued locally, not yet at the tax service.',
    connections: [connection()],
    invoices: [incoming({ decision: 'accepting' })],
  },
  {
    id: 'rejected',
    title: 'Rejected with a reason',
    note: 'The supplier sees the comment; it cannot be taken back.',
    connections: [connection()],
    invoices: [
      incoming({
        efactura_status: 2,
        decision: 'rejected',
        decision_note: 'Расхождение по количеству: получено 8 из 10.',
      }),
    ],
  },
];

export function findScenario(id: string | null | undefined): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
