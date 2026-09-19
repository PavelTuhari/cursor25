'use server';

import { revalidatePath } from 'next/cache';
import { ApiCallError, api } from '@/lib/api';

const fail = (error: unknown) => ({
  ok: false,
  message: error instanceof ApiCallError ? error.message : String(error),
});

export async function createChannelAction(input: {
  site_id: string;
  channel_id: string;
  external_id: string;
  display_name: string;
  credentials_ref: string;
  rate_limit_per_day?: number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await api.post('/channel-accounts', input);
    revalidatePath('/channels');
    return { ok: true, message: 'Подключено в песочнице. Проверьте доступ кнопкой «Проверить».' };
  } catch (error) {
    return fail(error);
  }
}

export async function verifyChannelAction(
  id: string,
): Promise<{ ok: boolean; account_name?: string; error?: string; hint?: string }> {
  try {
    const result = await api.post<{ ok: boolean; account_name?: string; error?: string; hint?: string }>(
      `/channel-accounts/${id}/verify`, {},
    );
    revalidatePath('/channels');
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof ApiCallError ? error.message : String(error) };
  }
}

export async function deleteChannelAction(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    await api.del(`/channel-accounts/${id}`);
    revalidatePath('/channels');
    return { ok: true, message: 'Удалено' };
  } catch (error) {
    return fail(error);
  }
}
