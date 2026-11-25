/**
 * Signing through the STISC PKI-Server.
 *
 * CTIF points companies issuing more than roughly ten thousand invoices a month
 * at this service so the key never leaves the HSM. The service keeps the same
 * `SignatureMaterial` contract as the local certificate: it hands over the bytes
 * of `<SignedInfo>` and gets base64 RSA output back.
 *
 * STISC does not publish the wire format, so the request and response shapes
 * below are configurable rather than hard-coded, and the whole exchange is
 * confined to `requestSignature`. Point `signing.pkiServer.url` at the endpoint
 * given to you in the onboarding pack; if the payload differs, this one function
 * is what changes.
 */
import type { SigningConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';
import type { SignatureMaterial, Signer } from './signer.js';
import { appendSignature, buildSignatureContent } from './xmldsig.js';

export interface PkiServerResponse {
  /** base64 RSA signature over the supplied bytes. */
  signature: string;
  /** base64 DER of the signing certificate. */
  certificate: string;
}

export class PkiServerSigner implements Signer {
  readonly mode = 'pkiserver' as const;
  private certificateCache: string | null = null;

  constructor(
    private readonly config: SigningConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async requestSignature(
    data: Buffer,
    digest: 'sha1' | 'sha256',
  ): Promise<PkiServerResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.pkiServer.timeoutMs);
    try {
      const response = await this.fetchImpl(this.config.pkiServer.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.pkiServer.apiKey}`,
        },
        body: JSON.stringify({
          keyAlias: this.config.pkiServer.keyAlias,
          algorithm: digest === 'sha256' ? 'RSA-SHA256' : 'RSA-SHA1',
          data: data.toString('base64'),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`PKI-Server answered HTTP ${response.status}`);
      }
      const body = (await response.json()) as Partial<PkiServerResponse>;
      if (!body.signature) throw new Error('PKI-Server response has no signature');
      return {
        signature: body.signature,
        certificate: body.certificate ?? this.certificateCache ?? '',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private material(): SignatureMaterial {
    // The certificate arrives with the first signature and is reused after that,
    // so a batch of invoices costs one round trip per document, not two.
    let certificate = this.certificateCache ?? '';
    const self = this;

    return {
      get certificateBase64() {
        return certificate;
      },
      async sign(data, digest) {
        const result = await self.requestSignature(data, digest);
        certificate = result.certificate;
        self.certificateCache = result.certificate;
        return result.signature;
      },
    } as SignatureMaterial;
  }

  async signDocument(documentXml: string): Promise<string> {
    const material = this.material();
    const content = await buildSignatureContent({
      documentXml,
      material,
      digest: this.config.pkcs12.digest,
    });
    this.logger.debug('sign.pkiserver.signed', { keyAlias: this.config.pkiServer.keyAlias });
    return appendSignature(documentXml, content);
  }

  isAvailable(): boolean {
    return Boolean(this.config.pkiServer.url && this.config.pkiServer.keyAlias);
  }
}
