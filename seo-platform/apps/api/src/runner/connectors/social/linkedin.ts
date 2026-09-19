import type {
  ConnectorDeps, PublishInput, PublishResult, SocialAccount, SocialConnector, VerifyResult,
} from './types.js';

/**
 * LinkedIn: публикация от имени организации или участника.
 *
 * Разбор ошибок по фактическому ответу REST API:
 *   {"status":401,"serviceErrorCode":65604,"code":"EMPTY_ACCESS_TOKEN","message":"..."}
 *
 * Версия API передаётся заголовком LinkedIn-Version и обязана быть указана
 * явно: LinkedIn версионирует API по датам и без заголовка отклоняет запрос.
 */

const API = 'https://api.linkedin.com';
const DEFAULT_VERSION = '202509';

interface LinkedInError {
  status?: number;
  code?: string;
  message?: string;
  serviceErrorCode?: number;
}

export function explainLinkedInError(error: LinkedInError): { error: string; hint: string } {
  const base = `${error.status ?? ''} ${error.code ?? ''}: ${error.message ?? 'неизвестная ошибка'}`.trim();
  switch (error.code) {
    case 'EMPTY_ACCESS_TOKEN':
      return { error: base, hint: 'Запрос ушёл без токена: проверьте credentials_ref подключения.' };
    case 'REVOKED_ACCESS_TOKEN':
    case 'EXPIRED_ACCESS_TOKEN':
    // Живой API отвечает именно этим кодом на нечитаемый токен.
    case 'INVALID_ACCESS_TOKEN':
      return {
        error: base,
        hint: 'Токен недействителен, отозван или истёк — пройдите авторизацию заново. ' +
          'Access-токен LinkedIn живёт 60 дней, refresh-токен выдаётся не всем приложениям.',
      };
    case 'ACCESS_DENIED':
      return {
        error: base,
        hint: 'Приложению не выдан нужный scope: для публикации требуется w_member_social ' +
          'либо w_organization_social для страницы компании.',
      };
    default:
      if (error.status === 429) {
        return { error: base, hint: 'Превышен дневной лимит запросов приложения.' };
      }
      return { error: base, hint: 'См. коды ошибок LinkedIn REST API.' };
  }
}

/** Автор публикации в терминах LinkedIn: urn организации или участника. */
function authorUrn(account: SocialAccount): string {
  if (account.external_id.startsWith('urn:li:')) return account.external_id;
  const kind = String(account.config['author_type'] ?? 'organization');
  return kind === 'person'
    ? `urn:li:person:${account.external_id}`
    : `urn:li:organization:${account.external_id}`;
}

export function createLinkedInConnector(deps: ConnectorDeps = {}): SocialConnector {
  const doFetch = deps.fetchImpl ?? fetch;

  function headers(account: SocialAccount): Record<string, string> {
    return {
      authorization: `Bearer ${account.credential}`,
      'content-type': 'application/json',
      'LinkedIn-Version': String(account.config['api_version'] ?? DEFAULT_VERSION),
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  return {
    channel: 'linkedin',

    async verify(account: SocialAccount): Promise<VerifyResult> {
      const response = await doFetch(`${API}/v2/userinfo`, { headers: headers(account) });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const { error, hint } = explainLinkedInError(data as LinkedInError);
        return { ok: false, error, hint };
      }
      return { ok: true, account_name: String(data['name'] ?? authorUrn(account)) };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const { account } = input;
      const body: Record<string, unknown> = {
        author: authorUrn(account),
        commentary: input.text,
        visibility: String(account.config['visibility'] ?? 'PUBLIC'),
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };
      if (input.link) {
        body['content'] = { article: { source: input.link, title: input.text.slice(0, 100) } };
      }
      if (input.dry_run) return { ok: true, preview: { endpoint: '/rest/posts', ...body } };

      const response = await doFetch(`${API}/rest/posts`, {
        method: 'POST',
        headers: headers(account),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as LinkedInError;
        const { error, hint } = explainLinkedInError(data);
        return { ok: false, error: `${error}. ${hint}` };
      }
      // Идентификатор публикации приходит заголовком, а не в теле.
      const id = response.headers.get('x-restli-id') ?? '';
      return {
        ok: true,
        external_id: id,
        url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined,
      };
    },
  };
}
