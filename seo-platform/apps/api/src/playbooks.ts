import {
  generatePlaybook,
  validatePlaybook,
  type PlaybookTemplate,
  type SiteProfile,
  type UnaBinding,
} from '@seo/playbook-engine';
import type { Db } from './db.js';
import { ApiError } from './errors.js';

/**
 * Создание плейбука: одна реализация на HTTP-маршрут и на планировщик.
 *
 * Правила — обязательная привязка к UNA для фазы 6 и отказ сохранять плейбук,
 * не прошедший валидацию, — должны действовать одинаково, кто бы ни запускал.
 */

export interface SiteRow {
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
}

export function toProfile(row: SiteRow): SiteProfile {
  return {
    domain: row.domain,
    name: row.name,
    locales: row.locales,
    geo: row.geo,
    niche: row.niche,
    description: row.description,
    audience: row.audience,
    tone_of_voice: row.tone_of_voice,
    banned_claims: row.banned_claims,
    competitors: row.competitors,
    una_div: row.una_div ?? undefined,
  };
}

export interface CreatePlaybookInput {
  site_id: string;
  template_code: string;
  params: Record<string, unknown>;
  run_mode?: 'dry-run' | 'execute';
  model_hint?: string;
  budget?: Partial<{ max_tokens: number; max_minutes: number; max_external_calls: number }>;
  una?: UnaBinding;
  created_by: string;
}

export interface CreatedPlaybook {
  id: string;
  file_path: string;
  content: string;
  front_matter: Record<string, unknown>;
  warnings: Array<{ code: string; message: string; severity: string }>;
}

export async function createPlaybook(
  db: Db,
  templates: Map<string, PlaybookTemplate>,
  input: CreatePlaybookInput,
  generatedAt: string,
): Promise<CreatedPlaybook> {
  const template = templates.get(input.template_code);
  if (!template) throw ApiError.notFound(`Шаблон ${input.template_code}`);

  const site = await db.query<SiteRow>(`SELECT * FROM sites WHERE id = $1`, [input.site_id]);
  const row = site.rows[0];
  if (!row) throw ApiError.notFound('Сайт');

  // Плейбук фазы 6 работает с деньгами: без привязки к UNA он бессмыслен.
  if (template.phase === 6 && !input.una) {
    throw ApiError.badRequest(
      `Шаблон ${template.code} относится к учётному контуру: нужен блок una (tech_user, secret_ref)`,
    );
  }

  let rendered;
  try {
    rendered = generatePlaybook(template, {
      site: toProfile(row),
      params: input.params,
      generated_at: generatedAt,
      run_mode: input.run_mode,
      model_hint: input.model_hint,
      una: input.una,
      budget: input.budget,
    });
  } catch (error) {
    throw ApiError.badRequest((error as Error).message);
  }

  // Невалидный плейбук не сохраняем: иначе он рано или поздно уедет в сессию.
  const verdict = validatePlaybook(rendered.content);
  if (!verdict.ok) {
    throw ApiError.badRequest('Сгенерированный плейбук не прошёл валидацию', verdict.issues);
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO playbooks (site_id, template_code, template_version, params, front_matter,
                            body, content, file_path, generated_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [input.site_id, template.code, template.version, JSON.stringify(input.params),
     JSON.stringify(rendered.front_matter), rendered.body, rendered.content,
     rendered.suggested_path, generatedAt, input.created_by],
  );

  return {
    id: rows[0]!.id,
    file_path: rendered.suggested_path,
    content: rendered.content,
    front_matter: rendered.front_matter as unknown as Record<string, unknown>,
    warnings: verdict.issues,
  };
}
