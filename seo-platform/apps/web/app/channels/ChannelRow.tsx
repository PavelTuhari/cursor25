'use client';

import { useState } from 'react';
import type { ChannelAccount } from './page';
import { deleteChannelAction, verifyChannelAction } from './actions';

export function ChannelRow({ account }: { account: ChannelAccount }) {
  const [pending, setPending] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);

  const limit = account.rate_limit_per_day;
  const nearLimit = limit !== null && account.published_today >= limit;

  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <span className="tag accent">{account.channel_id}</span>
          <span className="mono" style={{ fontSize: 13 }}>{account.external_id}</span>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {account.domain}
          {account.display_name ? ` — ${account.display_name}` : ''}
        </div>
      </td>
      <td className="mono" style={{ fontSize: 12 }}>{account.credentials_ref}</td>
      <td>
        <span className={account.sandbox ? 'tag' : 'tag warn'}>
          {account.sandbox ? 'песочница' : 'боевой'}
        </span>
        {!account.enabled && <div><span className="tag">выключено</span></div>}
      </td>
      <td>
        <span className={nearLimit ? 'tag danger' : 'tag'}>
          {account.published_today}
          {limit !== null ? ` / ${limit}` : ''}
        </span>
      </td>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <button
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const result = await verifyChannelAction(account.id);
              setCheck({
                ok: result.ok,
                text: result.ok
                  ? `Подключено: ${result.account_name ?? ''}`
                  : `${result.error ?? ''}${result.hint ? ` — ${result.hint}` : ''}`,
              });
              setPending(false);
            }}
          >
            Проверить
          </button>
          <button disabled={pending} onClick={() => deleteChannelAction(account.id)}>
            Удалить
          </button>
        </div>
        {check && (
          <div className="hint" style={{ color: check.ok ? 'var(--ok)' : 'var(--danger)' }}>
            {check.text}
          </div>
        )}
        {!check && account.last_check_status && (
          <div className="hint" style={{ color: account.last_check_status === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
            {account.last_check_status === 'ok' ? 'проверено' : account.last_check_error}
          </div>
        )}
      </td>
    </tr>
  );
}
