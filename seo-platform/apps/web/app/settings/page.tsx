import { api } from '@/lib/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import { SettingRow } from './SettingRow';

export const dynamic = 'force-dynamic';

export interface Setting {
  key: string;
  value: unknown;
  description: string;
  source: string;
}

export default async function SettingsPage() {
  let items: Setting[];
  try {
    items = (await api.get<{ items: Setting[] }>('/settings')).items;
  } catch (error) {
    return (
      <>
        <h1>Настройки</h1>
        <ErrorNotice error={error} />
      </>
    );
  }

  return (
    <>
      <h1>Настройки</h1>
      <p className="lede">
        Значение ищется в переопределении для сайта, затем в глобальных настройках, затем
        в переменной окружения, затем берётся значение по умолчанию. Менять поведение в бою
        можно отсюда, без передеплоя.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 300 }}>Настройка</th>
              <th style={{ width: 200 }}>Значение</th>
              <th style={{ width: 190 }}>Источник</th>
              <th>Что делает</th>
            </tr>
          </thead>
          <tbody>
            {items.map((setting) => (
              <SettingRow key={setting.key} setting={setting} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
