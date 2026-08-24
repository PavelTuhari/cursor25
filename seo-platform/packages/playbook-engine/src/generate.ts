import { renderTemplate } from './render.js';
import { serializeFrontMatter } from './frontmatter.js';
import type {
  PlaybookFrontMatter,
  PlaybookTemplate,
  RenderContext,
  RenderedPlaybook,
  TemplateParamSpec,
} from './types.js';

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === 'string') ? 'string[]' : 'object[]';
  }
  if (value === null) return 'null';
  return typeof value;
}

/** Проверяет params по params_schema шаблона. Лишние параметры допустимы, отсутствующие обязательные — нет. */
export function validateParams(
  schema: Record<string, TemplateParamSpec>,
  params: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(schema)) {
    const value = params[name];
    if (value === undefined || value === null) {
      if (spec.required) errors.push(`отсутствует обязательный параметр "${name}" (${spec.description})`);
      continue;
    }
    const actual = typeOf(value);
    const expected = spec.type;
    const compatible =
      actual === expected ||
      (expected === 'object[]' && actual === 'string[]') ||
      (expected === 'object' && actual === 'object');
    if (!compatible) {
      errors.push(`параметр "${name}": ожидался ${expected}, получен ${actual}`);
    }
  }
  return errors;
}

/** Домены, к которым плейбуку разрешено обращаться всегда. */
function buildAllowlist(template: PlaybookTemplate, site: RenderContext['site']): string[] {
  const list = new Set<string>(template.defaults.network_allowlist);
  list.add(site.domain);
  return [...list];
}

/** ТЗ ч. I, §8.3: playbooks/<site>/<YYYY-MM>/<code>--<runid>.md */
export function suggestPath(site: string, code: string, generatedAt: string, runId: string): string {
  const month = generatedAt.slice(0, 7);
  return `playbooks/${site}/${month}/${code}--${runId}.md`;
}

export interface GenerateOptions {
  /** Идентификатор запуска; попадает в имя файла. */
  run_id?: string;
}

/** Собирает готовый .md-плейбук из шаблона и контекста. */
export function generatePlaybook(
  template: PlaybookTemplate,
  context: RenderContext,
  options: GenerateOptions = {},
): RenderedPlaybook {
  const paramErrors = validateParams(template.params_schema, context.params);
  if (paramErrors.length > 0) {
    throw new GenerationError(`Шаблон ${template.code}: ${paramErrors.join('; ')}`);
  }

  const budget = { ...template.defaults.budget, ...(context.budget ?? {}) };
  const frontMatter: PlaybookFrontMatter = {
    playbook_id: template.code,
    version: template.version,
    site: context.site.domain,
    site_locale: context.site.locales,
    generated_at: context.generated_at,
    run_mode: context.run_mode ?? template.defaults.run_mode,
    model_hint: context.model_hint ?? template.defaults.model_hint ?? 'claude-opus-5',
    budget,
    tools_allowed: template.defaults.tools_allowed,
    network_allowlist: buildAllowlist(template, context.site),
    approval_required: template.defaults.approval_required,
    outputs: template.defaults.outputs,
  };
  if (template.defaults.approval_stage) frontMatter.approval_stage = template.defaults.approval_stage;
  if (context.una) frontMatter.una = context.una;

  const body = renderTemplate(template.body, {
    site: context.site,
    params: context.params,
    generated_at: context.generated_at,
    playbook: { code: template.code, version: template.version, title: template.title },
  }).trim();

  const runId = options.run_id ?? 'draft';
  return {
    content: serializeFrontMatter(frontMatter as Record<string, unknown>, `${body}\n`),
    front_matter: frontMatter,
    body,
    template_code: template.code,
    template_version: template.version,
    suggested_path: suggestPath(context.site.domain, template.code, context.generated_at, runId),
  };
}
