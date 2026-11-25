import { strict as assert } from 'node:assert';
import { createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import forge from 'node-forge';

import { buildDocumentsXml } from '../src/invoice/xml.js';
import { Pkcs12Signer, loadPkcs12 } from '../src/sign/pkcs12.js';
import {
  appendSignature,
  buildSignatureContent,
  documentHash,
  signatureCount,
} from '../src/sign/xmldsig.js';
import { createLogger } from '../src/util/logger.js';
import { demoInvoice, testConfig } from './fixtures.js';

const logger = createLogger('error', {}, () => {});
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Builds a throwaway self-signed certificate and wraps it in a PKCS#12 file. */
function makeP12(passphrase: string): { file: string; publicKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attributes = [
    { name: 'commonName', value: 'UNA RETAIL SRL' },
    { name: 'countryName', value: 'MD' },
  ];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12).getBytes();
  const file = join(mkdtempSync(join(tmpdir(), 'efact-')), 'test.p12');
  writeFileSync(file, Buffer.from(der, 'binary'));

  return { file, publicKeyPem: forge.pki.publicKeyToPem(keys.publicKey) };
}

test('the document hash is stable, uppercase hex of the declared length', () => {
  const xml = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005001' })]);
  const first = documentHash(xml);
  const second = documentHash(xml);

  assert.equal(first, second);
  assert.equal(first.length, 40, 'SHA-1 as in the guide');
  assert.match(first, /^[0-9A-F]+$/);

  // A different document must not produce the same hash.
  const other = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005002' })]);
  assert.notEqual(first, documentHash(other));
});

test('sha256 is available for when SFS moves off sha1', () => {
  const xml = buildDocumentsXml([demoInvoice()]);
  assert.equal(documentHash(xml, 'sha256').length, 64);
});

test('a signature block has the structure from chapter 5 of the guide', async () => {
  const { file } = makeP12('pass');
  const keyPair = loadPkcs12(file, 'pass');
  const xml = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005001' })]);

  const content = await buildSignatureContent({
    documentXml: xml,
    material: {
      certificateBase64: keyPair.certificateBase64,
      sign: async () => 'AAAA',
    },
    hashId: '_fixed-id',
  });

  const parsed = parser.parse(content) as any;
  const signedDoc = parsed.SignatureContent.SignedDoc;

  assert.equal(signedDoc.hash['@_Id'], '_fixed-id');
  assert.equal(String(signedDoc.hash['#text']).length, 40);

  const signature = signedDoc.Signature;
  assert.equal(signature['@_xmlns'], 'http://www.w3.org/2000/09/xmldsig#');
  assert.equal(signature.SignedInfo.Reference['@_URI'], '#_fixed-id');
  assert.equal(
    signature.SignedInfo.CanonicalizationMethod['@_Algorithm'],
    'http://www.w3.org/2001/10/xml-exc-c14n#',
  );
  assert.equal(
    signature.SignedInfo.SignatureMethod['@_Algorithm'],
    'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  );
  assert.equal(signature.SignedInfo.Reference.Transforms.Transform.length, 2);
  assert.ok(signature.KeyInfo.X509Data.X509Certificate);
});

test('the signature verifies against the certificate that produced it', async () => {
  const { file, publicKeyPem } = makeP12('pass');
  const keyPair = loadPkcs12(file, 'pass');
  const xml = buildDocumentsXml([demoInvoice()]);

  let signedBytes: Buffer | null = null;
  const content = await buildSignatureContent({
    documentXml: xml,
    material: {
      certificateBase64: keyPair.certificateBase64,
      sign: async (data) => {
        signedBytes = data;
        const { createSign } = await import('node:crypto');
        return createSign('RSA-SHA1').update(data).sign(keyPair.privateKeyPem, 'base64');
      },
    },
  });

  const signatureValue = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(content)?.[1];
  assert.ok(signatureValue, 'a signature value was produced');
  assert.ok(signedBytes, 'the signer was handed the bytes of SignedInfo');

  const verified = createVerify('RSA-SHA1')
    .update(signedBytes!)
    .verify(publicKeyPem, signatureValue!, 'base64');
  assert.ok(verified, 'the signature checks out against the public key');
});

test('signatures stack: the buyer signs after the supplier', async () => {
  const { file } = makeP12('pass');
  const config = testConfig();
  config.signing.mode = 'pkcs12';
  config.signing.pkcs12.file = file;
  config.signing.pkcs12.passphrase = 'pass';

  const signer = new Pkcs12Signer(config.signing, logger);
  assert.ok(signer.isAvailable());

  const xml = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005001' })]);
  assert.equal(signatureCount(xml), 0);

  const once = await signer.signDocument(xml);
  assert.equal(signatureCount(once), 1);
  assert.ok(once.includes('<Signatures>'));
  assert.ok(once.indexOf('<Signatures>') > once.indexOf('</SupplierInfo>'));

  const twice = await signer.signDocument(once);
  assert.equal(signatureCount(twice), 2);
  // Exactly one <Signatures> wrapper, holding both contents.
  assert.equal((twice.match(/<Signatures>/g) ?? []).length, 1);
});

test('the original document survives signing untouched', async () => {
  const { file } = makeP12('pass');
  const config = testConfig();
  config.signing.mode = 'pkcs12';
  config.signing.pkcs12.file = file;
  config.signing.pkcs12.passphrase = 'pass';

  const xml = buildDocumentsXml([demoInvoice({ seria: 'EAA', number: '000005001' })]);
  const signed = await new Pkcs12Signer(config.signing, logger).signDocument(xml);

  const supplierInfo = (text: string) =>
    text.slice(text.indexOf('<SupplierInfo>'), text.indexOf('</SupplierInfo>'));
  assert.equal(supplierInfo(signed), supplierInfo(xml));
});

test('a wrong passphrase is reported clearly', () => {
  const { file } = makeP12('correct');
  assert.throws(() => loadPkcs12(file, 'wrong'), /PKCS#12|MAC|password|passphrase/i);
});

test('appendSignature refuses a document it cannot place a signature in', () => {
  assert.throws(() => appendSignature('<NotADocument/>', '<SignatureContent/>'), /closing/);
});
