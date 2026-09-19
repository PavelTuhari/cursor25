'use client';

import { useMemo, useState } from 'react';
import type { Site, Template } from '@/lib/api';
import { createScheduleAction } from './actions';

/** Готовые расписания: типовые случаи не должны требовать знания cron. */
const PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Ежедневно в 06:00 UTC', cron: '0 6 * * *' },
  { label: 'По понедельникам в 06:00', cron: '0 6 * * 1' },
  { label: 'Каждый час', cron: '0 * * * *' },
  { label: '1-го числа в 07:00', cron: '0 7 1 * *' },
];

export function ScheduleForm({ sites, templates }: { sites: Site[]; templates: Template[] }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [code, setCode] = useState(templates[0]?.code ?? '');
  const [cron, setCron] = useState(PRESETS[1]!.cron);
  const [name, setName] = useState('');
  const [params, setParams] = useState('{}');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const template = useMemo(() => templates.find((t) => t.code === code), [templates, code]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(params || '{}');
      } catch (error) {
        setResult({ ok: false, message: `Параметры не разобрались как JSON: ${(error as Error).message}` });
        return;
      }
      setResult(
        await createScheduleAction({
          site_id: siteId,
          template_code: code,
          name,
          cron,
          params: parsed as Record<string, unknown>,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (sites.length === 0) {
    return <div className="card muted" style={{ marginBottom: 24 }}>Сначала заведите сайт.</div>;
  }

  return (
    <section className="card" style={{ marginBottom: 28 }}>
      <form onSubmit={onSubmit}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="s-site">Сайт</label>
            <select id="s-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.domain}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '2 1 300px' }}>
            <label htmlFor="s-template">Шаблон</label>
            <select id="s-template" value={code} onChange={(e) => setCode(e.target.value)}>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>{t.code} — {t.title}</option>
              ))}
            </select>
            {template && <div className="hint">Рекомендуемая периодичность: {template.cadence}</div>}
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="s-cron">Расписание (cron, UTC)</label>
            <input id="s-cron" value={cron} onChange={(e) => setCron(e.target.value)} className="mono" />
            <div className="row" style={{ marginTop: 6, gap: 6 }}>
              {PRESETS.map((preset) => (
                <button key={preset.cron} type="button" onClick={() => setCron(preset.cron)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="s-name">Название</label>
            <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Еженедельная статья" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="s-params">Параметры шаблона (JSON)</label>
          <textarea id="s-params" value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
          {template && template.params.length > 0 && (
            <div className="hint">
              Обязательные: {template.params.filter((p) => p.required).map((p) => p.name).join(', ') || 'нет'}
            </div>
          )}
        </div>

        <button className="primary" type="submit" disabled={pending}>
          {pending ? 'Создание…' : 'Создать расписание'}
        </button>
      </form>

      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'error'}`} style={{ marginTop: 14 }}>
          {result.message}
        </div>
      )}
    </section>
  );
}
