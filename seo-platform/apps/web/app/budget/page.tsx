import { api, type Site } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { BudgetPanel } from './BudgetPanel';

export const dynamic = 'force-dynamic';

export default async function BudgetPage() {
  let sites: Site[];
  try {
    sites = (await api.get<{ items: Site[] }>('/sites')).items;
  } catch (error) {
    return (
      <>
        <h1>Бюджет и документы</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  const divs = [...new Set(sites.map((s) => s.una_div).filter((d): d is string => Boolean(d)))];

  return (
    <>
      <h1>Бюджет и документы</h1>
      <p className="lede">
        Решение об остатке принимает UNA (<span className="mono">PK_SEO_BUDGET.CHECK_LIMIT</span>),
        а не панель: кэш на стороне платформы может отставать, а деньги — нет.
      </p>

      {divs.length === 0 && (
        <div className="notice info" style={{ marginBottom: 18 }}>
          Ни у одного сайта не задано подразделение UNA (DIV) — проверку бюджета не к чему привязать.
        </div>
      )}

      <BudgetPanel divs={divs} />
    </>
  );
}
