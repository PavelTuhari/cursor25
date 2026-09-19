import { api, AUTONOMY_TITLES, PHASE_TITLES, type Site, type Template } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { GenerateForm } from './GenerateForm';

export const dynamic = 'force-dynamic';

export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { site: preselected } = await searchParams;
  let templates: Template[];
  let sites: Site[];
  try {
    [templates, sites] = await Promise.all([
      api.get<{ items: Template[] }>('/templates').then((r) => r.items),
      api.get<{ items: Site[] }>('/sites').then((r) => r.items),
    ]);
  } catch (error) {
    return (
      <>
        <h1>Плейбуки</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  const byPhase = new Map<number, Template[]>();
  for (const template of templates) {
    byPhase.set(template.phase, [...(byPhase.get(template.phase) ?? []), template]);
  }

  return (
    <>
      <h1>Плейбуки</h1>
      <p className="lede">
        Плейбук — исполняемый .md с контекстом, задачами, ограничениями и форматом отчёта.
        Генерация детерминирована: те же входные данные дают тот же файл.
      </p>

      <GenerateForm sites={sites} templates={templates} preselectedSite={preselected} />

      <h2>Библиотека шаблонов</h2>
      <div className="stack">
        {[...byPhase.keys()]
          .sort((a, b) => a - b)
          .map((phase) => (
            <section key={phase}>
              <div className="row" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>
                  Фаза {phase}. {PHASE_TITLES[phase] ?? ''}
                </strong>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>Код</th>
                      <th>Название</th>
                      <th style={{ width: 170 }}>Автономия</th>
                      <th style={{ width: 160 }}>Периодичность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(byPhase.get(phase) ?? []).map((template) => (
                      <tr key={template.code}>
                        <td className="mono">
                          {template.code}
                          <div className="muted" style={{ fontSize: 12 }}>
                            v{template.version}
                          </div>
                        </td>
                        <td>
                          {template.title}
                          <div className="hint">
                            Параметры:{' '}
                            {template.params.length === 0
                              ? 'нет'
                              : template.params
                                  .map((p) => `${p.name}${p.required ? '*' : ''}`)
                                  .join(', ')}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`tag ${
                              template.autonomy === 'L3' || template.autonomy === 'L4'
                                ? 'warn'
                                : 'accent'
                            }`}
                          >
                            {template.autonomy}
                          </span>
                          <div className="hint">{AUTONOMY_TITLES[template.autonomy]}</div>
                        </td>
                        <td className="muted">{template.cadence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>
    </>
  );
}
