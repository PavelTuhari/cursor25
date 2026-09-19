import type { Db } from '../db.js';

/**
 * Настройки платформы.
 *
 * Значение ищется сначала в переопределении для сайта, затем в глобальных
 * настройках, затем в переменной окружения, затем берётся значение по
 * умолчанию. Окружение ниже базы намеренно: менять поведение в бою через
 * панель должно быть можно без передеплоя.
 */

export interface SettingSpec<T> {
  key: string;
  /** Переменная окружения, из которой читается значение, если в базе его нет. */
  env?: string;
  default: T;
  description: string;
  parse: (raw: string) => T;
}

export const num = (raw: string): number => Number(raw);
export const bool = (raw: string): boolean => raw === 'true' || raw === '1';
export const str = (raw: string): string => raw;

/** Реестр известных настроек: панель показывает их и подсказывает смысл. */
export const KNOWN_SETTINGS: Array<SettingSpec<unknown>> = [
  {
    key: 'runner.enabled', env: 'RUNNER', default: false, parse: (r) => r === 'claude',
    description: 'Исполнять ли очередь запусков. Выключено — плейбуки копятся, деньги не тратятся',
  },
  {
    key: 'runner.model', env: 'RUNNER_MODEL', default: 'claude-opus-5', parse: str,
    description: 'Модель по умолчанию, если плейбук не задал свою',
  },
  {
    key: 'runner.allow_missing_tools', env: 'RUNNER_ALLOW_MISSING_TOOLS', default: false, parse: bool,
    description: 'Разрешать запуск при неполном наборе инструментов (результат будет с пометками TODO)',
  },
  {
    key: 'runner.max_iterations', env: 'RUNNER_MAX_ITERATIONS', default: 24, parse: num,
    description: 'Потолок итераций цикла сессии',
  },
  {
    key: 'scheduler.enabled', env: 'SCHEDULER', default: false, parse: (r) => r === 'on',
    description: 'Проверять ли расписания раз в минуту',
  },
  {
    key: 'publishing.enabled', env: 'PUBLISHING', default: false, parse: (r) => r === 'on',
    description: 'Разрешена ли фактическая публикация в каналы',
  },
  {
    key: 'publishing.default_rate_limit_per_day', env: 'PUBLISHING_RATE_LIMIT', default: 5, parse: num,
    description: 'Сколько публикаций в сутки на аккаунт, если у него не задан свой лимит',
  },
  {
    key: 'publishing.require_approval', default: true, parse: bool,
    description: 'Требовать утверждения человеком перед публикацией. Отключать не рекомендуется',
  },
  {
    key: 'budget.monthly_token_limit_usd', env: 'BUDGET_TOKEN_LIMIT_USD', default: 200, parse: num,
    description: 'Потолок расхода на токены в месяц. При достижении очередь не исполняется',
  },
];

const SPECS = new Map(KNOWN_SETTINGS.map((spec) => [spec.key, spec]));

export class ConfigStore {
  private cache = new Map<string, unknown>();

  constructor(
    private readonly db: Db,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Сбрасывает кэш. Вызывается после изменения настроек. */
  invalidate(): void {
    this.cache.clear();
  }

  async get<T>(key: string, siteId?: string): Promise<T> {
    const spec = SPECS.get(key) as SettingSpec<T> | undefined;
    const cacheKey = `${siteId ?? 'global'}:${key}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) as T;

    const scopes = siteId ? [`site:${siteId}`, 'global'] : ['global'];
    const { rows } = await this.db.query<{ value: unknown; scope: string }>(
      `SELECT value, scope FROM settings WHERE key = $1 AND scope = ANY($2)`,
      [key, scopes],
    );
    // Переопределение для сайта имеет приоритет над глобальным.
    const row = scopes.map((scope) => rows.find((r) => r.scope === scope)).find(Boolean);

    let value: T;
    if (row) {
      value = row.value as T;
    } else if (spec?.env && this.env[spec.env] !== undefined) {
      value = spec.parse(this.env[spec.env] as string);
    } else if (spec) {
      value = spec.default;
    } else {
      throw new Error(`Неизвестная настройка "${key}"`);
    }
    this.cache.set(cacheKey, value);
    return value;
  }

  async set(key: string, value: unknown, updatedBy: string, siteId?: string): Promise<void> {
    if (!SPECS.has(key)) throw new Error(`Неизвестная настройка "${key}"`);
    const scope = siteId ? `site:${siteId}` : 'global';
    await this.db.query(
      `INSERT INTO settings (scope, key, value, description, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (scope, key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [scope, key, JSON.stringify(value), SPECS.get(key)!.description, updatedBy],
    );
    this.invalidate();
  }

  /** Все настройки с текущими значениями и источником — для экрана настроек. */
  async describe(siteId?: string): Promise<
    Array<{ key: string; value: unknown; description: string; source: string }>
  > {
    const scopes = siteId ? [`site:${siteId}`, 'global'] : ['global'];
    const { rows } = await this.db.query<{ key: string; value: unknown; scope: string }>(
      `SELECT key, value, scope FROM settings WHERE scope = ANY($1)`,
      [scopes],
    );
    return KNOWN_SETTINGS.map((spec) => {
      const stored = scopes
        .map((scope) => rows.find((r) => r.key === spec.key && r.scope === scope))
        .find(Boolean);
      if (stored) {
        return {
          key: spec.key, value: stored.value, description: spec.description,
          source: stored.scope === 'global' ? 'база (глобально)' : 'база (сайт)',
        };
      }
      if (spec.env && this.env[spec.env] !== undefined) {
        return {
          key: spec.key, value: spec.parse(this.env[spec.env] as string),
          description: spec.description, source: `окружение (${spec.env})`,
        };
      }
      return {
        key: spec.key, value: spec.default, description: spec.description,
        source: 'значение по умолчанию',
      };
    });
  }
}
