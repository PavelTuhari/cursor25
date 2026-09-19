import { describe, expect, it, vi } from 'vitest';
import { createMetaConnector, explainGraphError } from '../runner/connectors/social/meta.js';
import { createTelegramConnector, explainTelegramError } from '../runner/connectors/social/telegram.js';
import { createLinkedInConnector, explainLinkedInError } from '../runner/connectors/social/linkedin.js';
import { socialConnectors, type SocialAccount } from '../runner/connectors/social/index.js';
import { EnvSecretResolver, SecretError, maskSecret } from '../config/secrets.js';

/**
 * Ответы ниже — фактические, снятые с живых эндпоинтов платформ:
 * Graph API, Telegram Bot API и LinkedIn REST. Коннекторы разбирают именно их.
 */

const ACCOUNT: SocialAccount = {
  external_id: '123456789',
  credential: 'token',
  sandbox: true,
  config: {},
};

function response(body: unknown, ok = true, headers: Record<string, string> = {}) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe('разбор ошибок Graph API', () => {
  it('объясняет недействительный токен (код 190)', () => {
    const out = explainGraphError({
      message: 'Invalid OAuth access token - Cannot parse access token',
      type: 'OAuthException', code: 190,
    });
    expect(out.error).toContain('190');
    expect(out.hint).toMatch(/Page Access Token/);
  });

  it('объясняет отсутствие токена (код 2500)', () => {
    const out = explainGraphError({
      message: 'An active access token must be used', type: 'OAuthException', code: 2500,
    });
    expect(out.hint).toMatch(/без токена/);
  });

  it('объясняет нехватку прав и называет нужные разрешения', () => {
    expect(explainGraphError({ message: 'x', type: 'OAuthException', code: 200 }).hint)
      .toMatch(/pages_manage_posts/);
  });

  it('распознаёт превышение лимита', () => {
    expect(explainGraphError({ message: 'x', type: 'OAuthException', code: 32 }).hint)
      .toMatch(/лимит/);
  });
});

describe('Facebook', () => {
  const fb = (fetchImpl: unknown) => createMetaConnector('facebook', { fetchImpl: fetchImpl as never });

  it('подтверждает подключение и возвращает название страницы', async () => {
    const connector = fb(vi.fn(async () => response({ id: '123', name: 'OfficePlus' })));
    expect(await connector.verify(ACCOUNT)).toEqual({ ok: true, account_name: 'OfficePlus' });
  });

  it('на недействительный токен отвечает объяснением, а не падает', async () => {
    const connector = fb(
      vi.fn(async () =>
        response({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }, false),
      ),
    );
    const result = await connector.verify(ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.hint).toMatch(/Page Access Token/);
  });

  it('публикует пост на странице', async () => {
    const fetchImpl = vi.fn(async () => response({ id: '123_456' }));
    const result = await fb(fetchImpl).publish({ account: ACCOUNT, text: 'Привет', link: 'https://officeplus.md' });
    expect(result).toMatchObject({ ok: true, external_id: '123_456' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/123456789/feed');
    expect(String(init.body)).toContain('message=');
  });

  it('в режиме dry-run не обращается к платформе', async () => {
    const fetchImpl = vi.fn();
    const result = await fb(fetchImpl).publish({ account: ACCOUNT, text: 'Привет', dry_run: true });
    expect(result.ok).toBe(true);
    expect(result.preview).toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Instagram', () => {
  const ig = (fetchImpl: unknown) => createMetaConnector('instagram', { fetchImpl: fetchImpl as never });

  it('отказывается публиковать без изображения, не обращаясь к API', async () => {
    const fetchImpl = vi.fn();
    const result = await ig(fetchImpl).publish({ account: ACCOUNT, text: 'Без картинки' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/изображение/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('публикует в два шага: контейнер, затем публикация', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'container-1' }))
      .mockResolvedValueOnce(response({ id: 'media-1' }));
    const result = await ig(fetchImpl).publish({
      account: ACCOUNT, text: 'Пост', image_url: 'https://officeplus.md/a.jpg',
    });
    expect(result).toMatchObject({ ok: true, external_id: 'media-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1] as [string])[0]).toContain('media_publish');
  });

  it('не публикует, если контейнер не создался', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ error: { message: 'bad', type: 'OAuthException', code: 100 } }, false),
    );
    const result = await ig(fetchImpl).publish({
      account: ACCOUNT, text: 'Пост', image_url: 'https://officeplus.md/a.jpg',
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram', () => {
  const tg = (fetchImpl: unknown) => createTelegramConnector({ fetchImpl: fetchImpl as never });

  it('объясняет 401 так же, как отвечает живой Bot API', () => {
    expect(explainTelegramError(401, 'Unauthorized').hint).toMatch(/BotFather/);
  });

  it('подсказывает формат chat_id при ошибке chat not found', () => {
    expect(explainTelegramError(400, 'Bad Request: chat not found').hint).toMatch(/-100/);
  });

  it('распознаёт 404 как неверный формат токена — так отвечает живой API', () => {
    expect(explainTelegramError(404, 'Not Found').hint).toMatch(/формат/);
  });

  it('в тестовой среде обращается по пути /test/', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { username: 'seo_bot' } }))
      .mockResolvedValueOnce(response({ ok: true, result: { title: 'Канал' } }));
    await tg(fetchImpl).verify({ ...ACCOUNT, sandbox: true, external_id: '@channel' });
    expect((fetchImpl.mock.calls[0] as [string])[0]).toContain('/test/getMe');
  });

  it('в боевом режиме идёт без /test/', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { username: 'seo_bot' } }))
      .mockResolvedValueOnce(response({ ok: true, result: { title: 'Канал' } }));
    await tg(fetchImpl).verify({ ...ACCOUNT, sandbox: false });
    expect((fetchImpl.mock.calls[0] as [string])[0]).not.toContain('/test/');
  });

  it('проверяет не только токен, но и доступ к чату', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, result: { username: 'seo_bot' } }))
      .mockResolvedValueOnce(response({ ok: false, error_code: 403, description: 'Forbidden' }));
    const result = await tg(fetchImpl).verify(ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.hint).toMatch(/добавьте его в канал/);
  });

  it('публикует сообщение и строит ссылку для публичного канала', async () => {
    const fetchImpl = vi.fn(async () => response({ ok: true, result: { message_id: 42 } }));
    const result = await tg(fetchImpl).publish({
      account: { ...ACCOUNT, external_id: '@officeplus' }, text: 'Акция', link: 'https://officeplus.md',
    });
    expect(result).toMatchObject({ ok: true, external_id: '42', url: 'https://t.me/officeplus/42' });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)).text)
      .toContain('https://officeplus.md');
  });
});

describe('LinkedIn', () => {
  const li = (fetchImpl: unknown) => createLinkedInConnector({ fetchImpl: fetchImpl as never });

  it('объясняет EMPTY_ACCESS_TOKEN так же, как отвечает живой API', () => {
    const out = explainLinkedInError({
      status: 401, serviceErrorCode: 65604, code: 'EMPTY_ACCESS_TOKEN',
      message: 'Empty oauth2 access token',
    });
    expect(out.error).toContain('EMPTY_ACCESS_TOKEN');
    expect(out.hint).toMatch(/credentials_ref/);
  });

  it('объясняет INVALID_ACCESS_TOKEN — код, которым отвечает живой API', () => {
    expect(explainLinkedInError({ status: 401, code: 'INVALID_ACCESS_TOKEN', message: 'Invalid access token' }).hint)
      .toMatch(/недействителен/);
  });

  it('называет нужный scope при отказе в доступе', () => {
    expect(explainLinkedInError({ status: 403, code: 'ACCESS_DENIED' }).hint)
      .toMatch(/w_organization_social/);
  });

  it('передаёт обязательный заголовок версии API', async () => {
    const fetchImpl = vi.fn(async () => response({ name: 'UNISIM' }));
    await li(fetchImpl).verify(ACCOUNT);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['LinkedIn-Version']).toBeTruthy();
  });

  it('строит urn организации по умолчанию', async () => {
    const result = await li(vi.fn()).publish({ account: ACCOUNT, text: 'Кейс', dry_run: true });
    expect((result.preview as Record<string, unknown>)['author']).toBe('urn:li:organization:123456789');
  });

  it('уважает явно заданный тип автора', async () => {
    const result = await li(vi.fn()).publish({
      account: { ...ACCOUNT, config: { author_type: 'person' } }, text: 'Пост', dry_run: true,
    });
    expect((result.preview as Record<string, unknown>)['author']).toBe('urn:li:person:123456789');
  });

  it('берёт идентификатор публикации из заголовка ответа', async () => {
    const fetchImpl = vi.fn(async () => response({}, true, { 'x-restli-id': 'urn:li:share:7' }));
    const result = await li(fetchImpl).publish({ account: ACCOUNT, text: 'Пост' });
    expect(result.external_id).toBe('urn:li:share:7');
  });
});

describe('реестр коннекторов', () => {
  it('знает четыре площадки', () => {
    expect([...socialConnectors().keys()].sort())
      .toEqual(['facebook', 'instagram', 'linkedin', 'telegram']);
  });
});

describe('секреты', () => {
  const env = { FB_TOKEN: 'abcdefghijklmnop' } as NodeJS.ProcessEnv;

  it('разрешает ссылку env:ИМЯ', async () => {
    expect(await new EnvSecretResolver(env).resolve('env:FB_TOKEN')).toBe('abcdefghijklmnop');
  });

  it('разрешает голое имя переменной', async () => {
    expect(await new EnvSecretResolver(env).resolve('FB_TOKEN')).toBe('abcdefghijklmnop');
  });

  it('называет переменную, которой не хватает', async () => {
    await expect(new EnvSecretResolver(env).resolve('env:NO_SUCH')).rejects.toThrow(/NO_SUCH/);
  });

  it('не подменяет ссылку на Vault переменной окружения', async () => {
    await expect(new EnvSecretResolver(env).resolve('vault://social/fb')).rejects.toThrow(SecretError);
  });

  it('has не раскрывает значение', async () => {
    const resolver = new EnvSecretResolver(env);
    expect(await resolver.has('env:FB_TOKEN')).toBe(true);
    expect(await resolver.has('env:NO_SUCH')).toBe(false);
  });

  it('маскирует секрет для логов', () => {
    expect(maskSecret('abcdefghijklmnop')).toBe('abcd…mnop');
    expect(maskSecret('short')).toBe('••••');
  });
});
