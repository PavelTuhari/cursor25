/**
 * Signing abstraction.
 *
 * Three modes exist because clients differ: a small shop signs in the e-Factura
 * portal by hand (`none`), a mid-size one keeps a PKCS#12 certificate next to
 * the service (`pkcs12`), and a company above roughly ten thousand invoices a
 * month uses the STISC PKI-Server (`pkiserver`). Only the transport of the key
 * differs; the XML produced is identical.
 */
import type { SigningConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';

export interface SignatureMaterial {
  /** DER certificate, base64 - goes into `<X509Certificate>`. */
  certificateBase64: string;
  /** Signs the canonicalised `<SignedInfo>` and returns base64 RSA output. */
  sign(data: Buffer, digest: 'sha1' | 'sha256'): Promise<string>;
}

export interface Signer {
  readonly mode: SigningConfig['mode'];
  /**
   * Returns the document with one more `<SignatureContent>` appended, or the
   * document unchanged when the mode is `none`.
   */
  signDocument(documentXml: string): Promise<string>;
  /** True when this signer can actually produce a signature right now. */
  isAvailable(): boolean;
}

export class NoopSigner implements Signer {
  readonly mode = 'none' as const;

  constructor(private readonly logger: Logger) {}

  async signDocument(documentXml: string): Promise<string> {
    this.logger.debug('sign.skipped', { reason: 'signing.mode is "none"' });
    return documentXml;
  }

  isAvailable(): boolean {
    return false;
  }
}
