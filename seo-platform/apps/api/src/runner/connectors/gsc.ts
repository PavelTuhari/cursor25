import type { RunnerTool } from '../types.js';

/**
 * Google Search Console: запросы, показы, клики, позиции.
 *
 * Токен добывается отдельным провайдером, чтобы раннер не знал ни про
 * refresh-токены, ни про их хранение: ему нужен только Bearer на время вызова.
 */

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

/** Обменивает refresh-токен на access-токен и кэширует его до истечения. */
export class GoogleOAuthTokenProvider implements TokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      tokenEndpoint?: string;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  async getAccessToken(): Promise<string> {
    const now = (this.config.now ?? Date.now)();
    // Обновляем за минуту до истечения: запрос, стартовавший на границе,
    // не должен упасть на 401.
    if (this.cached && this.cached.expiresAt - 60_000 > now) {
      return this.cached.token;
    }
    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(this.config.tokenEndpoint ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`не удалось обновить токен Google: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new Error('ответ Google не содержит access_token');
    this.cached = {
      token: payload.access_token,
      expiresAt: now + (payload.expires_in ?? 3600) * 1000,
    };
    return this.cached.token;
  }
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscConfig {
  tokenProvider: TokenProvider;
  /** Ресурс в GSC: sc-domain:una.md либо https://una.md/ */
  siteUrl: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export function createGscTool(config: GscConfig): RunnerTool {
  const base = config.apiBase ?? API_BASE;
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: 'mcp-gsc',
    name: 'gsc_query',
    description:
      'Выгружает данные Google Search Console за период: запросы или страницы с показами, ' +
      'кликами, CTR и средней позицией. Единственный источник фактических позиций сайта.',
    external: true,
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Начало периода, YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Конец периода, YYYY-MM-DD' },
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: ['query', 'page', 'country', 'device', 'date'] },
          description: 'Разрезы выгрузки, по умолчанию query',
        },
        row_limit: { type: 'number', description: 'Сколько строк вернуть, по умолчанию 100' },
        query_contains: { type: 'string', description: 'Фильтр: запрос содержит подстроку' },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
    async run(input): Promise<string> {
      const dimensions = Array.isArray(input['dimensions']) && input['dimensions'].length > 0
        ? (input['dimensions'] as string[])
        : ['query'];
      const body: Record<string, unknown> = {
        startDate: String(input['start_date']),
        endDate: String(input['end_date']),
        dimensions,
        rowLimit: Math.min(Number(input['row_limit'] ?? 100), 25_000),
      };
      const contains = String(input['query_contains'] ?? '').trim();
      if (contains !== '') {
        body['dimensionFilterGroups'] = [
          { filters: [{ dimension: 'query', operator: 'contains', expression: contains }] },
        ];
      }

      const token = await config.tokenProvider.getAccessToken();
      const url = `${base}/sites/${encodeURIComponent(config.siteUrl)}/searchAnalytics/query`;
      const response = await doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return `ОШИБКА Search Console: HTTP ${response.status} ${response.statusText}`;
      }
      const payload = (await response.json()) as { rows?: GscRow[] };
      const rows = payload.rows ?? [];
      return JSON.stringify(
        {
          site: config.siteUrl,
          period: { from: body['startDate'], to: body['endDate'] },
          dimensions,
          row_count: rows.length,
          rows: rows.map((row) => ({
            keys: row.keys,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: Number((row.ctr * 100).toFixed(2)),
            position: Number(row.position.toFixed(1)),
          })),
        },
        null,
        2,
      );
    },
  };
}
