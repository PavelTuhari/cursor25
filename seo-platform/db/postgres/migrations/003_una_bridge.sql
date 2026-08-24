-- Мост к UNA.md: кэш справочников, зеркало документов, идемпотентность синхронизации.
-- Здесь НЕТ проводок и сумм-первоисточников: всё это живёт в Oracle (схема UN4).
-- Платформа хранит только то, что нужно для UI и для контроля расхождений.

BEGIN;

-- Зеркало документов UNA. Мастер — Oracle; поля ниже кэш для панели и отчётов.
CREATE TABLE una_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- COD документа в TMDB_DOCS.
    una_cod         bigint NOT NULL,
    -- SYSFID: WSEO01..WSEO15 (ТЗ ч. II §22.1).
    doc_type        text NOT NULL,
    doc_no          text NOT NULL,
    doc_date        date NOT NULL,
    site_id         uuid REFERENCES sites(id) ON DELETE SET NULL,
    una_div         text,
    campaign_code   text,
    channel_id      text REFERENCES channels(id),
    counterparty    text,
    amount          numeric(16,2),
    currency        char(3),
    amount_mdl      numeric(16,2),
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','submitted','approved','rejected','in_progress','closed','cancelled')),
    is_posted       boolean NOT NULL DEFAULT false,
    -- Прослеживаемость: какой запуск какого плейбука породил документ (ТЗ ч. II §22.2).
    run_id          uuid REFERENCES task_runs(id) ON DELETE SET NULL,
    playbook_sha    text,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at       timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (doc_type, una_cod)
);

CREATE INDEX una_documents_site_idx ON una_documents (site_id, doc_date DESC);
CREATE INDEX una_documents_campaign_idx ON una_documents (campaign_code) WHERE campaign_code IS NOT NULL;
CREATE INDEX una_documents_open_idx ON una_documents (status) WHERE status IN ('draft','submitted');

-- Кросс-таблица идемпотентности (аналог YSEO_XREF на стороне платформы).
-- Повторная отправка той же сущности не создаёт второй документ в UNA.
CREATE TABLE una_xref (
    ext_system  text NOT NULL,
    ext_id      text NOT NULL,
    una_table   text NOT NULL,
    una_cod     bigint NOT NULL,
    content_hash text NOT NULL,
    direction   char(1) NOT NULL CHECK (direction IN ('I','O','B')),
    synced_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ext_system, ext_id)
);

CREATE INDEX una_xref_target_idx ON una_xref (una_table, una_cod);

-- Кэш справочников UNA: контрагенты, статьи бюджета, счета, каналы.
-- Мастер всегда в Oracle, платформа только читает (ТЗ ч. II §23.3, правило 1).
CREATE TABLE una_refs (
    ref_kind    text NOT NULL CHECK (ref_kind IN ('counterparty','account','budget_article','channel','currency','unit')),
    ref_code    text NOT NULL,
    name        text NOT NULL,
    attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_archived boolean NOT NULL DEFAULT false,
    synced_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ref_kind, ref_code)
);

-- Снимок бюджета из UNA для быстрых проверок в UI.
-- Решение о блокировке расхода принимает PK_SEO_BUDGET.CHECK_LIMIT в Oracle,
-- а не этот кэш: здесь данные могут отставать.
CREATE TABLE budget_snapshot (
    site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    period          text NOT NULL,
    article_code    text NOT NULL,
    channel_id      text REFERENCES channels(id),
    plan_amount     numeric(16,2) NOT NULL DEFAULT 0,
    committed_amount numeric(16,2) NOT NULL DEFAULT 0,
    actual_amount   numeric(16,2) NOT NULL DEFAULT 0,
    currency        char(3) NOT NULL DEFAULT 'MDL',
    available_amount numeric(16,2) GENERATED ALWAYS AS
        (plan_amount - committed_amount - actual_amount) STORED,
    synced_at       timestamptz NOT NULL DEFAULT now()
);

-- Уникальность с учётом того, что channel_id может быть NULL (бюджет статьи целиком).
-- Выражение в PRIMARY KEY Postgres не допускает, поэтому уникальный индекс.
CREATE UNIQUE INDEX budget_snapshot_uniq
    ON budget_snapshot (site_id, period, article_code, COALESCE(channel_id, ''));

-- Журнал сверки платформа <-> UNA (ТЗ ч. II §23.3, п. 6).
CREATE TABLE una_reconciliation (
    id              bigserial PRIMARY KEY,
    checked_at      timestamptz NOT NULL DEFAULT now(),
    period          text NOT NULL,
    doc_type        text NOT NULL,
    platform_count  integer NOT NULL,
    una_count       integer NOT NULL,
    platform_sum    numeric(16,2) NOT NULL,
    una_sum         numeric(16,2) NOT NULL,
    is_matched      boolean NOT NULL,
    details         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX una_reconciliation_mismatch_idx ON una_reconciliation (checked_at DESC) WHERE NOT is_matched;

-- Неизменяемый аудит внешних действий (ТЗ ч. I NFR-6).
CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    actor       text NOT NULL,
    actor_kind  text NOT NULL CHECK (actor_kind IN ('user','ai_session','system')),
    action      text NOT NULL,
    target      text NOT NULL,
    run_id      uuid,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_target_idx ON audit_log (target, created_at DESC);
CREATE INDEX audit_log_run_idx ON audit_log (run_id) WHERE run_id IS NOT NULL;

REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

COMMIT;
