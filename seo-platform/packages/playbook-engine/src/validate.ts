import { parseFrontMatter } from './frontmatter.js';
import type { PlaybookFrontMatter, ValidationIssue, ValidationResult } from './types.js';

/**
 * Проверка сгенерированного плейбука перед запуском AI-сессии.
 * Правила взяты из ТЗ ч. I §8 и ТЗ ч. II §29 (финансовые guardrails).
 */

/** Разделы, обязательные в теле любого плейбука. */
const REQUIRED_SECTIONS = [
  { pattern: /^##\s+.*Контекст/mu, code: 'MISSING_CONTEXT', label: 'Контекст' },
  { pattern: /^##\s+.*(Что нужно сделать|Задач)/mu, code: 'MISSING_TASKS', label: 'Что нужно сделать' },
  { pattern: /^##\s+.*Ограничения/mu, code: 'MISSING_GUARDRAILS', label: 'Ограничения' },
  { pattern: /^##\s+.*Критерии приёмки/mu, code: 'MISSING_ACCEPTANCE', label: 'Критерии приёмки' },
  { pattern: /^##\s+.*(Формат отчёта|report\.json)/mu, code: 'MISSING_REPORT', label: 'Формат отчёта' },
];

/** Признаки утечки секрета в текст плейбука (ТЗ ч. I NFR-5, ч. II §30). */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(sk|pk)-[A-Za-z0-9_-]{16,}/, label: 'API-ключ' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key' },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/, label: 'GitHub token' },
  { re: /password\s*[:=]\s*["']?\S{4,}/i, label: 'пароль' },
  { re: /\/\/[^\s/@:]+:[^\s/@]+@/, label: 'строка подключения с паролем' },
];

/** Финансовые запреты, обязательные для плейбуков фазы 6 (ТЗ ч. II, §29). */
const FINANCE_GUARDRAILS: Array<{ code: string; re: RegExp; label: string }> = [
  { code: 'FIN_NO_POSTING', re: /НЕ\s+проводить документы/iu, label: 'запрет проведения документов' },
  { code: 'FIN_NO_PAYMENT', re: /НЕ\s+создавать платёжные документы/iu, label: 'запрет платёжных документов' },
  { code: 'FIN_NO_REFS', re: /НЕ\s+трогать справочники/iu, label: 'запрет правки справочников' },
  { code: 'FIN_CHECK_LIMIT', re: /CHECK_LIMIT/u, label: 'обязательная проверка лимита бюджета' },
  { code: 'FIN_IDEMPOTENT', re: /p_ext_id/u, label: 'ключ идемпотентности p_ext_id' },
];

function error(code: string, message: string): ValidationIssue {
  return { severity: 'error', code, message };
}
function warning(code: string, message: string): ValidationIssue {
  return { severity: 'warning', code, message };
}

function validateFrontMatter(fm: Partial<PlaybookFrontMatter>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const required: Array<keyof PlaybookFrontMatter> = [
    'playbook_id', 'version', 'site', 'site_locale', 'generated_at',
    'run_mode', 'budget', 'tools_allowed', 'network_allowlist', 'approval_required', 'outputs',
  ];
  for (const key of required) {
    if (fm[key] === undefined || fm[key] === null) {
      issues.push(error('FM_MISSING_FIELD', `front-matter: отсутствует поле "${String(key)}"`));
    }
  }
  if (fm.run_mode && fm.run_mode !== 'dry-run' && fm.run_mode !== 'execute') {
    issues.push(error('FM_BAD_RUN_MODE', `run_mode должен быть dry-run или execute, получено "${fm.run_mode}"`));
  }
  if (fm.budget) {
    for (const key of ['max_tokens', 'max_minutes', 'max_external_calls'] as const) {
      const value = fm.budget[key];
      if (typeof value !== 'number' || value <= 0) {
        issues.push(error('FM_BAD_BUDGET', `budget.${key} должен быть положительным числом`));
      }
    }
  }
  if (Array.isArray(fm.tools_allowed) && fm.tools_allowed.length === 0) {
    issues.push(error('FM_NO_TOOLS', 'tools_allowed пуст: сессия не сможет ничего сделать'));
  }
  if (Array.isArray(fm.network_allowlist) && fm.network_allowlist.length === 0) {
    issues.push(warning('FM_NO_NETWORK', 'network_allowlist пуст: внешние запросы будут заблокированы'));
  }
  if (fm.run_mode === 'execute' && fm.approval_required === false) {
    issues.push(warning('FM_AUTONOMOUS', 'execute без approval_required: убедитесь, что уровень автономии допускает это'));
  }
  if (fm.una && typeof fm.una === 'object') {
    const una = fm.una as unknown as Record<string, unknown>;
    if (typeof una['secret_ref'] !== 'string' || !String(una['secret_ref']).startsWith('vault://')) {
      issues.push(error('UNA_BAD_SECRET_REF', 'una.secret_ref должен быть ссылкой вида vault://...'));
    }
    if (typeof una['tech_user'] !== 'string') {
      issues.push(error('UNA_NO_TECH_USER', 'una.tech_user не задан: непонятно, под кем сессия ходит в UNA'));
    }
  }
  return issues;
}

/** Проверяет полный текст плейбука. */
export function validatePlaybook(source: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  let fm: Partial<PlaybookFrontMatter> = {};
  let body = '';
  try {
    const parsed = parseFrontMatter<Partial<PlaybookFrontMatter>>(source);
    fm = parsed.data;
    body = parsed.body;
  } catch (err) {
    return { ok: false, issues: [error('FM_PARSE', (err as Error).message)] };
  }

  issues.push(...validateFrontMatter(fm));

  for (const section of REQUIRED_SECTIONS) {
    if (!section.pattern.test(body)) {
      issues.push(error(section.code, `в теле отсутствует раздел «${section.label}»`));
    }
  }

  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(source)) {
      issues.push(error('SECRET_LEAK', `похоже на секрет в тексте плейбука (${label}); используйте secret_ref`));
    }
  }

  const isFinancePhase = typeof fm.playbook_id === 'string' && fm.playbook_id.startsWith('6');
  if (isFinancePhase || fm.una) {
    for (const rule of FINANCE_GUARDRAILS) {
      if (!rule.re.test(body)) {
        issues.push(error(rule.code, `финансовый контур: в Ограничениях нет пункта «${rule.label}»`));
      }
    }
  }

  if (!/```json/.test(body)) {
    issues.push(warning('NO_REPORT_SCHEMA', 'не найден JSON-пример отчёта: агент может вернуть произвольный формат'));
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}
