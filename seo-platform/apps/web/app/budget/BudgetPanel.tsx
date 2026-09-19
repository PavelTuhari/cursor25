'use client';

import { useState } from 'react';
import type { BudgetCheck } from '@/lib/api';
import { checkBudgetAction, createDocumentAction } from './actions';

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function BudgetPanel({ divs }: { divs: string[] }) {
  const [div, setDiv] = useState(divs[0] ?? '');
  const [period, setPeriod] = useState(currentPeriod());
  const [article, setArticle] = useState('');
  const [amount, setAmount] = useState('1000');
  const [check, setCheck] = useState<BudgetCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [sysfid, setSysfid] = useState('WSEO03');
  const [extId, setExtId] = useState('');
  const [docResult, setDocResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onCheck(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setCheck(null);
    setCheckError(null);
    const result = await checkBudgetAction({ div, period, article, amount: Number(amount) });
    if (result.ok) setCheck(result.check);
    else setCheckError(result.message);
    setPending(false);
  }

  async function onCreateDoc(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setDocResult(await createDocumentAction({ div, sysfid, ext_id: extId, period }));
    setPending(false);
  }

  return (
    <div className="stack">
      <section className="card">
        <strong>Проверка лимита</strong>
        <form onSubmit={onCheck} style={{ marginTop: 12 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <div className="field" style={{ flex: '1 1 130px' }}>
              <label htmlFor="div">DIV</label>
              {divs.length > 0 ? (
                <select id="div" value={div} onChange={(e) => setDiv(e.target.value)}>
                  {divs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <input id="div" value={div} onChange={(e) => setDiv(e.target.value)} />
              )}
            </div>
            <div className="field" style={{ flex: '1 1 130px' }}>
              <label htmlFor="period">Период</label>
              <input id="period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-09" />
            </div>
            <div className="field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="article">Статья бюджета</label>
              <input id="article" value={article} onChange={(e) => setArticle(e.target.value)} placeholder="CONTEXT" />
            </div>
            <div className="field" style={{ flex: '1 1 130px' }}>
              <label htmlFor="amount">Сумма, MDL</label>
              <input id="amount" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <button className="primary" type="submit" disabled={pending || !div || !article}>
            Проверить
          </button>
        </form>

        {checkError && (
          <div className="notice error" style={{ marginTop: 14 }}>
            {checkError}
          </div>
        )}

        {check && (
          <div style={{ marginTop: 14 }}>
            <div className={`notice ${check.is_allowed ? 'ok' : 'error'}`}>
              {check.is_allowed
                ? 'Расход укладывается в остаток'
                : `Заблокировано: ${check.reason ?? 'превышение лимита'}`}
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <tbody>
                  <tr>
                    <th>План</th>
                    <td className="mono">{check.plan.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <th>Законтрактовано</th>
                    <td className="mono">{check.committed.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <th>Факт</th>
                    <td className="mono">{check.actual.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <th>Доступно</th>
                    <td className="mono">
                      <strong>{check.available.toFixed(2)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <th>Освоено</th>
                    <td>
                      {check.used_pct === null ? (
                        '—'
                      ) : (
                        <span className={check.used_pct >= 80 ? 'tag warn' : 'tag'}>
                          {check.used_pct}%
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <strong>Черновик документа в UNA</strong>
        <div className="hint" style={{ marginTop: 4 }}>
          Создаётся только черновик. Проведение, оплата и согласование — вне панели и вне AI.
        </div>
        <form onSubmit={onCreateDoc} style={{ marginTop: 12 }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <div className="field" style={{ flex: '1 1 150px' }}>
              <label htmlFor="sysfid">Тип документа</label>
              <input id="sysfid" value={sysfid} onChange={(e) => setSysfid(e.target.value)} placeholder="WSEO03" />
            </div>
            <div className="field" style={{ flex: '2 1 240px' }}>
              <label htmlFor="extId">Ключ идемпотентности</label>
              <input id="extId" value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="mediaplan:2026-09" />
              <div className="hint">Повтор с тем же ключом вернёт существующий документ</div>
            </div>
          </div>
          <button type="submit" disabled={pending || !div || !extId}>
            Создать черновик
          </button>
        </form>
        {docResult && (
          <div className={`notice ${docResult.ok ? 'ok' : 'error'}`} style={{ marginTop: 14 }}>
            {docResult.message}
          </div>
        )}
      </section>
    </div>
  );
}
