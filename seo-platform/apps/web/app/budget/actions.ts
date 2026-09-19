'use server';

import { ApiCallError, api, type BudgetCheck } from '@/lib/api';

export async function checkBudgetAction(input: {
  div: string;
  period: string;
  article: string;
  amount: number;
}): Promise<{ ok: true; check: BudgetCheck } | { ok: false; message: string }> {
  try {
    return { ok: true, check: await api.post<BudgetCheck>('/una/budget/check', input) };
  } catch (error) {
    return { ok: false, message: error instanceof ApiCallError ? error.message : String(error) };
  }
}

export async function createDocumentAction(input: {
  div: string;
  sysfid: string;
  ext_id: string;
  period: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const doc = await api.post<{ doc_no: string; status: string; created: boolean }>('/una/documents', {
      ext_system: 'panel',
      ext_id: input.ext_id,
      sysfid: input.sysfid,
      doc_date: `${input.period}-01`,
      div: input.div,
    });
    return {
      ok: true,
      message: doc.created
        ? `Создан черновик ${doc.doc_no} (статус «${doc.status}»)`
        : `Документ по этому ключу уже существует: ${doc.doc_no}`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof ApiCallError ? error.message : String(error) };
  }
}
