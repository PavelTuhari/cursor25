'use server';

import { revalidatePath } from 'next/cache';
import { ApiCallError, api } from '@/lib/api';

export async function decideArtifactAction(input: {
  id: string;
  actor: string;
  decision: 'approve' | 'reject';
  reason?: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await api.post(`/artifacts/${input.id}/approve`, {
      actor: input.actor,
      decision: input.decision,
      reason: input.reason || undefined,
    });
    revalidatePath('/approvals');
    return { ok: true, message: 'Готово' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiCallError ? error.message : String(error),
    };
  }
}
