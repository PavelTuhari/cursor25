export interface MockRequest {
  method: string;
  /** Path with query ("/catalog/products?limit=50") or a full URL. */
  url: string;
  authorization?: string | null;
  /** Parsed JSON body, if the request had one. */
  body?: unknown;
}

export interface MockResponse {
  status: number;
  /** JSON payload; absent for 204 and non-JSON responses. */
  body?: unknown;
  /** Text payload for non-JSON responses (the SVG placeholders). */
  text?: string;
  contentType: string;
}

export interface MockBackendOptions {
  fixtures: Record<string, unknown[]>;
  appConfig: { configVersion: number; features: Record<string, boolean> };
  baseUrl: string;
  rewriteImage: (cdnUrl: string) => string;
  placeholderImage?: string;
  now?: () => string;
}

export interface MockBackend {
  handle(request: MockRequest): MockResponse;
  counts(): string;
}

export function createMockBackend(options: MockBackendOptions): MockBackend;
export function parseUrl(input: string): { path: string; query: Record<string, string> };
export function imageLabel(path: string): string;
export function labelHash(label: string): number;
export const DEV_CODE: string;
export const CDN_PREFIX: string;
