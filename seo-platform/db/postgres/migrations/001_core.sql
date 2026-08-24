-- Платформа AI-SEO: оперативные данные.
-- Финансы и юридически значимые документы здесь НЕ хранятся — их источник истины UNA.md
-- (см. ТЗ часть II). В этой схеме живут только ссылки на документы UNA и метрики.

BEGIN;

CREATE TABLE sites (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain          text NOT NULL UNIQUE,
    name            text NOT NULL,
    locales         text[] NOT NULL CHECK (cardinality(locales) > 0),
    geo             text[] NOT NULL DEFAULT '{}',
    niche           text NOT NULL DEFAULT '',
    description     text NOT NULL DEFAULT '',
    audience        text NOT NULL DEFAULT '',
    tone_of_voice   text NOT NULL DEFAULT '',
    banned_claims   text[] NOT NULL DEFAULT '{}',
    competitors     text[] NOT NULL DEFAULT '{}',
    -- Подразделение UNA (TMDB_DOCS.DIV), на которое относятся затраты сайта.
    una_div         text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN sites.una_div IS 'DIV в UNA: разрез затрат по сайту в TMDB_CM.DTDIV/CTDIV';

-- Библиотека шаблонов плейбуков. Тело хранится как есть, чтобы шаблон
-- можно было отредактировать без выкладки кода.
CREATE TABLE playbook_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL,
    version         text NOT NULL,
    title           text NOT NULL,
    phase           smallint NOT NULL CHECK (phase BETWEEN 0 AND 6),
    autonomy        text NOT NULL CHECK (autonomy IN ('L0','L1','L2','L3','L4')),
    cadence         text NOT NULL DEFAULT '',
    defaults        jsonb NOT NULL,
    params_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,
    body            text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (code, version)
);

-- Сгенерированный плейбук. git_sha заполняется после коммита в репозиторий
-- плейбуков — именно на него ссылается запуск (ТЗ ч. I §8.3).
CREATE TABLE playbooks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    template_code       text NOT NULL,
    template_version    text NOT NULL,
    params              jsonb NOT NULL DEFAULT '{}'::jsonb,
    front_matter        jsonb NOT NULL,
    body                text NOT NULL,
    content             text NOT NULL,
    file_path           text NOT NULL,
    git_sha             text,
    generated_at        timestamptz NOT NULL,
    created_by          text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX playbooks_site_idx ON playbooks (site_id, generated_at DESC);
CREATE INDEX playbooks_template_idx ON playbooks (template_code, template_version);

-- Запуск AI-сессии по конкретному плейбуку.
CREATE TABLE task_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    playbook_id     uuid NOT NULL REFERENCES playbooks(id) ON DELETE RESTRICT,
    site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','awaiting_approval','success','partial','failed','cancelled')),
    run_mode        text NOT NULL CHECK (run_mode IN ('dry-run','execute')),
    trigger         text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','schedule','event')),
    started_at      timestamptz,
    finished_at     timestamptz,
    report          jsonb,
    error           text,
    -- Факт расхода: токены и внешние вызовы. Питает статью бюджета «AI-токены».
    cost_tokens_in      bigint NOT NULL DEFAULT 0,
    cost_tokens_out     bigint NOT NULL DEFAULT 0,
    cost_external_calls integer NOT NULL DEFAULT 0,
    cost_amount         numeric(14,4) NOT NULL DEFAULT 0,
    cost_currency       char(3) NOT NULL DEFAULT 'USD',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_runs_site_status_idx ON task_runs (site_id, status, created_at DESC);
CREATE INDEX task_runs_playbook_idx ON task_runs (playbook_id);

-- Артефакт сессии: текст, патч, JSON-отчёт. Approval фиксируется здесь.
CREATE TABLE artifacts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    type            text NOT NULL,
    path            text NOT NULL,
    storage_key     text,
    checksum        text,
    approved_by     text,
    approved_at     timestamptz,
    rejected_reason text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT artifacts_approval_consistent
        CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE INDEX artifacts_run_idx ON artifacts (run_id);
CREATE INDEX artifacts_pending_idx ON artifacts (created_at) WHERE approved_at IS NULL;

COMMIT;
