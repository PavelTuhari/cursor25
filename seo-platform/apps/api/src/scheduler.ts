import type { PlaybookTemplate, UnaBinding } from '@seo/playbook-engine';
import type { Db } from './db.js';
import { nextRunAt } from './cron.js';
import { createPlaybook } from './playbooks.js';

/**
 * Планировщик: превращает расписания в поставленные в очередь запуски.
 *
 * Сам ничего не исполняет — только генерирует плейбук и ставит запуск в
 * очередь. Исполняет раннер, и только если он включён.
 */

interface DueSchedule {
  id: string;
  site_id: string;
  template_code: string;
  params: Record<string, unknown>;
  una: UnaBinding | null;
  run_mode: 'dry-run' | 'execute' | null;
  cron: string;
}

export interface TickResult {
  checked: number;
  queued: Array<{ schedule_id: string; playbook_id: string; run_id: string }>;
  failed: Array<{ schedule_id: string; error: string }>;
}

export class Scheduler {
  constructor(
    private readonly db: Db,
    private readonly templates: Map<string, PlaybookTemplate>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Расписания, которым пора сработать. */
  private async due(): Promise<DueSchedule[]> {
    const { rows } = await this.db.query<DueSchedule>(
      `SELECT id, site_id, template_code, params, una, run_mode, cron
         FROM schedules
        WHERE enabled AND (next_run_at IS NULL OR next_run_at <= $1)
        ORDER BY next_run_at NULLS FIRST`,
      [this.now().toISOString()],
    );
    return rows;
  }

  /**
   * Один проход планировщика.
   *
   * Ошибка одного расписания не должна останавливать остальные: сломанные
   * параметры одной задачи не повод не снять позиции по всем сайтам.
   */
  async tick(): Promise<TickResult> {
    const schedules = await this.due();
    const result: TickResult = { checked: schedules.length, queued: [], failed: [] };

    for (const schedule of schedules) {
      const startedAt = this.now();
      try {
        const playbook = await createPlaybook(
          this.db,
          this.templates,
          {
            site_id: schedule.site_id,
            template_code: schedule.template_code,
            params: schedule.params ?? {},
            run_mode: schedule.run_mode ?? undefined,
            una: schedule.una ?? undefined,
            created_by: 'scheduler',
          },
          startedAt.toISOString(),
        );

        const fm = playbook.front_matter as { run_mode?: string };
        const run = await this.db.query<{ id: string }>(
          `INSERT INTO task_runs (playbook_id, site_id, status, run_mode, trigger)
           VALUES ($1,$2,'queued',$3,'schedule') RETURNING id`,
          [playbook.id, schedule.site_id, fm.run_mode ?? 'dry-run'],
        );

        await this.advance(schedule, startedAt, null);
        result.queued.push({
          schedule_id: schedule.id,
          playbook_id: playbook.id,
          run_id: run.rows[0]!.id,
        });
      } catch (error) {
        // Расписание не отключаем: причина может быть временной. Но ошибку
        // сохраняем и сдвигаем время, иначе оно будет срабатывать в каждом тике.
        await this.advance(schedule, startedAt, (error as Error).message);
        result.failed.push({ schedule_id: schedule.id, error: (error as Error).message });
      }
    }
    return result;
  }

  private async advance(schedule: DueSchedule, at: Date, error: string | null): Promise<void> {
    const next = nextRunAt(schedule.cron, at);
    await this.db.query(
      `UPDATE schedules
          SET last_run_at = $2, next_run_at = $3, last_error = $4
        WHERE id = $1`,
      [schedule.id, at.toISOString(), next ? next.toISOString() : null, error],
    );
  }

  /** Фоновый цикл: проверяет расписания раз в минуту. */
  async loop(signal: AbortSignal, intervalMs = 60_000): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.tick();
        if (result.queued.length > 0 || result.failed.length > 0) {
          console.log(
            `[scheduler] поставлено в очередь: ${result.queued.length}, ошибок: ${result.failed.length}`,
          );
        }
      } catch (error) {
        console.error('[scheduler] ошибка прохода:', (error as Error).message);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
