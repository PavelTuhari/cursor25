'use client';

import { useState } from 'react';
import type { Schedule } from './page';
import { deleteScheduleAction, toggleScheduleAction } from './actions';

const dt = (value: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'UTC' }) : '—';

export function ScheduleRow({ schedule }: { schedule: Schedule }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; message: string }>) {
    setPending(true);
    setError(null);
    const result = await fn();
    if (!result.ok) setError(result.message);
    setPending(false);
  }

  return (
    <tr>
      <td>
        <div className="mono">{schedule.domain}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {schedule.template_code}
          {schedule.name ? ` — ${schedule.name}` : ''}
        </div>
      </td>
      <td className="mono">{schedule.cron}</td>
      <td className="muted mono" style={{ fontSize: 12 }}>
        {schedule.enabled ? dt(schedule.next_run_at) : '—'}
      </td>
      <td className="muted mono" style={{ fontSize: 12 }}>
        {dt(schedule.last_run_at)}
      </td>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <span className={schedule.enabled ? 'tag ok' : 'tag'}>
            {schedule.enabled ? 'включено' : 'выключено'}
          </span>
          <button
            disabled={pending}
            onClick={() => act(() => toggleScheduleAction(schedule.id, !schedule.enabled))}
          >
            {schedule.enabled ? 'Выключить' : 'Включить'}
          </button>
          <button disabled={pending} onClick={() => act(() => deleteScheduleAction(schedule.id))}>
            Удалить
          </button>
        </div>
        {schedule.last_error && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            Последняя ошибка: {schedule.last_error}
          </div>
        )}
        {error && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}
