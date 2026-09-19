import Link from 'next/link';
import { api, type Site, type TaskRun } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  let sites: Site[];
  let runs: TaskRun[] = [];
  try {
    sites = (await api.get<{ items: Site[] }>('/sites')).items;
  } catch (error) {
    return (
      <>
        <h1>Портфель сайтов</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  // Сессии берём один раз и раскладываем по сайтам: столько же запросов,
  // сколько при одном сайте, и не растёт с их количеством.
  try {
    runs = (await api.get<{ items: TaskRun[] }>('/runs')).items ?? [];
  } catch {
    runs = [];
  }
  const runsBySite = new Map<string, TaskRun[]>();
  for (const run of runs) {
    const list = runsBySite.get(run.site_id) ?? [];
    list.push(run);
    runsBySite.set(run.site_id, list);
  }

  return (
    <>
      <h1>Портфель сайтов</h1>
      <p className="lede">
        Каждый сайт продвигается собственными AI-сессиями. Затраты относятся на подразделение
        UNA (DIV), указанное в профиле, — без него документы контура не с чем связать.
      </p>

      {sites.length === 0 ? (
        <div className="card empty">
          Ни одного сайта не заведено. Сайт добавляется через API:{' '}
          <span className="mono">POST /sites</span>
        </div>
      ) : (
        <div className="grid">
          {sites.map((site) => {
            const siteRuns = runsBySite.get(site.id) ?? [];
            const active = siteRuns.filter((r) => r.status === 'running').length;
            const waiting = siteRuns.filter((r) => r.status === 'awaiting_approval').length;
            return (
              <article key={site.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Link href={`/sites/${site.id}`} style={{ fontWeight: 600, fontSize: 16 }}>
                    {site.domain}
                  </Link>
                  {site.una_div ? (
                    <span className="tag accent">DIV {site.una_div}</span>
                  ) : (
                    <span className="tag warn">нет DIV</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>
                  {site.niche || 'ниша не указана'}
                </div>
                <div className="row">
                  {site.locales.map((locale) => (
                    <span key={locale} className="tag">
                      {locale}
                    </span>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 12, fontSize: 13 }}>
                  <span className="muted">Сессий: {siteRuns.length}</span>
                  {active > 0 && <span className="tag accent">выполняется {active}</span>}
                  {waiting > 0 && <span className="tag warn">ждут Approve {waiting}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
