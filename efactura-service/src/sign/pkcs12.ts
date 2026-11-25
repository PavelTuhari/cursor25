/**
 * Signing with a PKCS#12 (.p12/.pfx) certificate held by the service.
 *
 * Node cannot open a PKCS#12 container natively, so node-forge unwraps it once
 * at start-up; from then on the private key lives in memory as a PEM and all
 * signing goes through node:crypto.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';

import type { SigningConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';
import type { SignatureMaterial, Signer } from './signer.js';
import { appendSignature, buildSignatureContent } from './xmldsig.js';

interface KeyPair {
  privateKeyPem: string;
  certificateBase64: string;
  subject: string;
  notAfter: Date;
}

/** Opens the container and picks the key whose certificate it belongs to. */
export function loadPkcs12(file: string, passphrase: string): KeyPair {
  const der = readFileSync(file);
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);

  const shroudedKeyBagOid = forge.pki.oids['pkcs8ShroudedKeyBag'] as string;
  const keyBagOid = forge.pki.oids['keyBag'] as string;
  const certBagOid = forge.pki.oids['certBag'] as string;

  // A container built by one tool shrouds the key, another leaves it bare.
  const keyBags: forge.pkcs12.Bag[] =
    p12.getBags({ bagType: shroudedKeyBagOid })[shroudedKeyBagOid] ??
    p12.getBags({ bagType: keyBagOid })[keyBagOid] ??
    [];
  const certBags: forge.pkcs12.Bag[] = p12.getBags({ bagType: certBagOid })[certBagOid] ?? [];

  const key = keyBags[0]?.key;
  if (!key) throw new Error(`${file} contains no private key (wrong passphrase?)`);

  // A container often carries the whole chain; the leaf is the one whose public
  // key matches the private key we just unwrapped.
  const publicKeyPem = forge.pki.publicKeyToPem(
    forge.pki.setRsaPublicKey((key as forge.pki.rsa.PrivateKey).n, (key as forge.pki.rsa.PrivateKey).e),
  );
  const leaf =
    certBags.find(
      (bag: forge.pkcs12.Bag) =>
        bag.cert && forge.pki.publicKeyToPem(bag.cert.publicKey) === publicKeyPem,
    )?.cert ?? certBags[0]?.cert;
  if (!leaf) throw new Error(`${file} contains no certificate`);

  const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();

  return {
    privateKeyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey),
    certificateBase64: forge.util.encode64(derCert),
    subject: leaf.subject.attributes
      .map((attribute: forge.pki.CertificateField) => `${attribute.shortName}=${attribute.value}`)
      .join(', '),
    notAfter: leaf.validity.notAfter,
  };
}

export class Pkcs12Signer implements Signer {
  readonly mode = 'pkcs12' as const;
  private readonly keyPair: KeyPair;
  private readonly digest: 'sha1' | 'sha256';

  constructor(
    config: SigningConfig,
    private readonly logger: Logger,
  ) {
    this.keyPair = loadPkcs12(config.pkcs12.file, config.pkcs12.passphrase);
    this.digest = config.pkcs12.digest;

    const daysLeft = Math.floor((this.keyPair.notAfter.getTime() - Date.now()) / 86_400_000);
    logger.info('sign.certificate', {
      subject: this.keyPair.subject,
      notAfter: this.keyPair.notAfter.toISOString(),
      daysLeft,
    });
    // Worth shouting about early: an expired certificate fails every invoice.
    if (daysLeft < 0) logger.error('sign.certificate.expired', { daysLeft });
    else if (daysLeft < 30) logger.warn('sign.certificate.expiring', { daysLeft });
  }

  private material(): SignatureMaterial {
    return {
      certificateBase64: this.keyPair.certificateBase64,
      sign: async (data, digest) =>
        createSign(digest === 'sha256' ? 'RSA-SHA256' : 'RSA-SHA1')
          .update(data)
          .sign(this.keyPair.privateKeyPem, 'base64'),
    };
  }

  async signDocument(documentXml: string): Promise<string> {
    const content = await buildSignatureContent({
      documentXml,
      material: this.material(),
      digest: this.digest,
    });
    return appendSignature(documentXml, content);
  }

  isAvailable(): boolean {
    return this.keyPair.notAfter.getTime() > Date.now();
  }
}
