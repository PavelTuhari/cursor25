import type {
  ConnectorDeps, PublishInput, PublishResult, SocialAccount, SocialConnector, VerifyResult,
} from './types.js';

/**
 * Facebook Pages и Instagram через Graph API.
 *
 * Разбор ошибок написан по фактическому ответу Graph API:
 *   {"error":{"message":"...","type":"OAuthException","code":190,"fbtrace_id":"..."}}
 * Код 190 — недействительный токен, 200/10 — нет прав, 4/17/32 — превышены лимиты.
 */

const DEFAULT_VERSION = 'v21.0';
const GRAPH = 'https://graph.facebook.com';

interface GraphError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/** Превращает ошибку Graph API в объяснение и подсказку. */
export function explainGraphError(error: GraphError): { error: string; hint: string } {
  const base = `${error.type} ${error.code}: ${error.message}`;
  switch (error.code) {
    case 190:
      return {
        error: base,
        hint: 'Токен недействителен или истёк. Для страницы нужен Page Access Token, ' +
          'полученный через /me/accounts, а не пользовательский токен.',
      };
    case 200:
    case 10:
      return {
        error: base,
        hint: 'Не хватает разрешений. Для публикации на странице нужны pages_manage_posts ' +
          'и pages_read_engagement, для Instagram — instagram_content_publish.',
      };
    case 4:
    case 17:
    case 32:
    case 613:
      return { error: base, hint: 'Превышен лимит запросов платформы. Снизьте частоту публикаций.' };
    case 2500:
      return { error: base, hint: 'Запрос ушёл без токена доступа.' };
    default:
      return { error: base, hint: 'См. документацию Graph API по коду ошибки.' };
  }
}

function versionOf(account: SocialAccount): string {
  return String(account.config['api_version'] ?? DEFAULT_VERSION);
}

export function createMetaConnector(channel: 'facebook' | 'instagram', deps: ConnectorDeps = {}): SocialConnector {
  const doFetch = deps.fetchImpl ?? fetch;

  async function call(
    account: SocialAccount,
    path: string,
    init: { method: 'GET' | 'POST'; body?: Record<string, string> },
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const url = new URL(`${GRAPH}/${versionOf(account)}/${path}`);
    const params = new URLSearchParams({ ...(init.body ?? {}), access_token: account.credential });
    const response =
      init.method === 'GET'
        ? await doFetch(`${url.toString()}?${params.toString()}`)
        : await doFetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
    const data = (await response.json()) as Record<string, unknown>;
    return { ok: response.ok && !data['error'], data };
  }

  return {
    channel,

    async verify(account: SocialAccount): Promise<VerifyResult> {
      const { ok, data } = await call(account, account.external_id, {
        method: 'GET',
        body: { fields: channel === 'instagram' ? 'id,username' : 'id,name' },
      });
      if (!ok) {
        const { error, hint } = explainGraphError(data['error'] as GraphError);
        return { ok: false, error, hint };
      }
      return { ok: true, account_name: String(data['name'] ?? data['username'] ?? account.external_id) };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { account } = input;

      if (channel === 'instagram') {
        // Instagram не принимает публикацию без изображения — это ограничение
        // платформы, а не наше: сообщаем до обращения к API.
        if (!input.image_url) {
          return { ok: false, error: 'Instagram требует изображение: image_url не задан' };
        }
        if (input.dry_run) {
          return {
            ok: true,
            preview: { step1: 'media', image_url: input.image_url, caption: input.text },
          };
        }
        // Публикация в два шага: создать контейнер, затем опубликовать его.
        const container = await call(account, `${account.external_id}/media`, {
          method: 'POST',
          body: { image_url: input.image_url, caption: input.text },
        });
        if (!container.ok) {
          const { error, hint } = explainGraphError(container.data['error'] as GraphError);
          return { ok: false, error: `${error}. ${hint}` };
        }
        const published = await call(account, `${account.external_id}/media_publish`, {
          method: 'POST',
          body: { creation_id: String(container.data['id']) },
        });
        if (!published.ok) {
          const { error, hint } = explainGraphError(published.data['error'] as GraphError);
          return { ok: false, error: `${error}. ${hint}` };
        }
        const id = String(published.data['id']);
        return { ok: true, external_id: id, url: `https://www.instagram.com/p/${id}` };
      }

      const body: Record<string, string> = { message: input.text };
      if (input.link) body['link'] = input.link;
      if (input.dry_run) return { ok: true, preview: { endpoint: `${account.external_id}/feed`, ...body } };

      const result = await call(account, `${account.external_id}/feed`, { method: 'POST', body });
      if (!result.ok) {
        const { error, hint } = explainGraphError(result.data['error'] as GraphError);
        return { ok: false, error: `${error}. ${hint}` };
      }
      const id = String(result.data['id']);
      return { ok: true, external_id: id, url: `https://www.facebook.com/${id}` };
    },

    async metrics(account: SocialAccount, externalId: string): Promise<Record<string, unknown>> {
      const metric = channel === 'instagram' ? 'impressions,reach,likes,comments' : 'post_impressions,post_engaged_users';
      const { ok, data } = await call(account, `${externalId}/insights`, {
        method: 'GET',
        body: { metric },
      });
      if (!ok) {
        const { error } = explainGraphError(data['error'] as GraphError);
        return { error };
      }
      return data;
    },
  };
}
