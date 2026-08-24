/**
 * Минимальный шаблонизатор без внешних зависимостей.
 *
 * Поддерживает ровно то, что нужно плейбукам, и ничего сверх:
 *   {{ path.to.value }}          — подстановка
 *   {{#if path}} ... {{/if}}     — условный блок
 *   {{#each path}} ... {{/each}} — цикл, внутри доступны {{this}}, {{this.field}}, {{@index}}
 *
 * Намеренно не поддерживаются произвольные выражения: шаблон должен оставаться
 * данными, а не кодом — иначе теряется воспроизводимость плейбуков.
 *
 * Разбор идёт в AST, а не регуляркой по всему тексту: блоки одного типа могут
 * быть вложены друг в друга ({{#each}} внутри {{#each}}), и плоский поиск
 * закрывающего тега схлопнул бы их неверно.
 */

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

type Scope = Record<string, unknown>;

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; path: string }
  | { kind: 'block'; block: 'if' | 'each'; path: string; children: Node[] };

const TAG_RE = /\{\{\s*(#if|#each|\/if|\/each)?\s*([\w.$@]*)\s*\}\}/g;

interface Tag {
  index: number;
  length: number;
  type: '#if' | '#each' | '/if' | '/each' | 'var';
  path: string;
}

function tokenize(template: string): Tag[] {
  const tags: Tag[] = [];
  TAG_RE.lastIndex = 0;
  let match = TAG_RE.exec(template);
  while (match !== null) {
    const marker = match[1];
    const path = match[2] ?? '';
    if (!marker && path === '') {
      throw new TemplateError(`Пустой тег {{}} в позиции ${match.index}`);
    }
    tags.push({
      index: match.index,
      length: match[0].length,
      type: (marker ?? 'var') as Tag['type'],
      path,
    });
    match = TAG_RE.exec(template);
  }
  return tags;
}

function parse(template: string): Node[] {
  const tags = tokenize(template);
  const root: Node[] = [];
  const stack: Array<{ block: 'if' | 'each'; path: string; children: Node[] }> = [];
  let cursor = 0;

  const current = (): Node[] => (stack.length > 0 ? stack[stack.length - 1]!.children : root);

  for (const tag of tags) {
    if (tag.index > cursor) {
      current().push({ kind: 'text', value: template.slice(cursor, tag.index) });
    }
    cursor = tag.index + tag.length;

    if (tag.type === 'var') {
      current().push({ kind: 'var', path: tag.path });
    } else if (tag.type === '#if' || tag.type === '#each') {
      stack.push({ block: tag.type === '#if' ? 'if' : 'each', path: tag.path, children: [] });
    } else {
      const expected = tag.type === '/if' ? 'if' : 'each';
      const open = stack.pop();
      if (!open) throw new TemplateError(`Закрывающий {{${tag.type}}} без открывающего блока`);
      if (open.block !== expected) {
        throw new TemplateError(`Ожидался {{/${open.block}}}, встречен {{${tag.type}}}`);
      }
      current().push({ kind: 'block', block: open.block, path: open.path, children: open.children });
    }
  }

  if (stack.length > 0) {
    throw new TemplateError(`Незакрытый блок {{#${stack[stack.length - 1]!.block}}}`);
  }
  if (cursor < template.length) {
    root.push({ kind: 'text', value: template.slice(cursor) });
  }
  return root;
}

/** Достаёт значение по пути `a.b.c`; `this` ссылается на текущий элемент цикла. */
export function resolvePath(scope: Scope, path: string): unknown {
  if (path === 'this') return scope['this'];
  if (path === '@index') return scope['@index'];
  const parts = path.split('.');
  const head = parts[0] as string;
  let current: unknown = head === 'this' ? scope['this'] : scope[head];
  for (const part of parts.slice(1)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderNodes(nodes: Node[], scope: Scope, missing: Set<string>): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.value;
      continue;
    }
    if (node.kind === 'var') {
      const value = resolvePath(scope, node.path);
      if (value === undefined || value === null) {
        missing.add(node.path);
        continue;
      }
      out += stringify(value);
      continue;
    }
    const value = resolvePath(scope, node.path);
    if (node.block === 'if') {
      if (isTruthy(value)) out += renderNodes(node.children, scope, missing);
      continue;
    }
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      throw new TemplateError(`{{#each ${node.path}}}: ожидался массив, получено ${typeof value}`);
    }
    const items = (value as unknown[] | undefined) ?? [];
    items.forEach((item, index) => {
      out += renderNodes(node.children, { ...scope, this: item, '@index': index + 1 }, missing);
    });
  }
  return out;
}

export interface RenderOptions {
  /** При true неизвестная переменная — ошибка, а не пустая строка. По умолчанию true. */
  strict?: boolean;
}

/** Разворачивает шаблон в текст. */
export function renderTemplate(template: string, scope: Scope, options: RenderOptions = {}): string {
  const missing = new Set<string>();
  const result = renderNodes(parse(template), scope, missing);
  if (options.strict !== false && missing.size > 0) {
    throw new TemplateError(`В шаблоне не заполнены переменные: ${[...missing].join(', ')}`);
  }
  return result;
}
