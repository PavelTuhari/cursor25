/** Executes the `action` objects that JSON blocks declare. */
import { Linking } from 'react-native';

import type { ActionConfig } from '../config/types';

export interface ActionHandlers {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  addToList?: (productId: string) => void;
  sync?: () => void;
}

export function runAction(action: ActionConfig | undefined, handlers: ActionHandlers): void {
  if (!action) return;
  switch (action.type) {
    case 'navigate':
      handlers.navigate(action.screen, action.params);
      break;
    case 'url':
      void Linking.openURL(action.url);
      break;
    case 'addToList':
      if (action.productId) handlers.addToList?.(action.productId);
      break;
    case 'sync':
      handlers.sync?.();
      break;
    case 'none':
    default:
      break;
  }
}

export function asAction(value: unknown): ActionConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as { type?: unknown };
  return typeof candidate.type === 'string' ? (value as ActionConfig) : undefined;
}
