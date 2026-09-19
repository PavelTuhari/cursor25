-- Конфигурация платформы и подключения каналов.
--
-- Секреты здесь не хранятся: в credentials_ref лежит ИМЯ секрета, а значение
-- берётся из окружения или Vault. База может утечь в бэкап, в реплику, в лог
-- медленных запросов — токен публикации не должен уехать вместе с ней.

BEGIN;

CREATE TABLE settings (
    scope       text NOT NULL DEFAULT 'global',
    key         text NOT NULL,
    value       jsonb NOT NULL,
    description text NOT NULL DEFAULT '',
    updated_by  text NOT NULL DEFAULT 'system',
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

COMMENT ON TABLE settings IS
    'Настройки платформы. scope = global либо site:<uuid> для переопределения на сайт';

-- Подключение канала к сайту: аккаунт, его идентификаторы и ограничения.
CREATE TABLE channel_accounts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    channel_id          text NOT NULL REFERENCES channels(id),
    -- Идентификатор в платформе: id страницы, urn организации, chat_id.
    external_id         text NOT NULL,
    display_name        text NOT NULL DEFAULT '',
    -- Имя секрета, а не сам секрет.
    credentials_ref     text NOT NULL,
    -- Произвольные параметры коннектора: версия API, доп. идентификаторы.
    config              jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Тестовая среда платформы вместо боевой.
    sandbox             boolean NOT NULL DEFAULT true,
    enabled             boolean NOT NULL DEFAULT true,
    rate_limit_per_day  integer,
    last_checked_at     timestamptz,
    last_check_status   text,
    last_check_error    text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, channel_id, external_id)
);

CREATE INDEX channel_accounts_site_idx ON channel_accounts (site_id) WHERE enabled;

-- Счётчик публикаций за сутки: анти-спам лимиты площадок соблюдаются
-- платформой, а не надеждой на то, что агент посчитает сам.
CREATE TABLE channel_usage (
    account_id  uuid NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
    usage_date  date NOT NULL,
    published   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, usage_date)
);

-- Публикация получает ссылку на аккаунт, через который ушла.
ALTER TABLE publications ADD COLUMN account_id uuid REFERENCES channel_accounts(id);
ALTER TABLE publications ADD COLUMN status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','publishing','published','failed','skipped'));
ALTER TABLE publications ADD COLUMN body text NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN error text;

CREATE INDEX publications_pending_idx ON publications (status) WHERE status IN ('approved','publishing');

-- Каналы, которые платформа умеет публиковать.
INSERT INTO channels (id, name, kind, is_paid) VALUES
    ('facebook',  'Facebook',  'social', false),
    ('instagram', 'Instagram', 'social', false),
    ('linkedin',  'LinkedIn',  'social', false),
    ('telegram',  'Telegram',  'social', false),
    ('google-organic', 'Google Organic', 'search', false),
    ('google-ads', 'Google Ads', 'ads', true),
    ('point-md',  'point.md',  'local',  false),
    ('999-md',    '999.md',    'marketplace', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
