/**
 * Коннекторы соцсетей.
 *
 * Публикация намеренно не является инструментом AI-сессии: по ТЗ (ч. I §9)
 * это действие уровня L2 — только после утверждения человеком. Агент может
 * подготовить текст и посмотреть метрики, но кнопку «опубликовать» нажимает
 * человек, а платформа лишь исполняет решение.
 */

export interface SocialAccount {
  /** Идентификатор в платформе: id страницы, urn организации, chat_id. */
  external_id: string;
  /** Токен или иной секрет, уже разрешённый из credentials_ref. */
  credential: string;
  /** Тестовая среда платформы вместо боевой. */
  sandbox: boolean;
  /** Произвольные параметры коннектора. */
  config: Record<string, unknown>;
}

export interface PublishInput {
  account: SocialAccount;
  text: string;
  /** Ссылка, которую нужно приложить к посту. */
  link?: string;
  /** Изображение: часть площадок без него не принимает публикацию. */
  image_url?: string;
  /** Не публиковать, только проверить, что запрос соберётся. */
  dry_run?: boolean;
}

export interface PublishResult {
  ok: boolean;
  /** Идентификатор публикации в платформе. */
  external_id?: string;
  url?: string;
  error?: string;
  /** Что было бы отправлено — заполняется в dry_run. */
  preview?: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  /** Как платформа назвала аккаунт: подтверждение, что подключён нужный. */
  account_name?: string;
  error?: string;
  /** Подсказка, что делать при ошибке. */
  hint?: string;
}

export interface SocialConnector {
  readonly channel: string;
  /** Живая проверка доступа. Ничего не публикует. */
  verify(account: SocialAccount): Promise<VerifyResult>;
  publish(input: PublishInput): Promise<PublishResult>;
  /** Метрики публикации, если платформа их отдаёт. */
  metrics?(account: SocialAccount, externalId: string): Promise<Record<string, unknown>>;
}

export interface ConnectorDeps {
  fetchImpl?: typeof fetch;
}
