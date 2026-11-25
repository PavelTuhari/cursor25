/** Contract every screen block implements. */
import type React from 'react';

import type { BlockConfig, DataQuery } from '../../config/types';

export interface BlockProps {
  block: BlockConfig;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

export type BlockComponent = (props: BlockProps) => React.ReactElement | null;

export function blockQuery(block: BlockConfig, key = 'source'): DataQuery | null {
  const value = block.props?.[key];
  if (typeof value !== 'object' || value === null) return null;
  const query = value as DataQuery;
  return typeof query.entity === 'string' ? query : null;
}

export function blockNumber(block: BlockConfig, key: string, fallback: number): number {
  const value = block.props?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function blockBoolean(block: BlockConfig, key: string, fallback: boolean): boolean {
  const value = block.props?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function blockString(block: BlockConfig, key: string): string | undefined {
  const value = block.props?.[key];
  return typeof value === 'string' ? value : undefined;
}
