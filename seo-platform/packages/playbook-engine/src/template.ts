import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseFrontMatter } from './frontmatter.js';
import type { PlaybookTemplate, TemplateParamSpec } from './types.js';

export class TemplateLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateLoadError';
  }
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CODE_RE = /^\d{2}-[a-z0-9-]+$/;

function requireString(data: Record<string, unknown>, key: string, file: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TemplateLoadError(`${file}: обязательное строковое поле "${key}" отсутствует`);
  }
  return value;
}

/** Разбирает файл шаблона в объект PlaybookTemplate. */
export function parseTemplate(source: string, sourcePath = '<inline>'): PlaybookTemplate {
  const { data, body } = parseFrontMatter(source);
  const code = requireString(data, 'code', sourcePath);
  if (!CODE_RE.test(code)) {
    throw new TemplateLoadError(`${sourcePath}: код "${code}" не соответствует формату NN-slug`);
  }
  const version = requireString(data, 'version', sourcePath);
  if (!SEMVER_RE.test(version)) {
    throw new TemplateLoadError(`${sourcePath}: версия "${version}" не является SemVer`);
  }
  const phase = Number(String(code.slice(0, 1)));
  if (!Number.isInteger(phase) || phase < 0 || phase > 6) {
    throw new TemplateLoadError(`${sourcePath}: не удалось определить фазу по коду "${code}"`);
  }
  const defaults = data['defaults'];
  if (defaults === null || typeof defaults !== 'object') {
    throw new TemplateLoadError(`${sourcePath}: отсутствует секция "defaults"`);
  }
  const paramsSchema = (data['params_schema'] ?? {}) as Record<string, TemplateParamSpec>;
  if (body.trim() === '') {
    throw new TemplateLoadError(`${sourcePath}: тело шаблона пустое`);
  }
  return {
    code,
    version,
    title: requireString(data, 'title', sourcePath),
    phase: phase as PlaybookTemplate['phase'],
    autonomy: (data['autonomy'] ?? 'L1') as PlaybookTemplate['autonomy'],
    cadence: (data['cadence'] ?? 'по требованию') as string,
    defaults: defaults as PlaybookTemplate['defaults'],
    params_schema: paramsSchema,
    body,
    source_path: sourcePath,
  };
}

export function loadTemplateFile(path: string): PlaybookTemplate {
  return parseTemplate(readFileSync(path, 'utf8'), path);
}

/** Загружает все шаблоны каталога. Дубликат кода — ошибка, а не «последний побеждает». */
export function loadTemplateDir(dir: string): Map<string, PlaybookTemplate> {
  const templates = new Map<string, PlaybookTemplate>();
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  for (const file of files) {
    const template = loadTemplateFile(join(dir, file));
    if (templates.has(template.code)) {
      const existing = templates.get(template.code)!;
      throw new TemplateLoadError(
        `Дубликат кода шаблона "${template.code}": ${basename(existing.source_path ?? '')} и ${file}`,
      );
    }
    templates.set(template.code, template);
  }
  return templates;
}
