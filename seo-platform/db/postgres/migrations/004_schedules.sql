-- Расписания: что и когда генерировать и ставить в очередь.

BEGIN;

CREATE TABLE schedules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    template_code   text NOT NULL,
    name            text NOT NULL DEFAULT '',
    -- Cron из 5 полей, время UTC. Секунд нет: чаще раза в минуту
    -- SEO-задачи запускать незачем.
    cron            text NOT NULL,
    params          jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Блок una для плейбуков учётного контура (фаза 6).
    una             jsonb,
    run_mode        text CHECK (run_mode IN ('dry-run','execute')),
    enabled         boolean NOT NULL DEFAULT true,
    last_run_at     timestamptz,
    last_error      text,
    next_run_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, template_code, cron)
);

CREATE INDEX schedules_due_idx ON schedules (next_run_at) WHERE enabled;

COMMENT ON COLUMN schedules.next_run_at IS
    'Рассчитывается при создании и после каждого срабатывания; выборка по нему';

COMMIT;
