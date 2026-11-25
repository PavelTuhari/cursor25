/** Shared fixtures: a valid invoice and a config pointing at the local mock. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AppConfig } from '../src/config/types.js';
import type { InvoiceDocument } from '../src/invoice/types.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = JSON.parse(
    readFileSync(resolve(process.cwd(), 'config', 'service.config.json'), 'utf8'),
  ) as AppConfig;

  base.service.tenantId = 'test';
  base.oracle.connectString = 'memory';
  base.sfs.username = 'supplier';
  base.sfs.password = 'supplier';
  base.sfs.retries = 0;
  base.sfs.timeoutMs = 5000;
  base.worker.enabled = false;
  base.worker.seriesLowWaterMark = 5;
  base.worker.seriesReserveCount = 10;
  base.worker.statusPollIntervalMs = 10;
  base.service.logLevel = 'error';

  return { ...base, ...overrides };
}

export function demoInvoice(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    externalId: 'DOC-1001',
    deliveryDate: new Date('2026-08-24T09:00:00.000Z'),
    supplier: {
      idno: '1000000000033',
      taxpayerType: 1,
      title: 'UNA RETAIL SRL',
      address: 'mun. Chisinau, str. Alba Iulia 75',
      bankAccount: { account: 'MD24AG000225100013104168', branchTitle: 'MAIB', branchCode: 'MOBBMD22' },
    },
    buyer: {
      idno: '1000000000015',
      taxpayerType: 1,
      title: 'ALFA DEMO SRL',
      address: 'mun. Chisinau, bd. Dacia 47',
    },
    lines: [
      {
        code: '4820',
        name: 'Lapte 2.5% 1 L',
        unitOfMeasure: 'buc',
        quantity: 10,
        unitPriceWithoutVat: 14.92,
        totalPriceWithoutVat: 149.2,
        vatRate: 8,
        totalVat: 11.94,
        totalPrice: 161.14,
      },
      {
        code: '7710',
        name: 'Detergent vase 1 L',
        unitOfMeasure: 'buc',
        quantity: 2,
        unitPriceWithoutVat: 45.75,
        totalPriceWithoutVat: 91.5,
        vatRate: 20,
        totalVat: 18.3,
        totalPrice: 109.8,
      },
    ],
    ...overrides,
  };
}
