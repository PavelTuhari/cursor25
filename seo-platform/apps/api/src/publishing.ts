import type { Db } from './db.js';
import { ApiError } from './errors.js';
import type { ConfigStore } from './config/store.js';
import type { SecretResolver } from './config/secrets.js';
import { socialConnectors, type SocialAccount, type SocialConnector } from './runner/connectors/social/index.js';

/**
 * Публикация в каналы.
 *
 * Три проверки перед отправкой, и все три — в коде, а не в инструкции агенту:
 * публикация включена, материал утверждён человеком, суточный лимит аккаунта
 * не исчерпан. Публикация необратима, поэтому надеяться, что агент сам
 * посчитает лимит площадки, нельзя.
 */

export interface ChannelAccountRow {
  id: string;
  site_id: string;
  channel_id: string;
  external_id: string;
  display_name: string;
  credentials_ref: string;
  config: Record<string, unknown>;
  sandbox: boolean;
  enabled: boolean;
  rate_limit_per_day: number | null;
}

export interface PublishingDeps {
  db: Db;
  config: ConfigStore;
  secrets: SecretResolver;
  connectors?: Map<string, SocialConnector>;
}

export class PublishingService {
  private readonly connectors: Map<string, SocialConnector>;

  constructor(private readonly deps: PublishingDeps) {
    this.connectors = deps.connectors ?? socialConnectors();
  }

  private connectorFor(channelId: string): SocialConnector {
    const connector = this.connectors.get(channelId);
    if (!connector) {
      throw ApiError.badRequest(
        `Канал "${channelId}" не умеет публиковать: коннектор не реализован`,
      );
    }
    return connector;
  }

  private async account(id: string): Promise<ChannelAccountRow> {
    const { rows } = await this.deps.db.query<ChannelAccountRow>(
      `SELECT * FROM channel_accounts WHERE id = $1`, [id],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('Подключение канала');
    return row;
  }

  private async toSocialAccount(row: ChannelAccountRow): Promise<SocialAccount> {
    return {
      external_id: row.external_id,
      credential: await this.deps.secrets.resolve(row.credentials_ref),
      sandbox: row.sandbox,
      config: row.config ?? {},
    };
  }

  /** Живая проверка подключения. Ничего не публикует. */
  async verify(accountId: string): Promise<{ ok: boolean; account_name?: string; error?: string; hint?: string }> {
    const row = await this.account(accountId);
    const connector = this.connectorFor(row.channel_id);

    let result: Awaited<ReturnType<SocialConnector['verify']>>;
    try {
      result = await connector.verify(await this.toSocialAccount(row));
    } catch (error) {
      result = { ok: false, error: (error as Error).message };
    }

    await this.deps.db.query(
      `UPDATE channel_accounts
          SET last_checked_at = now(), last_check_status = $2, last_check_error = $3
        WHERE id = $1`,
      [accountId, result.ok ? 'ok' : 'failed', result.ok ? null : `${result.error ?? ''} ${result.hint ?? ''}`.trim()],
    );
    return result;
  }

  /** Сколько публикаций сегодня уже ушло через аккаунт. */
  private async usedToday(accountId: string): Promise<number> {
    const { rows } = await this.deps.db.query<{ published: number }>(
      `SELECT published FROM channel_usage WHERE account_id = $1 AND usage_date = CURRENT_DATE`,
      [accountId],
    );
    return Number(rows[0]?.published ?? 0);
  }

  private async countPublication(accountId: string): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO channel_usage (account_id, usage_date, published)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (account_id, usage_date) DO UPDATE SET published = channel_usage.published + 1`,
      [accountId],
    );
  }

  /**
   * Публикует подготовленный материал.
   *
   * dryRun прогоняет все проверки и собирает запрос, но наружу ничего не
   * отправляет — так можно убедиться в настройке, не засоряя канал.
   */
  async publish(
    publicationId: string,
    actor: string,
    options: { dryRun?: boolean } = {},
  ): Promise<{ ok: boolean; url?: string; external_id?: string; error?: string; preview?: unknown }> {
    const { rows } = await this.deps.db.query<{
      id: string; site_id: string; channel_id: string; account_id: string | null;
      status: string; body: string; external_url: string | null; title: string;
    }>(`SELECT id, site_id, channel_id, account_id, status, body, external_url, title
          FROM publications WHERE id = $1`, [publicationId]);
    const publication = rows[0];
    if (!publication) throw ApiError.notFound('Публикация');

    if (!publication.account_id) {
      throw ApiError.badRequest('У публикации не выбрано подключение канала');
    }
    if (publication.status === 'published') {
      throw ApiError.conflict('Публикация уже отправлена — повтор создал бы дубль');
    }

    const requireApproval = await this.deps.config.get<boolean>(
      'publishing.require_approval', publication.site_id,
    );
    if (requireApproval && publication.status !== 'approved') {
      throw ApiError.forbidden(
        `Публикация в статусе "${publication.status}": требуется утверждение человеком`,
      );
    }

    const enabled = await this.deps.config.get<boolean>('publishing.enabled', publication.site_id);
    if (!enabled && !options.dryRun) {
      throw ApiError.forbidden(
        'Публикация выключена настройкой publishing.enabled. Включите её осознанно: действие необратимо',
      );
    }

    const account = await this.account(publication.account_id);
    if (!account.enabled) throw ApiError.badRequest('Подключение канала выключено');

    const limit =
      account.rate_limit_per_day ??
      (await this.deps.config.get<number>('publishing.default_rate_limit_per_day', publication.site_id));
    const used = await this.usedToday(account.id);
    if (!options.dryRun && used >= limit) {
      throw ApiError.forbidden(
        `Суточный лимит канала исчерпан: ${used} из ${limit}. ` +
          'Лимит защищает аккаунт от блокировки за спам.',
      );
    }

    const connector = this.connectorFor(account.channel_id);
    await this.deps.db.query(`UPDATE publications SET status = 'publishing' WHERE id = $1`, [publicationId]);

    const result = await connector.publish({
      account: await this.toSocialAccount(account),
      text: publication.body,
      link: publication.external_url ?? undefined,
      image_url: (account.config['default_image_url'] as string | undefined) ?? undefined,
      dry_run: options.dryRun === true,
    });

    if (options.dryRun) {
      await this.deps.db.query(`UPDATE publications SET status = 'approved' WHERE id = $1`, [publicationId]);
      return { ok: result.ok, preview: result.preview, error: result.error };
    }

    if (!result.ok) {
      await this.deps.db.query(
        `UPDATE publications SET status = 'failed', error = $2 WHERE id = $1`,
        [publicationId, result.error ?? 'неизвестная ошибка'],
      );
      return { ok: false, error: result.error };
    }

    await this.deps.db.query(
      `UPDATE publications
          SET status = 'published', published_at = now(), external_url = COALESCE($2, external_url), error = NULL
        WHERE id = $1`,
      [publicationId, result.url ?? null],
    );
    await this.countPublication(account.id);
    await this.deps.db.query(
      `INSERT INTO audit_log (actor, actor_kind, action, target, payload)
       VALUES ($1, 'user', 'publication.publish', $2, $3)`,
      [actor, publicationId, JSON.stringify({ channel: account.channel_id, url: result.url })],
    );

    return { ok: true, url: result.url, external_id: result.external_id };
  }
}
