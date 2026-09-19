'use client';

import { useState } from 'react';
import type { Artifact } from '@/lib/api';
import { decideArtifactAction } from './actions';

export function ApprovalRow({ artifact }: { artifact: Artifact }) {
  const [actor, setActor] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setPending(true);
    setError(null);
    const result = await decideArtifactAction({ id: artifact.id, actor, decision, reason });
    if (!result.ok) setError(result.message);
    setPending(false);
  }

  return (
    <tr>
      <td>
        <span className="tag">{artifact.type}</span>
      </td>
      <td className="mono" style={{ fontSize: 13 }}>
        {artifact.path}
      </td>
      <td className="muted mono" style={{ fontSize: 12 }}>
        {new Date(artifact.created_at).toLocaleString('ru-RU')}
      </td>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="кто утверждает"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            style={{ width: 150 }}
          />
          <button
            className="primary"
            disabled={pending || actor.trim() === ''}
            onClick={() => decide('approve')}
          >
            Утвердить
          </button>
          <button disabled={pending || actor.trim() === ''} onClick={() => decide('reject')}>
            Отклонить
          </button>
        </div>
        <input
          placeholder="причина отклонения"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ marginTop: 8 }}
        />
        {error && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}
