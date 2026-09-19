'use client';

import { useMemo, useState } from 'react';
import type { Site, Template } from '@/lib/api';
import { generatePlaybookAction, type GenerateResult } from './actions';

/**
 * Форма генерации плейбука.
 *
 * Параметры вводятся одним JSON-объектом, а не набором полей: состав параметров
 * задаётся шаблоном и меняется вместе с ним, поэтому жёсткая форма устаревала бы
 * при каждом обновлении библиотеки. Подсказка по составу берётся из params_schema.
 */
export function GenerateForm({
  sites,
  templates,
  preselectedSite,
}: {
  sites: Site[];
  templates: Template[];
  preselectedSite?: string;
}) {
  const [siteId, setSiteId] = useState(preselectedSite ?? sites[0]?.id ?? '');
  const [code, setCode] = useState(templates[0]?.code ?? '');
  const [params, setParams] = useState('{}');
  const [techUser, setTechUser] = useState('SEO_AI_BOT');
  const [secretRef, setSecretRef] = useState('vault://una/seo-ai-bot');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const template = useMemo(() => templates.find((t) => t.code === code), [templates, code]);
  const needsUna = template?.phase === 6;

  const fillExample = () => {
    if (!template) return;
    const example: Record<string, unknown> = {};
    for (const param of template.params) {
      if (!param.required) continue;
      example[param.name] =
        param.type === 'number' ? 0 : param.type === 'boolean' ? false : param.type.endsWith('[]') ? [] : '';
    }
    setParams(JSON.stringify(example, null, 2));
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(params || '{}');
      } catch (error) {
        setResult({ ok: false, error: `Параметры не разобрались как JSON: ${(error as Error).message}` });
        return;
      }
      setResult(
        await generatePlaybookAction({
          site_id: siteId,
          template_code: code,
          params: parsed as Record<string, unknown>,
          una: needsUna ? { tech_user: techUser, secret_ref: secretRef } : undefined,
        }),
      );
    } finally {
      setPending(false);
    }
  }

  if (sites.length === 0) {
    return (
      <div className="card muted" style={{ marginBottom: 24 }}>
        Сначала заведите сайт — генерировать плейбук не для кого.
      </div>
    );
  }

  return (
    <section className="card" style={{ marginBottom: 28 }}>
      <form onSubmit={onSubmit}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="site">Сайт</label>
            <select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.domain}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '2 1 320px' }}>
            <label htmlFor="template">Шаблон</label>
            <select id="template" value={code} onChange={(e) => setCode(e.target.value)}>
              {templates.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} — {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {template && template.params.length > 0 && (
          <div className="hint" style={{ marginBottom: 10 }}>
            {template.params.map((p) => (
              <div key={p.name}>
                <span className="mono">{p.name}</span> ({p.type}
                {p.required ? ', обязателен' : ''}) — {p.description}
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="params">Параметры (JSON)</label>
            <button type="button" onClick={fillExample}>
              Подставить заготовку
            </button>
          </div>
          <textarea id="params" value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
        </div>

        {needsUna && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="techUser">Технический пользователь UNA</label>
              <input id="techUser" value={techUser} onChange={(e) => setTechUser(e.target.value)} />
              <div className="hint">Без прав проведения, оплаты и правки справочников</div>
            </div>
            <div className="field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="secretRef">Ссылка на секрет</label>
              <input id="secretRef" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} />
              <div className="hint">Только vault://… — пароль в плейбук не попадает никогда</div>
            </div>
          </div>
        )}

        <button className="primary" type="submit" disabled={pending || !siteId}>
          {pending ? 'Генерация…' : 'Сгенерировать'}
        </button>
      </form>

      {result && !result.ok && (
        <div className="notice error" style={{ marginTop: 16 }}>
          <strong>Плейбук не сгенерирован</strong>
          <div style={{ marginTop: 6 }}>{result.error}</div>
          {result.details !== undefined && result.details !== null && (
            <pre style={{ marginTop: 10 }}>{JSON.stringify(result.details, null, 2)}</pre>
          )}
        </div>
      )}

      {result && result.ok && (
        <div style={{ marginTop: 16 }}>
          <div className="notice ok">
            Готов: <span className="mono">{result.file_path}</span>
          </div>
          {result.warnings.length > 0 && (
            <div className="notice info" style={{ marginTop: 10 }}>
              Предупреждения валидатора:
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {result.warnings.map((w) => (
                  <li key={w.code}>
                    <span className="mono">{w.code}</span> — {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <pre style={{ marginTop: 12 }}>{result.content}</pre>
        </div>
      )}
    </section>
  );
}
