/** Picks the signer named by `signing.mode`. */
import type { SigningConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';
import { Pkcs12Signer } from './pkcs12.js';
import { PkiServerSigner } from './pkiServer.js';
import { NoopSigner, type Signer } from './signer.js';

export function createSigner(config: SigningConfig, logger: Logger): Signer {
  switch (config.mode) {
    case 'pkcs12':
      return new Pkcs12Signer(config, logger);
    case 'pkiserver':
      return new PkiServerSigner(config, logger);
    case 'none':
    default:
      return new NoopSigner(logger);
  }
}

export type { Signer };
export { NoopSigner, Pkcs12Signer, PkiServerSigner };
