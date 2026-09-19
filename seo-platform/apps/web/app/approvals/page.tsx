import { api, type Artifact } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { ApprovalRow } from './ApprovalRow';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  let items: Artifact[];
  try {
    items = (await api.get<{ items: Artifact[] }>('/approvals')).items;
  } catch (error) {
    return (
      <>
        <h1>Очередь утверждения</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  return (
    <>
      <h1>Очередь утверждения</h1>
      <p className="lede">
        Ни одно публичное действие не проходит мимо человека. AI-сессия утвердить артефакт
        не может — это правило продублировано в API и в пакетах UNA.
      </p>

      {items.length === 0 ? (
        <div className="card empty">Очередь пуста — всё утверждено или отклонено.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Тип</th>
                <th>Артефакт</th>
                <th style={{ width: 160 }}>Создан</th>
                <th style={{ width: 300 }}>Решение</th>
              </tr>
            </thead>
            <tbody>
              {items.map((artifact) => (
                <ApprovalRow key={artifact.id} artifact={artifact} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
