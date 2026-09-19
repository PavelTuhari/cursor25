'use client';

import { useState } from 'react';
import type { Site } from '@/lib/api';
import { createChannelAction } from './actions';

const CHANNELS = [
  { id: 'telegram', label: 'Telegram', idHint: '@канал или -100…', docs: 'бот от @BotFather, добавлен в канал админом' },
  { id: 'facebook', label: 'Facebook', idHint: 'id страницы', docs: 'Page Access Token из /me/accounts' },
  { id: 'instagram', label: 'Instagram', idHint: 'id Instagram-аккаунта', docs: 'Business-аккаунт, связанный со страницей' },
  { id: 'linkedin', label: 'LinkedIn', idHint: 'id организации или urn:li:…', docs: 'продукт Share on LinkedIn' },
];

export function ChannelForm({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [channel, setChannel] = useState(CHANNELS[0]!.id);
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('env:TG_TOKEN_TEST');
  const [limit, setLimit] = useState('5');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const meta = CHANNELS.find((c) => c.id === channel)!;

  if (sites.length === 0) {
    return <div className="card muted" style={{ marginBottom: 24 }}>Сначала заведите сайт.</div>;
  }

  return (
    <section className="card" style={{ marginBottom: 28 }}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setResult(
            await createChannelAction({
              site_id: siteId,
              channel_id: channel,
              external_id: externalId,
              display_name: name,
              credentials_ref: ref,
              rate_limit_per_day: Number(limit) || undefined,
            }),
          );
          setPending(false);
        }}
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="field" style={{ flex: '1 1 170px' }}>
            <label htmlFor="c-site">Сайт</label>
            <select id="c-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.domain}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="c-channel">Канал</label>
            <select id="c-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <div className="hint">{meta.docs}</div>
          </div>
          <div className="field" style={{ flex: '1 1 190px' }}>
            <label htmlFor="c-external">Идентификатор аккаунта</label>
            <input id="c-external" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder={meta.idHint} />
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="c-ref">Ссылка на секрет</label>
            <input id="c-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="mono" />
            <div className="hint">env:ИМЯ или vault://путь. Сам токен сюда не вставляется</div>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="c-name">Название</label>
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}>
            <label htmlFor="c-limit">Лимит в сутки</label>
            <input id="c-limit" type="number" min="1" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>

        <div className="notice info" style={{ marginBottom: 14 }}>
          Подключение создаётся в песочнице. Перевод в боевой режим — осознанное действие.
        </div>

        <button className="primary" type="submit" disabled={pending || !externalId}>
          {pending ? 'Сохранение…' : 'Подключить'}
        </button>
      </form>

      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'error'}`} style={{ marginTop: 14 }}>
          {result.message}
        </div>
      )}
    </section>
  );
}
