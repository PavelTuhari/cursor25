import type { PlaybookFrontMatter } from '@seo/playbook-engine';
import type { Db } from '../db.js';
import type { RunOutcome, SessionRunner } from './types.js';

/**
 * Рабочий цикл: забирает запуски из очереди и исполняет их.
 *
 * Одна сессия = одна строка task_runs. Захват делается атомарно, чтобы
 * несколько воркеров не взяли один и тот же запуск.
 */

interface QueuedRun {
  id: string;
  playbook_id: string;
  site_id: string;
  content: string;
  front_matter: PlaybookFrontMatter;
}

export interface WorkerOptions {
  db: Db;
  runner: SessionRunner;
  /** Разрешить запуск при неполном наборе инструментов. По умолчанию нет. */
  allowMissingTools?: boolean;
}

export class RunWorker {
  constructor(private readonly options: WorkerOptions) {}

  /**
   * Забирает один запуск из очереди. UPDATE ... RETURNING со скачком через
   * подзапрос с блокировкой: без него два воркера получили бы один запуск.
   */
  async claim(): Promise<QueuedRun | null> {
    const { rows } = await this.options.db.query<{ id: string }>(
      `UPDATE task_runs
          SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM task_runs
           WHERE status = 'queued'
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
      RETURNING id`,
    );
    const claimed = rows[0];
    if (!claimed) return null;

    const detail = await this.options.db.query<QueuedRun>(
      `SELECT r.id, r.playbook_id, r.site_id, p.content, p.front_matter
         FROM task_runs r
         JOIN playbooks p ON p.id = r.playbook_id
        WHERE r.id = $1`,
      [claimed.id],
    );
    return detail.rows[0] ?? null;
  }

  /** Исполняет один запуск и записывает результат. Возвращает false, если очередь пуста. */
  async processOne(): Promise<boolean> {
    const run = await this.claim();
    if (!run) return false;

    let outcome: RunOutcome;
    try {
      outcome = await this.options.runner.execute({
        run_id: run.id,
        content: run.content,
        front_matter: run.front_matter,
        allow_missing_tools: this.options.allowMissingTools === true,
      });
    } catch (error) {
      // Падение раннера не должно оставлять запуск висеть в running.
      outcome = {
        status: 'failed',
        report: { error: (error as Error).message },
        artifacts: [],
        cost: { tokens_in: 0, tokens_out: 0, external_calls: 0, amount: 0, currency: 'USD' },
        error: (error as Error).message,
      };
    }

    await this.persist(run.id, outcome);
    return true;
  }

  private async persist(runId: string, outcome: RunOutcome): Promise<void> {
    await this.options.db.query(
      `UPDATE task_runs
          SET status = $2, report = $3, error = $4, finished_at = now(),
              cost_tokens_in = $5, cost_tokens_out = $6, cost_external_calls = $7,
              cost_amount = $8, cost_currency = $9
        WHERE id = $1`,
      [
        runId,
        outcome.status,
        JSON.stringify(outcome.report),
        outcome.error ?? null,
        outcome.cost.tokens_in,
        outcome.cost.tokens_out,
        outcome.cost.external_calls,
        outcome.cost.amount,
        outcome.cost.currency,
      ],
    );

    for (const artifact of outcome.artifacts) {
      await this.options.db.query(
        `INSERT INTO artifacts (run_id, type, path, storage_key) VALUES ($1,$2,$3,$4)`,
        [runId, artifact.type, artifact.path, artifact.content ?? null],
      );
    }

    // target и run_id — разных типов (text и uuid), поэтому отдельные параметры:
    // один плейсхолдер на обе колонки Postgres вывести не может.
    await this.options.db.query(
      `INSERT INTO audit_log (actor, actor_kind, action, target, run_id, payload)
       VALUES ('worker', 'ai_session', 'run.finish', $1, $2, $3)`,
      [runId, runId, JSON.stringify({ status: outcome.status, cost: outcome.cost })],
    );
  }

  /** Непрерывный цикл: разбирает очередь, затем спит до следующей проверки. */
  async loop(signal: AbortSignal, idleMs = 3_000): Promise<void> {
    while (!signal.aborted) {
      let processed = false;
      try {
        processed = await this.processOne();
      } catch (error) {
        console.error('[worker] ошибка обработки очереди:', (error as Error).message);
      }
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, idleMs));
      }
    }
  }
}
