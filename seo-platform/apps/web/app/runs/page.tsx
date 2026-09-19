import { api, type TaskRun } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';

export const dynamic = 'force-dynamic';

const STATUS_TAG: Record<string, string> = {
  queued: 'tag',
  running: 'tag accent',
  awaiting_approval: 'tag warn',
  success: 'tag ok',
  partial: 'tag warn',
  failed: 'tag danger',
  cancelled: 'tag',
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'в очереди',
  running: 'выполняется',
  awaiting_approval: 'ждёт Approve',
  success: 'успех',
  partial: 'частично',
  failed: 'ошибка',
  cancelled: 'отменена',
};

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} ${currency}` : '—';
}

export default async function RunsPage() {
  let runs: TaskRun[];
  try {
    runs = (await api.get<{ items: TaskRun[] }>('/runs')).items;
  } catch (error) {
    return (
      <>
        <h1>Сессии</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  const spent = runs.reduce((sum, run) => sum + Number(run.cost_amount || 0), 0);
  const tokens = runs.reduce(
    (sum, run) => sum + Number(run.cost_tokens_in || 0) + Number(run.cost_tokens_out || 0),
    0,
  );

  return (
    <>
      <h1>Сессии</h1>
      <p className="lede">
        Расход токенов — такая же статья маркетингового бюджета, как реклама. Без неё
        экономика канала посчитана неверно.
      </p>

      <div className="row" style={{ marginBottom: 18, gap: 24 }}>
        <div className="card" style={{ flex: '1 1 160px' }}>
          <div className="muted" style={{ fontSize: 13 }}>Всего сессий</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{runs.length}</div>
        </div>
        <div className="card" style={{ flex: '1 1 160px' }}>
          <div className="muted" style={{ fontSize: 13 }}>Токенов израсходовано</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{tokens.toLocaleString('ru-RU')}</div>
        </div>
        <div className="card" style={{ flex: '1 1 160px' }}>
          <div className="muted" style={{ fontSize: 13 }}>Стоимость</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{spent > 0 ? spent.toFixed(2) : '0.00'}</div>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="card empty">Сессий ещё не было.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Статус</th>
                <th>Режим</th>
                <th>Запуск</th>
                <th>Старт</th>
                <th>Токены</th>
                <th>Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <span className={STATUS_TAG[run.status] ?? 'tag'}>
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                    {run.error && (
                      <div className="hint" style={{ color: 'var(--danger)' }}>{run.error}</div>
                    )}
                  </td>
                  <td>
                    <span className={run.run_mode === 'execute' ? 'tag warn' : 'tag'}>
                      {run.run_mode}
                    </span>
                  </td>
                  <td className="muted">{run.trigger}</td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {run.started_at ? new Date(run.started_at).toLocaleString('ru-RU') : '—'}
                  </td>
                  <td className="mono">
                    {(Number(run.cost_tokens_in) + Number(run.cost_tokens_out)).toLocaleString('ru-RU')}
                  </td>
                  <td className="mono">{formatMoney(run.cost_amount, run.cost_currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
