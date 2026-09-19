import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { ConfigStore } from '../config/store.js';
import { PublishingService } from '../publishing.js';
import { EnvSecretResolver } from '../config/secrets.js';
import type { SocialConnector } from '../runner/connectors/social/index.js';
import { UNA_SITE, createTestApp } from './helpers.js';

/** Коннектор-заглушка: публикации наружу в тестах быть не должно. */
function stubConnector(overrides: Partial<SocialConnector> = {}): SocialConnector {
  return {
    channel: 'telegram',
    verify: async () => ({ ok: true, account_name: 'Тестовый канал' }),
    publish: async (input) =>
      input.dry_run
        ? { ok: true, preview: { text: input.text } }
        : { ok: true, external_id: '42', url: 'https://t.me/test/42' },
    ...overrides,
  };
}

describe('настройки', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => { ({ app, db } = await createTestApp()); });
  afterEach(async () => { await app.close(); await db.close(); });

  it('показывает значения по умолчанию и их источник', async () => {
    const items = (await app.inject({ method: 'GET', url: '/settings' })).json().items;
    const publishing = items.find((i: { key: string }) => i.key === 'publishing.enabled');
    expect(publishing.value).toBe(false);
    expect(publishing.source).toBe('значение по умолчанию');
  });

  it('сохраняет значение и отдаёт его как пришедшее из базы', async () => {
    await app.inject({
      method: 'PUT', url: '/settings',
      payload: { key: 'publishing.enabled', value: true, actor: 'p.tuhari' },
    });
    const items = (await app.inject({ method: 'GET', url: '/settings' })).json().items;
    const publishing = items.find((i: { key: string }) => i.key === 'publishing.enabled');
    expect(publishing.value).toBe(true);
    expect(publishing.source).toMatch(/база/);
  });

  it('отвергает неизвестный ключ', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/settings', payload: { key: 'нет.такой', value: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('переопределение для сайта имеет приоритет над глобальным', async () => {
    const site = (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
    const config = new ConfigStore(db);
    await config.set('publishing.default_rate_limit_per_day', 5, 'test');
    await config.set('publishing.default_rate_limit_per_day', 1, 'test', site.id);
    expect(await config.get('publishing.default_rate_limit_per_day')).toBe(5);
    expect(await config.get('publishing.default_rate_limit_per_day', site.id)).toBe(1);
  });

  it('читает значение из окружения, когда в базе его нет', async () => {
    const config = new ConfigStore(db, { RUNNER: 'claude' } as NodeJS.ProcessEnv);
    expect(await config.get('runner.enabled')).toBe(true);
  });
});

describe('подключения каналов', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
    process.env['TEST_TG_TOKEN'] = '123:test-token';
  });
  afterEach(async () => {
    delete process.env['TEST_TG_TOKEN'];
    await app.close();
    await db.close();
  });

  async function site() {
    return (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
  }

  const payload = (siteId: string, overrides: Record<string, unknown> = {}) => ({
    site_id: siteId,
    channel_id: 'telegram',
    external_id: '@officeplus_test',
    display_name: 'Тестовый канал',
    credentials_ref: 'env:TEST_TG_TOKEN',
    ...overrides,
  });

  it('заводит подключение и по умолчанию ставит песочницу', async () => {
    const created = await app.inject({
      method: 'POST', url: '/channel-accounts', payload: payload((await site()).id),
    });
    expect(created.statusCode).toBe(201);
    const items = (await app.inject({ method: 'GET', url: '/channel-accounts' })).json().items;
    expect(items[0].sandbox).toBe(true);
  });

  it('не сохраняет подключение, если секрета нет в окружении', async () => {
    const res = await app.inject({
      method: 'POST', url: '/channel-accounts',
      payload: payload((await site()).id, { credentials_ref: 'env:MISSING_TOKEN' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/MISSING_TOKEN/);
  });

  it('отвергает сам секрет вместо ссылки на него', async () => {
    const res = await app.inject({
      method: 'POST', url: '/channel-accounts',
      payload: payload((await site()).id, {
        credentials_ref: 'EAAG1234567890abcdefghijklmnopqrstuvwxyz',
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('отвергает канал, для которого публикация не реализована', async () => {
    const res = await app.inject({
      method: 'POST', url: '/channel-accounts',
      payload: payload((await site()).id, { channel_id: 'point-md' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/не реализована/);
  });

  it('не отдаёт наружу значение секрета, только его имя', async () => {
    await app.inject({ method: 'POST', url: '/channel-accounts', payload: payload((await site()).id) });
    const body = (await app.inject({ method: 'GET', url: '/channel-accounts' })).body;
    expect(body).toContain('env:TEST_TG_TOKEN');
    expect(body).not.toContain('123:test-token');
  });
});

describe('публикация', () => {
  let app: FastifyInstance;
  let db: Db;
  let connector: SocialConnector;

  async function setup(connectorOverrides: Partial<SocialConnector> = {}) {
    process.env['TEST_TG_TOKEN'] = '123:test-token';
    connector = stubConnector(connectorOverrides);
    const base = await createTestApp();
    db = base.db;
    const config = new ConfigStore(db, {} as NodeJS.ProcessEnv);
    const publishing = new PublishingService({
      db, config, secrets: new EnvSecretResolver(),
      connectors: new Map([['telegram', connector]]),
    });
    const { buildApp } = await import('../app.js');
    app = buildApp({
      db, una: base.una, templates: (await import('./helpers.js')).templates,
      now: () => new Date('2026-09-01T08:00:00.000Z'), config, publishing,
    });
    await app.ready();
    await base.app.close();

    const site = (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
    const account = (await app.inject({
      method: 'POST', url: '/channel-accounts',
      payload: {
        site_id: site.id, channel_id: 'telegram', external_id: '@test',
        credentials_ref: 'env:TEST_TG_TOKEN', display_name: 'Тест',
      },
    })).json();
    const publication = (await app.inject({
      method: 'POST', url: '/publications',
      payload: { site_id: site.id, account_id: account.id, body: 'Текст поста' },
    })).json();
    return { site, account, publication, config };
  }

  afterEach(async () => {
    delete process.env['TEST_TG_TOKEN'];
    await app.close();
    await db.close();
  });

  it('не публикует неутверждённый материал', async () => {
    const { publication } = await setup();
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`, payload: { actor: 'p.tuhari' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/утверждение/);
  });

  it('AI не может утвердить публикацию', async () => {
    const { publication } = await setup();
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'SEO_AI_BOT', decision: 'approve' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('не публикует, пока публикация выключена настройкой', async () => {
    const { publication } = await setup();
    await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`, payload: { actor: 'p.tuhari' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/publishing.enabled/);
  });

  it('публикует утверждённое при включённой настройке', async () => {
    const { publication, config } = await setup();
    await config.set('publishing.enabled', true, 'test');
    await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`, payload: { actor: 'p.tuhari' },
    });
    expect(res.json()).toMatchObject({ ok: true, url: 'https://t.me/test/42' });

    const items = (await app.inject({ method: 'GET', url: '/publications' })).json().items;
    expect(items[0].status).toBe('published');
  });

  it('dry-run проходит проверки, но наружу ничего не отправляет', async () => {
    const { publication } = await setup({
      publish: async (input) => {
        if (!input.dry_run) throw new Error('в dry-run наружу обращаться нельзя');
        return { ok: true, preview: { text: input.text } };
      },
    });
    await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`,
      payload: { actor: 'p.tuhari', dry_run: true },
    });
    expect(res.json().ok).toBe(true);
    expect(res.json().preview).toBeDefined();
  });

  it('не отправляет одну публикацию дважды', async () => {
    const { publication, config } = await setup();
    await config.set('publishing.enabled', true, 'test');
    await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    const payload = { actor: 'p.tuhari' };
    await app.inject({ method: 'POST', url: `/publications/${publication.id}/publish`, payload });
    const second = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`, payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it('соблюдает суточный лимит аккаунта', async () => {
    const { site, account, config } = await setup();
    await config.set('publishing.enabled', true, 'test');
    await config.set('publishing.default_rate_limit_per_day', 1, 'test');

    const publish = async () => {
      const publication = (await app.inject({
        method: 'POST', url: '/publications',
        payload: { site_id: site.id, account_id: account.id, body: 'Текст' },
      })).json();
      await app.inject({
        method: 'POST', url: `/publications/${publication.id}/approve`,
        payload: { actor: 'p.tuhari', decision: 'approve' },
      });
      return app.inject({
        method: 'POST', url: `/publications/${publication.id}/publish`, payload: { actor: 'p.tuhari' },
      });
    };

    expect((await publish()).json().ok).toBe(true);
    const blocked = await publish();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatch(/лимит/);
  });

  it('ошибку платформы записывает в публикацию, а не теряет', async () => {
    const { publication, config } = await setup({
      publish: async () => ({ ok: false, error: '403: Forbidden. Бот не в канале' }),
    });
    await config.set('publishing.enabled', true, 'test');
    await app.inject({
      method: 'POST', url: `/publications/${publication.id}/approve`,
      payload: { actor: 'p.tuhari', decision: 'approve' },
    });
    const res = await app.inject({
      method: 'POST', url: `/publications/${publication.id}/publish`, payload: { actor: 'p.tuhari' },
    });
    expect(res.json().ok).toBe(false);

    const items = (await app.inject({ method: 'GET', url: '/publications' })).json().items;
    expect(items[0].status).toBe('failed');
    expect(items[0].error).toMatch(/Forbidden/);
  });

  it('проверка подключения сохраняет результат', async () => {
    const { account } = await setup();
    const res = await app.inject({ method: 'POST', url: `/channel-accounts/${account.id}/verify` });
    expect(res.json()).toMatchObject({ ok: true, account_name: 'Тестовый канал' });

    const items = (await app.inject({ method: 'GET', url: '/channel-accounts' })).json().items;
    expect(items[0].last_check_status).toBe('ok');
  });

  it('неудачная проверка сохраняет причину', async () => {
    const { account } = await setup({
      verify: async () => ({ ok: false, error: '401: Unauthorized', hint: 'Токен недействителен' }),
    });
    await app.inject({ method: 'POST', url: `/channel-accounts/${account.id}/verify` });
    const items = (await app.inject({ method: 'GET', url: '/channel-accounts' })).json().items;
    expect(items[0].last_check_status).toBe('failed');
    expect(items[0].last_check_error).toMatch(/Токен недействителен/);
  });
});
