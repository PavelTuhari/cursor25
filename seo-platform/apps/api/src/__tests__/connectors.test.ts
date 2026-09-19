import { describe, expect, it, vi } from 'vitest';
import { createSerpTool, normalizeSerp } from '../runner/connectors/serp.js';
import { GoogleOAuthTokenProvider, createGscTool } from '../runner/connectors/gsc.js';
import { buildRegistry, registryConfigFromEnv } from '../runner/registry.js';

const CONTEXT = { run_id: 'r', network_allowlist: [], run_mode: 'execute' as const };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

const SERP_RAW = {
  organic: [
    { position: 1, title: 'Первый', link: 'https://a.md/x', snippet: 'текст' },
    { position: 2, title: 'Второй', link: 'https://b.md/y', snippet: 'ещё' },
  ],
  peopleAlsoAsk: [{ question: 'Как вести учёт НКО?' }, { question: 'Сколько стоит?' }],
  aiOverview: { sources: [{ link: 'https://a.md/x' }] },
};

describe('normalizeSerp', () => {
  const meta = { query: 'k', engine: 'google.md', locale: 'ru-MD', device: 'desktop' };

  it('приводит ответ провайдера к единому виду', () => {
    const out = normalizeSerp(SERP_RAW, meta);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({ position: 1, url: 'https://a.md/x' });
    expect(out.people_also_ask).toEqual(['Как вести учёт НКО?', 'Сколько стоит?']);
    expect(out.ai_overview).toEqual({ present: true, sources: ['https://a.md/x'] });
  });

  it('не выдумывает поля, которых нет в ответе', () => {
    const out = normalizeSerp({}, meta);
    expect(out.results).toEqual([]);
    expect(out.people_also_ask).toEqual([]);
    expect(out.ai_overview).toBeUndefined();
  });

  it('проставляет позицию по порядку, если провайдер её не вернул', () => {
    const out = normalizeSerp({ organic: [{ title: 'a', link: 'https://a.md' }] }, meta);
    expect(out.results[0]?.position).toBe(1);
  });
});

describe('serp_query', () => {
  it('отправляет запрос с ключом и разбирает ответ', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SERP_RAW));
    const tool = createSerpTool({ apiKey: 'secret-key', fetchImpl: fetchImpl as never });
    const out = JSON.parse(await tool.run({ query: 'бухгалтерия НКО', locale: 'ro-MD' }, CONTEXT));

    expect(out.engine).toBe('google.md');
    expect(out.results).toHaveLength(2);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('secret-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ q: 'бухгалтерия НКО', gl: 'md', hl: 'ro' });
  });

  it('сообщает об ошибке провайдера, а не делает вид, что выдача пуста', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 429));
    const tool = createSerpTool({ apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(await tool.run({ query: 'x' }, CONTEXT)).toMatch(/ОШИБКА.*429/);
  });

  it('не ходит в сеть с пустым запросом', async () => {
    const fetchImpl = vi.fn();
    const tool = createSerpTool({ apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(await tool.run({ query: '  ' }, CONTEXT)).toMatch(/ОШИБКА/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('считается внешним вызовом для лимита сессии', () => {
    expect(createSerpTool({ apiKey: 'k' }).external).toBe(true);
  });
});

describe('GoogleOAuthTokenProvider', () => {
  const base = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

  it('меняет refresh на access и кэширует его', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'at-1', expires_in: 3600 }));
    const provider = new GoogleOAuthTokenProvider({ ...base, fetchImpl: fetchImpl as never });
    expect(await provider.getAccessToken()).toBe('at-1');
    expect(await provider.getAccessToken()).toBe('at-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('обновляет токен заранее, не дожидаясь истечения', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: `at-${now}`, expires_in: 3600 }));
    const provider = new GoogleOAuthTokenProvider({
      ...base, fetchImpl: fetchImpl as never, now: () => now,
    });
    await provider.getAccessToken();
    now = 3_550_000; // за 50 секунд до истечения
    await provider.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('падает понятно, если Google не вернул токен', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 400));
    const provider = new GoogleOAuthTokenProvider({ ...base, fetchImpl: fetchImpl as never });
    await expect(provider.getAccessToken()).rejects.toThrow(/обновить токен/);
  });
});

describe('gsc_query', () => {
  const tokenProvider = { getAccessToken: async () => 'token-123' };

  it('запрашивает период и переводит CTR в проценты', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rows: [{ keys: ['программа бухгалтерия'], clicks: 12, impressions: 300, ctr: 0.04, position: 8.34 }],
      }),
    );
    const tool = createGscTool({
      tokenProvider, siteUrl: 'sc-domain:una.md', fetchImpl: fetchImpl as never,
    });
    const out = JSON.parse(
      await tool.run({ start_date: '2026-08-01', end_date: '2026-08-31' }, CONTEXT),
    );
    expect(out.row_count).toBe(1);
    expect(out.rows[0]).toMatchObject({ ctr: 4, position: 8.3 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(encodeURIComponent('sc-domain:una.md'));
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer token-123');
    expect(JSON.parse(init.body as string).dimensions).toEqual(['query']);
  });

  it('передаёт фильтр по подстроке запроса', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ rows: [] }));
    const tool = createGscTool({ tokenProvider, siteUrl: 'https://una.md/', fetchImpl: fetchImpl as never });
    await tool.run(
      { start_date: '2026-08-01', end_date: '2026-08-31', query_contains: 'НКО' },
      CONTEXT,
    );
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.dimensionFilterGroups[0].filters[0].expression).toBe('НКО');
  });

  it('сообщает об ошибке API, а не возвращает пустую выгрузку', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const tool = createGscTool({ tokenProvider, siteUrl: 'sc-domain:una.md', fetchImpl: fetchImpl as never });
    expect(await tool.run({ start_date: '2026-08-01', end_date: '2026-08-31' }, CONTEXT)).toMatch(/403/);
  });
});

describe('сборка реестра', () => {
  it('без ключей регистрирует только локальные инструменты', () => {
    const registry = buildRegistry({});
    expect(registry.has('mcp-site')).toBe(true);
    expect(registry.has('mcp-lang')).toBe(true);
    expect(registry.has('mcp-serp')).toBe(false);
    expect(registry.has('mcp-gsc')).toBe(false);
  });

  it('добавляет коннекторы, когда ключи заданы', () => {
    const registry = buildRegistry({
      serp: { apiKey: 'k' },
      gsc: { clientId: 'i', clientSecret: 's', refreshToken: 'r', siteUrl: 'sc-domain:una.md' },
    });
    expect(registry.has('mcp-serp')).toBe(true);
    expect(registry.has('mcp-gsc')).toBe(true);
  });

  it('не включает GSC без siteUrl: непонятно, чей сайт выгружать', () => {
    const config = registryConfigFromEnv({ GSC_REFRESH_TOKEN: 'r' } as NodeJS.ProcessEnv);
    expect(config.gsc).toBeUndefined();
  });

  it('читает конфигурацию из окружения', () => {
    const config = registryConfigFromEnv({
      SERP_API_KEY: 'k', SERP_ENDPOINT: 'https://serp.example/search',
      GSC_REFRESH_TOKEN: 'r', GSC_SITE_URL: 'sc-domain:una.md',
      GSC_CLIENT_ID: 'i', GSC_CLIENT_SECRET: 's',
    } as NodeJS.ProcessEnv);
    expect(config.serp).toEqual({ apiKey: 'k', endpoint: 'https://serp.example/search' });
    expect(config.gsc?.siteUrl).toBe('sc-domain:una.md');
  });
});
