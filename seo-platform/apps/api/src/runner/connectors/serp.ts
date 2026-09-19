import type { RunnerTool } from '../types.js';

/**
 * Съём поисковой выдачи.
 *
 * Провайдер задаётся конфигурацией, а не зашит: рынок SERP-API меняется,
 * и менять провайдера не должно означать переписывание раннера. Форма ответа
 * приводится к единому виду в normalizeSerp — там же единственное место,
 * которое правится при смене провайдера.
 */

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

export interface SerpResponse {
  query: string;
  engine: string;
  locale: string;
  device: string;
  results: SerpResult[];
  people_also_ask: string[];
  /** Есть ли AI-ответ в выдаче и кто в нём процитирован. */
  ai_overview?: { present: boolean; sources: string[] };
}

export interface SerpProviderConfig {
  /** Ключ провайдера. Без него инструмент не регистрируется. */
  apiKey: string;
  /** Эндпоинт провайдера. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://google.serper.dev/search';

/**
 * Приводит ответ провайдера к SerpResponse.
 *
 * Отсутствующие поля не выдумываются: пустой список честнее, чем
 * правдоподобно заполненный.
 */
export function normalizeSerp(
  raw: Record<string, unknown>,
  meta: { query: string; engine: string; locale: string; device: string },
): SerpResponse {
  const organic = Array.isArray(raw['organic']) ? (raw['organic'] as Record<string, unknown>[]) : [];
  const paa = Array.isArray(raw['peopleAlsoAsk'])
    ? (raw['peopleAlsoAsk'] as Record<string, unknown>[])
    : [];
  const aiOverview = raw['aiOverview'] as Record<string, unknown> | undefined;

  const response: SerpResponse = {
    ...meta,
    results: organic.map((item, index) => ({
      position: Number(item['position'] ?? index + 1),
      title: String(item['title'] ?? ''),
      url: String(item['link'] ?? item['url'] ?? ''),
      snippet: String(item['snippet'] ?? ''),
    })),
    people_also_ask: paa
      .map((item) => String(item['question'] ?? ''))
      .filter((question) => question !== ''),
  };

  if (aiOverview) {
    const sources = Array.isArray(aiOverview['sources'])
      ? (aiOverview['sources'] as Record<string, unknown>[]).map((s) => String(s['link'] ?? ''))
      : [];
    response.ai_overview = { present: true, sources: sources.filter(Boolean) };
  }
  return response;
}

export function createSerpTool(config: SerpProviderConfig): RunnerTool {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: 'mcp-serp',
    name: 'serp_query',
    description:
      'Снимает выдачу поисковика по запросу: органический ТОП, People Also Ask, наличие AI-ответа. ' +
      'Используй для проверки конкурентов и интента, а не для догадок о выдаче.',
    external: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Поисковый запрос' },
        locale: { type: 'string', description: 'Локаль выдачи, например ru-MD или ro-MD' },
        country: { type: 'string', description: 'Код страны выдачи, по умолчанию md' },
        device: { type: 'string', enum: ['desktop', 'mobile'], description: 'Тип устройства' },
        limit: { type: 'number', description: 'Сколько результатов вернуть, по умолчанию 10' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async run(input): Promise<string> {
      const query = String(input['query'] ?? '').trim();
      if (query === '') return 'ОШИБКА: пустой запрос';
      const locale = String(input['locale'] ?? 'ru-MD');
      const country = String(input['country'] ?? locale.split('-')[1] ?? 'md').toLowerCase();
      const device = String(input['device'] ?? 'desktop');
      const limit = Math.min(Number(input['limit'] ?? 10), 100);

      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': config.apiKey },
        body: JSON.stringify({
          q: query,
          gl: country,
          hl: locale.split('-')[0],
          num: limit,
          ...(device === 'mobile' ? { device: 'mobile' } : {}),
        }),
      });

      if (!response.ok) {
        return `ОШИБКА провайдера выдачи: HTTP ${response.status} ${response.statusText}`;
      }
      const raw = (await response.json()) as Record<string, unknown>;
      return JSON.stringify(
        normalizeSerp(raw, { query, engine: `google.${country}`, locale, device }),
        null,
        2,
      );
    },
  };
}
