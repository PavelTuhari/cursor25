/**
 * Encryption for the one thing this service must never leak: the API-user
 * credentials of somebody else's company.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to
 * garbage. The key lives in the environment or in a cloud vault and is never
 * written to the database, never logged and never returned over the API.
 *
 * The sealed value is stored as a single blob: `iv (12) | tag (16) | ciphertext`.
 * Keeping them together means a row can never be half-migrated into an
 * unopenable state.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/** Parses the configured key. Accepts base64 or 64 hex characters. */
export function parseKey(raw: string): Buffer {
  if (!raw) throw new SecretBoxError('encryption key is not configured');

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `encryption key must be ${KEY_BYTES} bytes (got ${key.length}); ` +
        'generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(rawKey: string) {
    this.key = parseKey(rawKey);
  }

  /** Encrypts a credential. Returns the blob to store as-is. */
  seal(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  /**
   * Decrypts a credential. Callers must use the result immediately and must not
   * store it anywhere - not in a field, not in a log, not in an error message.
   */
  open(sealed: Buffer): string {
    if (sealed.length < IV_BYTES + TAG_BYTES) {
      throw new SecretBoxError('sealed value is too short to be valid');
    }

    const iv = sealed.subarray(0, IV_BYTES);
    const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Either the key changed or the row was tampered with. Both mean the same
      // thing operationally: this credential must be re-entered by its owner.
      throw new SecretBoxError('cannot open sealed value: wrong key or corrupted data');
    }
  }

  /** True when both blobs hold the same plaintext, without revealing either. */
  matches(sealed: Buffer, candidate: string): boolean {
    let plaintext: string;
    try {
      plaintext = this.open(sealed);
    } catch {
      return false;
    }
    const a = Buffer.from(plaintext);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/** Generates a key for `.env`. Used by the setup instructions, not at runtime. */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
