'use server';

import { revalidatePath } from 'next/cache';
import { ApiCallError, api } from '@/lib/api';

export async function updateSettingAction(
  key: string,
  value: unknown,
): Promise<{ ok: boolean; message: string }> {
  try {
    await api.put('/settings', { key, value, actor: 'panel' });
    revalidatePath('/settings');
    return { ok: true, message: 'Сохранено' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiCallError ? error.message : String(error),
    };
  }
}
