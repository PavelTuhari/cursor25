import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type Site } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let site: Site | undefined;
  try {
    const sites = (await api.get<{ items: Site[] }>('/sites')).items;
    site = sites.find((s) => s.id === id);
  } catch (error) {
    return <ErrorNotice error={error} />;
  }
  if (!site) notFound();

  const rows: Array<[string, React.ReactNode]> = [
    ['Домен', <span className="mono">{site.domain}</span>],
    ['Ниша', site.niche || '—'],
    ['Описание', site.description || '—'],
    ['Аудитория', site.audience || '—'],
    ['Tone of voice', site.tone_of_voice || '—'],
    ['Локали', site.locales.join(', ')],
    ['Гео', site.geo.length ? site.geo.join(', ') : '—'],
    ['Конкуренты', site.competitors.length ? site.competitors.join(', ') : '—'],
    [
      'Подразделение UNA (DIV)',
      site.una_div ? (
        <span className="mono">{site.una_div}</span>
      ) : (
        <span className="tag warn">не задано — затраты некуда относить</span>
      ),
    ],
  ];

  return (
    <>
      <h1>{site.name}</h1>
      <p className="lede">
        Профиль подставляется в каждый плейбук: контекст, тональность и запреты попадают
        в текст задачи для AI-сессии.
      </p>

      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th style={{ width: 220 }}>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Запретные утверждения</h2>
      {site.banned_claims.length === 0 ? (
        <div className="card muted">
          Список пуст. Это значит, что валидатор не отловит рискованную формулировку в тексте —
          заполните его до запуска контентных плейбуков.
        </div>
      ) : (
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {site.banned_claims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="row" style={{ marginTop: 24 }}>
        <Link className="btn" href={`/playbooks?site=${site.id}`}>
          Сгенерировать плейбук
        </Link>
        <Link className="btn" href="/runs">
          Сессии
        </Link>
      </div>
    </>
  );
}
