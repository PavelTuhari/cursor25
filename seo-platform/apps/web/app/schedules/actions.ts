'use server';

import { revalidatePath } from 'next/cache';
import { ApiCallError, api } from '@/lib/api';

const fail = (error: unknown) => ({
  ok: false,
  message: error instanceof ApiCallError ? error.message : String(error),
});

export async function createScheduleAction(input: {
  site_id: string;
  template_code: string;
  name: string;
  cron: string;
  params: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const created = await api.post<{ next_run_at: string | null }>('/schedules', input);
    revalidatePath('/schedules');
    return {
      ok: true,
      message: created.next_run_at
        ? `Создано. Следующий запуск: ${new Date(created.next_run_at).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC`
        : 'Создано, но расписание никогда не сработает — проверьте выражение',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleScheduleAction(
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  try {
    await api.post(`/schedules/${id}/toggle`, { enabled });
    revalidatePath('/schedules');
    return { ok: true, message: 'Готово' };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteScheduleAction(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    await api.del(`/schedules/${id}`);
    revalidatePath('/schedules');
    return { ok: true, message: 'Удалено' };
  } catch (error) {
    return fail(error);
  }
}
