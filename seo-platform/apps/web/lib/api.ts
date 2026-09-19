/**
 * Клиент API платформы.
 *
 * Вызывается только из серверных компонентов и server actions: адрес API и
 * учётный контур UNA не должны быть доступны из браузера.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (error) {
    // Отдельный случай: API не поднят. Без этого пользователь видит только
    // «fetch failed» и не понимает, что чинить.
    throw new ApiCallError(503, `API недоступен по адресу ${API_URL}: ${(error as Error).message}`);
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiCallError(
      response.status,
      typeof payload['error'] === 'string' ? payload['error'] : `Ошибка ${response.status}`,
      payload['details'],
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------- типы

export interface Site {
  id: string;
  domain: string;
  name: string;
  locales: string[];
  geo: string[];
  niche: string;
  description: string;
  audience: string;
  tone_of_voice: string;
  banned_claims: string[];
  competitors: string[];
  una_div: string | null;
  is_active: boolean;
}

export interface TemplateParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface Template {
  code: string;
  version: string;
  title: string;
  phase: number;
  autonomy: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  cadence: string;
  params: TemplateParam[];
}

export interface TaskRun {
  id: string;
  playbook_id: string;
  site_id: string;
  status: string;
  run_mode: string;
  trigger: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  cost_tokens_in: string;
  cost_tokens_out: string;
  cost_external_calls: number;
  cost_amount: string;
  cost_currency: string;
  artifacts?: Artifact[];
}

export interface Artifact {
  id: string;
  run_id: string;
  type: string;
  path: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  site_id?: string;
}

export interface BudgetCheck {
  plan: number;
  committed: number;
  actual: number;
  available: number;
  used_pct: number | null;
  is_allowed: boolean;
  reason: string | null;
}

export const PHASE_TITLES: Record<number, string> = {
  0: 'Онбординг',
  1: 'Семантика и стратегия',
  2: 'Технический SEO',
  3: 'Контент',
  4: 'Дистрибуция',
  5: 'Контроль и отчётность',
  6: 'Учёт и документооборот',
};

export const AUTONOMY_TITLES: Record<string, string> = {
  L0: 'только человек',
  L1: 'AI готовит черновик',
  L2: 'публикация после Approve',
  L3: 'автономно в рамках guardrails',
  L4: 'полная автономия',
};
