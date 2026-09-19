/** Evaluates the `visibleIf` rules used by tabs, blocks and menu items. */
import type { VisibilityRule } from '../config/types';

export interface VisibilityContext {
  features: Record<string, boolean>;
  isAuthenticated: boolean;
  locale: string;
}

export function isVisible(rule: VisibilityRule | undefined, ctx: VisibilityContext): boolean {
  if (!rule) return true;
  if (rule.feature && ctx.features[rule.feature] !== true) return false;
  if (rule.auth === 'required' && !ctx.isAuthenticated) return false;
  if (rule.auth === 'anonymous' && ctx.isAuthenticated) return false;
  if (rule.locales && !rule.locales.includes(ctx.locale)) return false;
  return true;
}
