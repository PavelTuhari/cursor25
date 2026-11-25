/**
 * Builds an `EFacturaClient` for a specific connection.
 *
 * This is the only place in the service that opens a sealed credential. The
 * plaintext lives inside the returned client and nowhere else: it is not
 * returned, not cached separately, not logged.
 *
 * Clients are cached per connection so a poll cycle does not re-decrypt on every
 * call, and the cache is dropped the moment a connection's credentials change or
 * it is revoked.
 */
import type { SfsConfig } from '../config/types.js';
import type { Connection } from '../connections/types.js';
import type { ConnectionRepository } from '../db/connectionRepo.js';
import type { SecretBox } from '../crypto/secretBox.js';
import type { Logger } from '../util/logger.js';
import { EFacturaClient } from './client.js';

export class MissingCredentialsError extends Error {
  constructor(readonly connectionId: number) {
    super(`connection ${connectionId} has no usable credentials`);
    this.name = 'MissingCredentialsError';
  }
}

export interface ClientFactoryDeps {
  /** Endpoint, namespaces, timeouts - everything except the credentials. */
  baseConfig: SfsConfig;
  connections: ConnectionRepository;
  secretBox: SecretBox;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export class EFacturaClientFactory {
  private readonly cache = new Map<number, EFacturaClient>();

  constructor(private readonly deps: ClientFactoryDeps) {}

  /**
   * The service's own client, using the credentials from configuration. This is
   * what the outgoing pipeline uses, so single-company deployments keep working
   * exactly as before.
   */
  own(): EFacturaClient {
    return new EFacturaClient({
      config: this.deps.baseConfig,
      logger: this.deps.logger,
      fetchImpl: this.deps.fetchImpl,
    });
  }

  async forConnection(connection: Connection): Promise<EFacturaClient> {
    const cached = this.cache.get(connection.id);
    if (cached) return cached;

    if (connection.state === 'revoked' || !connection.sfsUsername) {
      throw new MissingCredentialsError(connection.id);
    }

    const sealed = await this.deps.connections.secretOf(connection.id);
    if (!sealed) throw new MissingCredentialsError(connection.id);

    const client = new EFacturaClient({
      config: {
        ...this.deps.baseConfig,
        username: connection.sfsUsername,
        password: this.deps.secretBox.open(sealed),
        actorRole: connection.actorRole as SfsConfig['actorRole'],
      },
      logger: this.deps.logger.child({ connectionId: connection.id, idno: connection.idno }),
      fetchImpl: this.deps.fetchImpl,
    });

    this.cache.set(connection.id, client);
    return client;
  }

  /**
   * Builds a throwaway client from credentials that have not been stored yet.
   * Used to verify them before the connection is accepted.
   */
  probe(username: string, password: string, actorRole: number): EFacturaClient {
    return new EFacturaClient({
      config: {
        ...this.deps.baseConfig,
        username,
        password,
        actorRole: actorRole as SfsConfig['actorRole'],
        // A wrong password should come back as a fault, not after three retries.
        retries: 0,
      },
      logger: this.deps.logger,
      fetchImpl: this.deps.fetchImpl,
    });
  }

  /** Called whenever a connection's credentials change or it is revoked. */
  forget(connectionId: number): void {
    this.cache.delete(connectionId);
  }

  forgetAll(): void {
    this.cache.clear();
  }
}
