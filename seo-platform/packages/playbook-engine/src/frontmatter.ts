import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedDocument<T = Record<string, unknown>> {
  data: T;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class FrontMatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrontMatterError';
  }
}

/** Разбирает документ вида `---\n<yaml>\n---\n<markdown>`. */
export function parseFrontMatter<T = Record<string, unknown>>(source: string): ParsedDocument<T> {
  const match = FM_RE.exec(source);
  if (!match) throw new FrontMatterError('Документ не содержит YAML front-matter');
  const yamlText = match[1] as string;
  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (error) {
    throw new FrontMatterError(`Некорректный YAML front-matter: ${(error as Error).message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new FrontMatterError('Front-matter должен быть YAML-объектом');
  }
  return { data: data as T, body: source.slice(match[0].length) };
}

/** Собирает документ обратно. Ключи сохраняют порядок объекта. */
export function serializeFrontMatter(data: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlText}\n---\n\n${body.replace(/^\n+/, '')}`;
}
