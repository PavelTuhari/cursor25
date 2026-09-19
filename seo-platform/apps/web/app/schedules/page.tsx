import { api, type Site, type Template } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { ScheduleForm } from './ScheduleForm';
import { ScheduleRow } from './ScheduleRow';

export const dynamic = 'force-dynamic';

export interface Schedule {
  id: string;
  domain: string;
  template_code: string;
  name: string;
  cron: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
}

export default async function SchedulesPage() {
  let items: Schedule[];
  let sites: Site[];
  let templates: Template[];
  try {
    [items, sites, templates] = await Promise.all([
      api.get<{ items: Schedule[] }>('/schedules').then((r) => r.items),
      api.get<{ items: Site[] }>('/sites').then((r) => r.items),
      api.get<{ items: Template[] }>('/templates').then((r) => r.items),
    ]);
  } catch (error) {
    return (
      <>
        <h1>Расписания</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  return (
    <>
      <h1>Расписания</h1>
      <p className="lede">
        Срабатывание генерирует плейбук и ставит запуск в очередь. Исполнит его раннер —
        и только если он включён. Время в расписаниях — UTC.
      </p>

      <ScheduleForm sites={sites} templates={templates} />

      {items.length === 0 ? (
        <div className="card empty">Расписаний нет.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Сайт и шаблон</th>
                <th style={{ width: 130 }}>Cron (UTC)</th>
                <th style={{ width: 170 }}>Следующий запуск</th>
                <th style={{ width: 170 }}>Последний запуск</th>
                <th style={{ width: 200 }}>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {items.map((schedule) => (
                <ScheduleRow key={schedule.id} schedule={schedule} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
