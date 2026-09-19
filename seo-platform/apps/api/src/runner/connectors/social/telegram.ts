import type {
  ConnectorDeps, PublishInput, PublishResult, SocialAccount, SocialConnector, VerifyResult,
} from './types.js';

/**
 * Telegram Bot API.
 *
 * У платформы есть отдельная тестовая среда: тот же хост, но путь
 * `/bot<token>/test/<method>`. Аккаунт с sandbox = true уходит туда — это
 * штатный способ проверить интеграцию, не публикуя ничего в боевом канале.
 *
 * Разбор ошибок по фактическому ответу: {"ok":false,"error_code":401,"description":"Unauthorized"}
 */

const API = 'https://api.telegram.org';

export function explainTelegramError(code: number, description: string): { error: string; hint: string } {
  const base = `${code}: ${description}`;
  switch (code) {
    case 401:
      return { error: base, hint: 'Токен бота недействителен. Получите новый у @BotFather.' };
    case 403:
      return {
        error: base,
        hint: 'Бот не имеет доступа к чату: добавьте его в канал и дайте право публикации.',
      };
    case 400:
      return {
        error: base,
        hint: description.includes('chat not found')
          ? 'chat_id указан неверно. Для канала это @имя или числовой id вида -100…'
          : 'Запрос отклонён платформой: проверьте текст и разметку.',
      };
    case 404:
      // Живой Bot API отвечает 404, когда токен не имеет формата <id>:<секрет>:
      // путь просто не совпадает ни с одним методом.
      return {
        error: base,
        hint: 'Токен бота имеет неверный формат. Ожидается <id>:<секрет>, как выдаёт @BotFather.',
      };
    case 429:
      return { error: base, hint: 'Превышен лимит частоты. Telegram просит подождать перед повтором.' };
    default:
      return { error: base, hint: 'См. описание ошибки Bot API.' };
  }
}

export function createTelegramConnector(deps: ConnectorDeps = {}): SocialConnector {
  const doFetch = deps.fetchImpl ?? fetch;

  async function call(
    account: SocialAccount,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string; hint?: string }> {
    // Тестовая среда Telegram — это дополнительный сегмент пути, не другой хост.
    const segment = account.sandbox ? 'test/' : '';
    const response = await doFetch(`${API}/bot${account.credential}/${segment}${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await response.json()) as {
      ok: boolean;
      result?: Record<string, unknown>;
      error_code?: number;
      description?: string;
    };
    if (!data.ok) {
      const { error, hint } = explainTelegramError(data.error_code ?? 0, data.description ?? 'неизвестная ошибка');
      return { ok: false, error, hint };
    }
    return { ok: true, result: data.result };
  }

  return {
    channel: 'telegram',

    async verify(account: SocialAccount): Promise<VerifyResult> {
      const me = await call(account, 'getMe');
      if (!me.ok) return { ok: false, error: me.error, hint: me.hint };

      // Токен рабочий — проверяем, что бот действительно видит целевой чат.
      const chat = await call(account, 'getChat', { chat_id: account.external_id });
      if (!chat.ok) return { ok: false, error: chat.error, hint: chat.hint };

      const botName = String(me.result?.['username'] ?? '');
      const chatName = String(chat.result?.['title'] ?? chat.result?.['username'] ?? account.external_id);
      return { ok: true, account_name: `${chatName} (бот @${botName})` };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const text = input.link ? `${input.text}\n\n${input.link}` : input.text;
      const body = {
        chat_id: input.account.external_id,
        text,
        parse_mode: String(input.account.config['parse_mode'] ?? 'HTML'),
        disable_web_page_preview: input.account.config['disable_preview'] === true,
      };
      if (input.dry_run) return { ok: true, preview: { method: 'sendMessage', ...body } };

      const sent = await call(input.account, 'sendMessage', body);
      if (!sent.ok) return { ok: false, error: `${sent.error}. ${sent.hint}` };

      const messageId = String(sent.result?.['message_id'] ?? '');
      const chat = input.account.external_id.replace(/^@/, '');
      return {
        ok: true,
        external_id: messageId,
        url: input.account.external_id.startsWith('@')
          ? `https://t.me/${chat}/${messageId}`
          : undefined,
      };
    },
  };
}
