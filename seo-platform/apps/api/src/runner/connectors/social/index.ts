import type { ConnectorDeps, SocialConnector } from './types.js';
import { createMetaConnector } from './meta.js';
import { createTelegramConnector } from './telegram.js';
import { createLinkedInConnector } from './linkedin.js';

export * from './types.js';
export { explainGraphError } from './meta.js';
export { explainTelegramError } from './telegram.js';
export { explainLinkedInError } from './linkedin.js';

/** Коннекторы по идентификатору канала. */
export function socialConnectors(deps: ConnectorDeps = {}): Map<string, SocialConnector> {
  return new Map<string, SocialConnector>([
    ['facebook', createMetaConnector('facebook', deps)],
    ['instagram', createMetaConnector('instagram', deps)],
    ['linkedin', createLinkedInConnector(deps)],
    ['telegram', createTelegramConnector(deps)],
  ]);
}

export function isPublishableChannel(channel: string): boolean {
  return socialConnectors().has(channel);
}
