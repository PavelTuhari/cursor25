import { z } from 'zod';

export const siteInput = z.object({
  domain: z.string().min(3).max(255),
  name: z.string().min(1),
  locales: z.array(z.string().min(2)).min(1),
  geo: z.array(z.string()).default([]),
  niche: z.string().default(''),
  description: z.string().default(''),
  audience: z.string().default(''),
  tone_of_voice: z.string().default(''),
  banned_claims: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  una_div: z.string().max(20).optional(),
});

export const generateInput = z.object({
  site_id: z.string().uuid(),
  template_code: z.string(),
  params: z.record(z.unknown()).default({}),
  run_mode: z.enum(['dry-run', 'execute']).optional(),
  model_hint: z.string().optional(),
  budget: z
    .object({
      max_tokens: z.number().int().positive().optional(),
      max_minutes: z.number().int().positive().optional(),
      max_external_calls: z.number().int().positive().optional(),
    })
    .optional(),
  una: z
    .object({
      campaign_doc: z.string().optional(),
      budget_article: z.string().optional(),
      tech_user: z.string(),
      secret_ref: z.string().startsWith('vault://', 'секрет передаётся только ссылкой vault://'),
    })
    .optional(),
  created_by: z.string().default('system'),
});

export const runInput = z.object({
  playbook_id: z.string().uuid(),
  trigger: z.enum(['manual', 'schedule', 'event']).default('manual'),
});

export const reportInput = z.object({
  status: z.enum(['awaiting_approval', 'success', 'partial', 'failed']),
  report: z.record(z.unknown()).default({}),
  error: z.string().optional(),
  cost: z
    .object({
      tokens_in: z.number().int().nonnegative().default(0),
      tokens_out: z.number().int().nonnegative().default(0),
      external_calls: z.number().int().nonnegative().default(0),
      amount: z.number().nonnegative().default(0),
      currency: z.string().length(3).default('USD'),
    })
    .default({}),
  artifacts: z
    .array(z.object({ type: z.string(), path: z.string(), checksum: z.string().optional() }))
    .default([]),
});

export const approvalInput = z.object({
  actor: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});

export const budgetCheckInput = z.object({
  div: z.string().min(1),
  period: z.string().regex(/^\d{4}-(\d{2}|Q[1-4])$/, 'период в формате YYYY-MM или YYYY-Q1'),
  article: z.string().min(1),
  amount: z.number().positive(),
  channel: z.string().optional(),
});

export const unaDocInput = z.object({
  ext_system: z.string().min(1),
  ext_id: z.string().min(1),
  sysfid: z.string().regex(/^WSEO\d{2}$/, 'тип документа вида WSEO01..WSEO15'),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  div: z.string().min(1),
  campaign_code: z.string().optional(),
  run_id: z.string().uuid().optional(),
  playbook_sha: z.string().optional(),
  note: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  site_id: z.string().uuid().optional(),
});
