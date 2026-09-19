'use server';

import { revalidatePath } from 'next/cache';
import { ApiCallError, api } from '@/lib/api';

export interface GenerateOk {
  ok: true;
  id: string;
  file_path: string;
  content: string;
  warnings: Array<{ code: string; message: string; severity: string }>;
}

export interface GenerateFail {
  ok: false;
  error: string;
  details?: unknown;
}

export type GenerateResult = GenerateOk | GenerateFail;

export async function generatePlaybookAction(input: {
  site_id: string;
  template_code: string;
  params: Record<string, unknown>;
  una?: { tech_user: string; secret_ref: string };
}): Promise<GenerateResult> {
  try {
    const response = await api.post<{
      id: string;
      file_path: string;
      content: string;
      warnings: Array<{ code: string; message: string; severity: string }>;
    }>('/playbooks/generate', { ...input, created_by: 'panel' });
    revalidatePath('/runs');
    return { ok: true, ...response, warnings: response.warnings ?? [] };
  } catch (error) {
    if (error instanceof ApiCallError) {
      return { ok: false, error: error.message, details: error.details };
    }
    return { ok: false, error: String(error) };
  }
}

export async function startRunAction(playbookId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const run = await api.post<{ id: string }>('/runs', { playbook_id: playbookId });
    revalidatePath('/runs');
    return { ok: true, message: `Сессия ${run.id} запущена` };
  } catch (error) {
    return { ok: false, message: error instanceof ApiCallError ? error.message : String(error) };
  }
}
