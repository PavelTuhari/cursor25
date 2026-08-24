/**
 * Доменные типы движка плейбуков.
 * Соответствуют ТЗ, часть I, §8 «Формат Playbook .md».
 */

/** Уровни автономии AI (ТЗ ч. I, §9). */
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export type RunMode = 'dry-run' | 'execute';

export type ApprovalStage = 'before_publish' | 'before_posting' | 'before_send' | 'none';

/** Фазы библиотеки шаблонов (ТЗ ч. I, §7). */
export type PlaybookPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface PlaybookBudget {
  max_tokens: number;
  max_minutes: number;
  max_external_calls: number;
}

/** YAML front-matter сгенерированного плейбука. */
export interface PlaybookFrontMatter {
  playbook_id: string;
  version: string;
  site: string;
  site_locale: string[];
  generated_at: string;
  run_mode: RunMode;
  model_hint?: string;
  budget: PlaybookBudget;
  tools_allowed: string[];
  network_allowlist: string[];
  approval_required: boolean;
  approval_stage?: ApprovalStage;
  outputs: string[];
  /** Учётный контур UNA (ТЗ ч. II). Присутствует только у плейбуков фазы 6. */
  una?: UnaBinding;
  [key: string]: unknown;
}

/** Привязка плейбука к документам UNA.md (ТЗ ч. II, §29). */
export interface UnaBinding {
  /** Номер документа-основания в UNA, напр. WSEO02/2026/0041. */
  campaign_doc?: string;
  /** Статьи бюджета, к которым обращается плейбук. */
  budget_article?: string;
  /** Технический пользователь UNA без прав проведения и оплаты. */
  tech_user: string;
  /** Ссылка на секрет в Vault. Сам секрет в плейбук не попадает никогда. */
  secret_ref: string;
}

/** Профиль продвигаемого сайта (ТЗ ч. I, §5.1). */
export interface SiteProfile {
  /** Домен, он же идентификатор: una.md, unisim-soft.com, officeplus.md. */
  domain: string;
  name: string;
  locales: string[];
  geo: string[];
  niche: string;
  /** Краткое описание, подставляется в раздел «Контекст сайта». */
  description: string;
  audience: string;
  tone_of_voice: string;
  /** Утверждения, которые агенту запрещено писать. */
  banned_claims: string[];
  competitors: string[];
  /** Подразделение UNA (DIV) для отнесения затрат. */
  una_div?: string;
}

export interface TemplateParamSpec {
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'object' | 'object[]';
  required: boolean;
  description: string;
}

/** Шаблон плейбука: заголовок из YAML + тело с плейсхолдерами. */
export interface PlaybookTemplate {
  code: string;
  version: string;
  title: string;
  phase: PlaybookPhase;
  autonomy: AutonomyLevel;
  /** Периодичность запуска в человекочитаемом виде. */
  cadence: string;
  defaults: {
    run_mode: RunMode;
    budget: PlaybookBudget;
    tools_allowed: string[];
    network_allowlist: string[];
    approval_required: boolean;
    approval_stage?: ApprovalStage;
    outputs: string[];
    model_hint?: string;
  };
  params_schema: Record<string, TemplateParamSpec>;
  /** Тело шаблона в Markdown с плейсхолдерами {{...}}. */
  body: string;
  /** Путь к исходному файлу шаблона. */
  source_path?: string;
}

export interface RenderContext {
  site: SiteProfile;
  /** Параметры конкретного запуска, проверяются по params_schema. */
  params: Record<string, unknown>;
  /** Момент генерации, ISO-8601. Передаётся явно ради воспроизводимости. */
  generated_at: string;
  run_mode?: RunMode;
  model_hint?: string;
  una?: UnaBinding;
  /** Переопределение бюджета для конкретной генерации. */
  budget?: Partial<PlaybookBudget>;
}

export interface RenderedPlaybook {
  /** Полный текст .md: front-matter + тело. */
  content: string;
  front_matter: PlaybookFrontMatter;
  body: string;
  template_code: string;
  template_version: string;
  /** Относительный путь для коммита в Git (ТЗ ч. I, §8.3). */
  suggested_path: string;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
