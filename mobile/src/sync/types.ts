/** Wire format of the UNA.md retail sync API (see docs/api-contract.md). */

export interface PullResponse<T = Record<string, unknown>> {
  items: T[];
  /** Ids removed on the server since the previous cursor. */
  deleted?: string[];
  /** Cursor to send as `updated_since` next time. */
  cursor?: string | null;
  has_more?: boolean;
  server_time?: string;
}

export interface BatchOperation {
  op: 'upsert' | 'delete';
  id: string;
  data?: unknown;
}

export interface BatchResultItem {
  id: string;
  status: 'ok' | 'error';
  record?: Record<string, unknown>;
  error?: string;
}

export interface BatchResponse {
  results: BatchResultItem[];
}

export interface EntitySyncResult {
  entity: string;
  skipped?: 'not_authenticated' | 'push_only' | 'disabled';
  pulled: number;
  deleted: number;
  pushed: number;
  failed: number;
  error?: string;
  durationMs: number;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  entities: EntitySyncResult[];
  pulled: number;
  pushed: number;
  failed: number;
  errors: string[];
  ok: boolean;
}
