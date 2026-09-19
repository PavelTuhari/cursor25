'use client';

import { useState } from 'react';
import type { Setting } from './page';
import { updateSettingAction } from './actions';

/** Опасные переключатели: тратят деньги или публикуют наружу. */
const SENSITIVE = new Set(['publishing.enabled', 'runner.enabled', 'publishing.require_approval']);

export function SettingRow({ setting }: { setting: Setting }) {
  const [value, setValue] = useState(setting.value);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isBool = typeof setting.value === 'boolean';
  const isNumber = typeof setting.value === 'number';

  async function save(next: unknown) {
    setPending(true);
    setMessage(null);
    const result = await updateSettingAction(setting.key, next);
    setMessage(result.ok ? 'Сохранено' : result.message);
    if (result.ok) setValue(next);
    setPending(false);
  }

  return (
    <tr>
      <td className="mono" style={{ fontSize: 13 }}>
        {setting.key}
        {SENSITIVE.has(setting.key) && (
          <div>
            <span className="tag warn" style={{ marginTop: 4 }}>
              влияет на деньги или публикации
            </span>
          </div>
        )}
      </td>
      <td>
        {isBool ? (
          <button
            className={value === true ? 'primary' : ''}
            disabled={pending}
            onClick={() => save(!(value === true))}
          >
            {value === true ? 'включено' : 'выключено'}
          </button>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <input
              value={String(value ?? '')}
              onChange={(e) => setValue(isNumber ? Number(e.target.value) : e.target.value)}
              style={{ width: 120 }}
            />
            <button disabled={pending} onClick={() => save(value)}>
              Сохранить
            </button>
          </div>
        )}
        {message && <div className="hint">{message}</div>}
      </td>
      <td className="muted" style={{ fontSize: 13 }}>
        {setting.source}
      </td>
      <td className="muted" style={{ fontSize: 13 }}>
        {setting.description}
      </td>
    </tr>
  );
}
