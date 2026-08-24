-- Каналы, площадки, публикации, метрики.

BEGIN;

CREATE TABLE channels (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('search','social','marketplace','local','email','pr','ads')),
    -- COD1 соответствующего элемента раздела TMS_SYSS ('W',1) в UNA.
    una_syss_cod1 integer,
    is_paid     boolean NOT NULL DEFAULT false,
    is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE platforms (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    url             text NOT NULL,
    channel_id      text NOT NULL REFERENCES channels(id),
    geo             text[] NOT NULL DEFAULT '{}',
    has_api         boolean NOT NULL DEFAULT false,
    -- Если у площадки нет API либо автоматизация против её правил — публикует человек.
    manual_publish_required boolean NOT NULL DEFAULT false,
    quality_score   numeric(4,2) CHECK (quality_score BETWEEN 0 AND 10),
    posting_rules   text NOT NULL DEFAULT '',
    rate_limit_per_day integer,
    -- COD контрагента в TMS_UNIVERS (TIP='OE'), если площадка ещё и поставщик услуг.
    una_univers_cod integer,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platforms_channel_idx ON platforms (channel_id) WHERE is_active;

-- Факт публикации. Ссылка на документ UNA появляется после регистрации
-- через PK_SEO_POST.REGISTER_PUBLICATION.
CREATE TABLE publications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    channel_id      text NOT NULL REFERENCES channels(id),
    platform_id     uuid REFERENCES platforms(id),
    artifact_id     uuid REFERENCES artifacts(id),
    run_id          uuid REFERENCES task_runs(id),
    campaign_code   text,
    locale          text NOT NULL,
    format          text NOT NULL,
    title           text NOT NULL DEFAULT '',
    external_url    text,
    published_at    timestamptz,
    cost_amount     numeric(14,2) NOT NULL DEFAULT 0,
    cost_currency   char(3) NOT NULL DEFAULT 'MDL',
    una_doc_no      text,
    metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX publications_site_idx ON publications (site_id, published_at DESC);
CREATE INDEX publications_campaign_idx ON publications (campaign_code) WHERE campaign_code IS NOT NULL;
-- Один и тот же URL не должен регистрироваться дважды.
CREATE UNIQUE INDEX publications_url_uniq ON publications (external_url) WHERE external_url IS NOT NULL;

CREATE TABLE keywords (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    phrase          text NOT NULL,
    locale          text NOT NULL,
    volume          integer,
    difficulty      numeric(5,2),
    intent          text CHECK (intent IN ('informational','commercial','transactional','navigational','local')),
    cluster         text,
    target_url      text,
    priority_score  numeric(8,3),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, phrase, locale)
);

CREATE INDEX keywords_cluster_idx ON keywords (site_id, cluster);

CREATE TABLE rankings (
    id          bigserial PRIMARY KEY,
    keyword_id  uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    engine      text NOT NULL DEFAULT 'google.md',
    device      text NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop','mobile')),
    position    integer,
    url         text,
    in_ai_overview boolean NOT NULL DEFAULT false,
    checked_at  date NOT NULL,
    UNIQUE (keyword_id, engine, device, checked_at)
);

CREATE INDEX rankings_recent_idx ON rankings (keyword_id, checked_at DESC);

CREATE TABLE alerts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     uuid REFERENCES sites(id) ON DELETE CASCADE,
    type        text NOT NULL,
    severity    text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    title       text NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alerts_open_idx ON alerts (site_id, severity, created_at DESC) WHERE resolved_at IS NULL;

COMMIT;
