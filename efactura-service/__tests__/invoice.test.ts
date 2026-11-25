import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';

import { validateDocument } from '../src/invoice/validate.js';
import { buildDocumentsXml, money, quantity, round2, totals } from '../src/invoice/xml.js';
import { parseDocument, serializeDocument } from '../src/invoice/serialize.js';
import { demoInvoice } from './fixtures.js';

// Values stay strings: the point of these assertions is the exact text that
// goes on the wire, not what a parser makes of it.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
});

test('a well-formed invoice passes validation', () => {
  assert.deepEqual(validateDocument(demoInvoice()), []);
});

test('line arithmetic is checked against the declared totals', () => {
  const wrongVat = demoInvoice();
  wrongVat.lines[0]!.totalVat = 30;
  assert.ok(validateDocument(wrongVat).some((error) => error.includes('does not match the 8% rate')));

  const wrongNet = demoInvoice();
  wrongNet.lines[0]!.totalPriceWithoutVat = 100;
  assert.ok(
    validateDocument(wrongNet).some((error) => error.includes('quantity * unitPriceWithoutVat')),
  );

  const wrongTotal = demoInvoice({ total: 999 });
  assert.ok(validateDocument(wrongTotal).some((error) => error.includes('sum of the lines')));
});

test('a credit note with negative amounts is accepted', () => {
  const credit = demoInvoice({
    externalId: 'DOC-1002',
    lines: [
      {
        code: '4820',
        name: 'Lapte 2.5% 1 L - retur',
        unitOfMeasure: 'buc',
        quantity: -2,
        unitPriceWithoutVat: 14.92,
        totalPriceWithoutVat: -29.84,
        vatRate: 8,
        totalVat: -2.39,
        totalPrice: -32.23,
      },
    ],
  });
  assert.deepEqual(validateDocument(credit), []);
});

test('a fiscal code that is not 13 digits is rejected', () => {
  const bad = demoInvoice();
  bad.buyer.idno = '123';
  assert.ok(validateDocument(bad).some((error) => error.includes('buyer.idno must be 13 digits')));
});

test('supplier and buyer must differ', () => {
  const same = demoInvoice();
  same.buyer.idno = same.supplier.idno;
  assert.ok(validateDocument(same).some((error) => error.includes('must be different taxpayers')));
});

test('the XML carries the structure e-Factura expects', () => {
  const xml = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005001' })]);
  const parsed = parser.parse(xml) as any;
  const info = parsed.Documents.Document.SupplierInfo;

  assert.equal(info.Seria, 'EAA');
  assert.equal(info.Number, '000005001');
  assert.equal(info.Supplier['@_IDNO'], '1000000000033');
  assert.equal(info.Supplier['@_TaxpayerType'], '1');
  assert.equal(info.Supplier.BankAccount['@_Account'], 'MD24AG000225100013104168');
  assert.equal(info.Buyer['@_IDNO'], '1000000000015');
  assert.equal(info.Total, '270.94');
  assert.equal(info.TotalTVA, '30.24');
  assert.equal(info.IsFarma, 'false');
  assert.equal(info.CreationMotiv, '4');

  const rows = info.Merchandises.Row;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['@_Name'], 'Lapte 2.5% 1 L');
  assert.equal(rows[0]['@_TVA'], '8');
  assert.equal(rows[0]['@_TotalPrice'], '161.14');
});

test('IsFarma and CreationMotiv sit inside SupplierInfo, as in the signing model', () => {
  const xml = buildDocumentsXml([demoInvoice()]);
  const supplierInfo = xml.slice(xml.indexOf('<SupplierInfo>'), xml.indexOf('</SupplierInfo>'));
  assert.ok(supplierInfo.includes('<IsFarma>'));
  assert.ok(supplierInfo.includes('<CreationMotiv>'));
});

test('text that would break the XML is escaped', () => {
  const risky = demoInvoice();
  risky.buyer.title = 'A & B "Trading" <SRL>';
  const xml = buildDocumentsXml([risky]);
  assert.ok(xml.includes('A &amp; B &quot;Trading&quot; &lt;SRL&gt;'));
  assert.equal(parser.parse(xml).Documents.Document.SupplierInfo.Buyer['@_Title'], 'A & B "Trading" <SRL>');
});

test('amounts are formatted with two decimals and a dot', () => {
  assert.equal(money(14.9), '14.90');
  assert.equal(money(0.1 + 0.2), '0.30');
  assert.equal(quantity(2), '2');
  assert.equal(quantity(1.5), '1.5');
  assert.equal(round2(1.005), 1.01);
});

test('totals are derived from the lines when not supplied', () => {
  assert.deepEqual(totals(demoInvoice()), { total: 270.94, totalVat: 30.24 });
  assert.deepEqual(totals(demoInvoice({ total: 300, totalVat: 40 })), { total: 300, totalVat: 40 });
});

test('a serialised document round-trips, dates included', () => {
  const original = demoInvoice();
  const restored = parseDocument(serializeDocument(original));
  assert.ok(restored.deliveryDate instanceof Date);
  assert.equal(restored.deliveryDate.toISOString(), original.deliveryDate.toISOString());
  assert.equal(restored.lines.length, 2);
});
