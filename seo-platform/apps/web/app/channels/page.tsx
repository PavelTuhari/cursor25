import { api, type Site } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { ChannelForm } from './ChannelForm';
import { ChannelRow } from './ChannelRow';

export const dynamic = 'force-dynamic';

export interface ChannelAccount {
  id: string;
  domain: string;
  channel_id: string;
  external_id: string;
  display_name: string;
  credentials_ref: string;
  sandbox: boolean;
  enabled: boolean;
  rate_limit_per_day: number | null;
  published_today: number;
  last_checked_at: string | null;
  last_check_status: string | null;
  last_check_error: string | null;
}

export default async function ChannelsPage() {
  let items: ChannelAccount[];
  let sites: Site[];
  try {
    [items, sites] = await Promise.all([
      api.get<{ items: ChannelAccount[] }>('/channel-accounts').then((r) => r.items),
      api.get<{ items: Site[] }>('/sites').then((r) => r.items),
    ]);
  } catch (error) {
    return (
      <>
        <h1>Каналы</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  return (
    <>
      <h1>Каналы</h1>
      <p className="lede">
        В базе хранится только имя секрета, значение берётся из окружения. Заводите
        подключение в песочнице, проверяйте живой проверкой и лишь потом переводите в бой:
        публикация необратима.
      </p>

      <ChannelForm sites={sites} />

      {items.length === 0 ? (
        <div className="card empty">Подключений нет.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Канал и аккаунт</th>
                <th style={{ width: 190 }}>Секрет</th>
                <th style={{ width: 120 }}>Режим</th>
                <th style={{ width: 130 }}>Сегодня</th>
                <th style={{ width: 260 }}>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {items.map((account) => (
                <ChannelRow key={account.id} account={account} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
