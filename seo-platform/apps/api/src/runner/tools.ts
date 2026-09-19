import { RunnerError, type RunnerTool, type ToolContext } from './types.js';

/**
 * Реестр инструментов сессии.
 *
 * Плейбук перечисляет нужные инструменты в tools_allowed. Если хотя бы один
 * не реализован, запуск по умолчанию отклоняется: плейбук, который просит
 * проверить выдачу, без доступа к выдаче выдаст правдоподобный вымысел.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RunnerTool>();

  register(tool: RunnerTool): this {
    this.tools.set(tool.id, tool);
    return this;
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  /** Инструменты, объявленные в плейбуке, но отсутствующие в реестре. */
  missing(requested: string[]): string[] {
    return requested.filter((id) => !this.tools.has(id));
  }

  resolve(requested: string[]): RunnerTool[] {
    return requested.filter((id) => this.tools.has(id)).map((id) => this.tools.get(id)!);
  }

  byName(name: string): RunnerTool | undefined {
    return [...this.tools.values()].find((tool) => tool.name === name);
  }
}

/** Разрешён ли домен URL списком network_allowlist. Поддомены разрешаются. */
export function isAllowedUrl(rawUrl: string, allowlist: string[]): boolean {
  let host: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

/** Чтение страницы сайта. Единственный внешний инструмент, доступный без интеграций. */
export const siteFetchTool: RunnerTool = {
  id: 'mcp-site',
  name: 'site_fetch',
  description:
    'Загружает страницу по URL и возвращает её текст. Работает только с доменами из network_allowlist плейбука.',
  external: true,
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Полный URL страницы' },
      max_chars: { type: 'number', description: 'Ограничение длины ответа, по умолчанию 20000' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async run(input, context: ToolContext): Promise<string> {
    const url = String(input['url'] ?? '');
    if (!isAllowedUrl(url, context.network_allowlist)) {
      return `ОТКАЗАНО: домен вне network_allowlist плейбука (${context.network_allowlist.join(', ')})`;
    }
    const limit = Number(input['max_chars'] ?? 20_000);
    const response = await fetch(url, {
      headers: { 'user-agent': 'SEOForge/0.1 (+platform bot)' },
      redirect: 'follow',
    });
    if (!response.ok) return `HTTP ${response.status} ${response.statusText}`;
    const html = await response.text();
    // Модели нужен текст, а не разметка: теги съедают контекст и ничего не добавляют.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, limit);
  },
};

const RO_DIACRITICS = /[ăâîșțĂÂÎȘȚ]/;
// Частая ошибка в румынских текстах: седиль вместо запятой снизу.
const WRONG_CEDILLA = /[şţŞŢ]/g;

/** Проверки текста: диакритика, длина мета-тегов, плотность ключа. */
export const langCheckTool: RunnerTool = {
  id: 'mcp-lang',
  name: 'lang_check',
  description:
    'Проверяет текст: румынская диакритика, длина title и description, плотность ключевой фразы.',
  external: false,
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      locale: { type: 'string', description: 'например ro-MD' },
      keyword: { type: 'string', description: 'ключевая фраза для расчёта плотности' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  async run(input): Promise<string> {
    const text = String(input['text'] ?? '');
    const locale = String(input['locale'] ?? '');
    const issues: string[] = [];

    if (locale.startsWith('ro')) {
      if (!RO_DIACRITICS.test(text)) {
        issues.push('в румынском тексте не найдено ни одного диакритического знака');
      }
      const wrong = text.match(WRONG_CEDILLA);
      if (wrong) {
        issues.push(`седиль вместо запятой снизу (${wrong.length} шт.): ş/ţ вместо ș/ț`);
      }
    }

    const title = String(input['title'] ?? '');
    if (title && title.length > 60) issues.push(`title длиннее 60 символов: ${title.length}`);
    const description = String(input['description'] ?? '');
    if (description && description.length > 155) {
      issues.push(`description длиннее 155 символов: ${description.length}`);
    }

    const words = text.split(/\s+/).filter(Boolean);
    const keyword = String(input['keyword'] ?? '').trim().toLowerCase();
    let density = 0;
    if (keyword && words.length > 0) {
      const occurrences = (text.toLowerCase().match(new RegExp(escapeRegExp(keyword), 'g')) ?? []).length;
      const keywordWords = keyword.split(/\s+/).length;
      density = (occurrences * keywordWords * 100) / words.length;
      if (density > 2.5) issues.push(`плотность ключа ${density.toFixed(2)}% превышает 2.5%`);
    }

    return JSON.stringify(
      { words: words.length, keyword_density_pct: Number(density.toFixed(2)), issues },
      null,
      2,
    );
  },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function defaultRegistry(): ToolRegistry {
  return new ToolRegistry().register(siteFetchTool).register(langCheckTool);
}

export function assertToolsAvailable(
  registry: ToolRegistry,
  requested: string[],
  allowMissing: boolean,
): string[] {
  const missing = registry.missing(requested);
  if (missing.length > 0 && !allowMissing) {
    throw new RunnerError(
      `Плейбук требует инструменты, которых нет: ${missing.join(', ')}. ` +
        'Запуск отклонён: без них результат будет выдуман. ' +
        'Чтобы выполнить частично, запустите с allow_missing_tools и ожидайте пометок [TODO].',
      'tools',
    );
  }
  return missing;
}
