import { describe, expect, it } from 'vitest';
import { validatePlaybook } from '../validate.js';

const VALID = `---
playbook_id: 31-article-draft
version: 1.0.0
site: una.md
site_locale: [ru-MD]
generated_at: 2026-09-01T08:00:00.000Z
run_mode: execute
budget: { max_tokens: 1000, max_minutes: 10, max_external_calls: 5 }
tools_allowed: [mcp-site]
network_allowlist: [una.md]
approval_required: true
outputs: [report.json]
---

# Задача

## 1. Контекст сайта
текст

## 2. Что нужно сделать
шаги

## 3. Ограничения
- нельзя всё подряд

## 4. Критерии приёмки
- [ ] сделано

## 5. Формат отчёта
\`\`\`json
{"status": "success"}
\`\`\`
`;

const codes = (src: string) => validatePlaybook(src).issues.map((i) => i.code);

describe('validatePlaybook', () => {
  it('принимает корректный плейбук', () => {
    const result = validatePlaybook(VALID);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('отклоняет документ без front-matter', () => {
    expect(codes('# просто markdown')).toContain('FM_PARSE');
  });

  it('требует обязательные поля front-matter', () => {
    expect(codes(VALID.replace('site: una.md\n', ''))).toContain('FM_MISSING_FIELD');
  });

  it('ловит нулевой бюджет', () => {
    const broken = VALID.replace('max_tokens: 1000', 'max_tokens: 0');
    expect(codes(broken)).toContain('FM_BAD_BUDGET');
  });

  it('ловит пустой список инструментов', () => {
    expect(codes(VALID.replace('tools_allowed: [mcp-site]', 'tools_allowed: []'))).toContain('FM_NO_TOOLS');
  });

  it('требует раздел Ограничения', () => {
    const broken = VALID.replace('## 3. Ограничения\n- нельзя всё подряд\n', '');
    expect(codes(broken)).toContain('MISSING_GUARDRAILS');
  });

  it('ловит утечку API-ключа в тексте', () => {
    const leaked = VALID.replace('текст', 'ключ sk-abcdefghijklmnopqrstuvwxyz012345');
    const result = validatePlaybook(leaked);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('SECRET_LEAK');
  });

  it('ловит строку подключения с паролем', () => {
    const leaked = VALID.replace('текст', 'oracle://un4:Passw0rd@db.internal:1521/UNASYS');
    expect(codes(leaked)).toContain('SECRET_LEAK');
  });

  it('предупреждает про execute без approval', () => {
    const risky = VALID.replace('approval_required: true', 'approval_required: false');
    const result = validatePlaybook(risky);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('FM_AUTONOMOUS');
  });

  it('требует финансовые guardrails у плейбуков фазы 6', () => {
    const finance = VALID.replace('playbook_id: 31-article-draft', 'playbook_id: 60-campaign-launch');
    const result = validatePlaybook(finance);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['FIN_NO_POSTING', 'FIN_NO_PAYMENT', 'FIN_CHECK_LIMIT', 'FIN_IDEMPOTENT']),
    );
  });

  it('требует финансовые guardrails у любого плейбука с блоком una', () => {
    const withUna = VALID.replace(
      'outputs: [report.json]',
      'outputs: [report.json]\nuna: { tech_user: BOT, secret_ref: "vault://una/bot" }',
    );
    expect(validatePlaybook(withUna).ok).toBe(false);
  });

  it('отклоняет una.secret_ref, не являющийся ссылкой на Vault', () => {
    const bad = VALID.replace(
      'outputs: [report.json]',
      'outputs: [report.json]\nuna: { tech_user: BOT, secret_ref: "hunter2" }',
    );
    expect(codes(bad)).toContain('UNA_BAD_SECRET_REF');
  });
});
