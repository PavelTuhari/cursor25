import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybookFrontMatter } from '@seo/playbook-engine';
import { RunBudget } from '../runner/budget.js';
import { ClaudeRunner, extractReport } from '../runner/claude-runner.js';
import { RunWorker } from '../runner/worker.js';
import {
  ToolRegistry,
  assertToolsAvailable,
  defaultRegistry,
  isAllowedUrl,
  langCheckTool,
  siteFetchTool,
} from '../runner/tools.js';
import { RunnerError, type RunOutcome, type SessionRunner } from '../runner/types.js';
import type { Db } from '../db.js';
import { createTestDb } from './helpers.js';

const FM: PlaybookFrontMatter = {
  playbook_id: '31-article-draft',
  version: '1.0.0',
  site: 'una.md',
  site_locale: ['ru-MD'],
  generated_at: '2026-09-01T08:00:00.000Z',
  run_mode: 'execute',
  model_hint: 'claude-opus-5',
  budget: { max_tokens: 100_000, max_minutes: 10, max_external_calls: 3 },
  tools_allowed: ['mcp-site', 'mcp-lang'],
  network_allowlist: ['una.md'],
  approval_required: true,
  outputs: ['report.json'],
};

/** Подставной клиент: отдаёт заранее заготовленные ответы вместо вызовов API. */
function fakeClient(responses: Array<Record<string, unknown>>) {
  let index = 0;
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      messages: {
        stream(params: Record<string, unknown>) {
          calls.push(params);
          const response = responses[Math.min(index++, responses.length - 1)];
          return { finalMessage: async () => response };
        },
      },
    } as never,
  };
}

function textResponse(text: string, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage };
}

const REPORT_TEXT = [
  'Готово.',
  '```json',
  JSON.stringify({
    playbook_id: '31-article-draft',
    status: 'awaiting_approval',
    artifacts: [{ type: 'article', path: 'artifacts/article-draft.md', content: '# Черновик' }],
    open_questions: [],
  }),
  '```',
].join('\n');

describe('extractReport', () => {
  it('берёт JSON из блока ```json', () => {
    expect(extractReport(REPORT_TEXT)['status']).toBe('awaiting_approval');
  });

  it('берёт последний блок, если их несколько', () => {
    const text = '```json\n{"status":"partial"}\n```\ntext\n```json\n{"status":"success"}\n```';
    expect(extractReport(text)['status']).toBe('success');
  });

  it('разбирает голый JSON без ограждения', () => {
    expect(extractReport('{"status":"success"}')['status']).toBe('success');
  });

  it('падает осмысленно, если отчёта нет', () => {
    expect(() => extractReport('просто текст')).toThrow(RunnerError);
  });
});

describe('RunBudget', () => {
  const limits = { max_tokens: 1000, max_minutes: 5, max_external_calls: 2 };

  it('копит расход', () => {
    const budget = new RunBudget(limits);
    budget.addTokens(100, 50);
    expect(budget.usage).toMatchObject({ tokens_in: 100, tokens_out: 50 });
  });

  it('останавливает по лимиту токенов', () => {
    const budget = new RunBudget(limits);
    budget.addTokens(900, 200);
    expect(() => budget.check()).toThrow(/лимит токенов/);
  });

  it('останавливает по лимиту внешних вызовов', () => {
    const budget = new RunBudget(limits);
    budget.addExternalCall();
    budget.addExternalCall();
    expect(() => budget.addExternalCall()).toThrow(/внешних вызовов/);
  });

  it('останавливает по времени', () => {
    let now = 0;
    const budget = new RunBudget(limits, () => now);
    now = 6 * 60_000;
    expect(() => budget.check()).toThrow(/лимит времени/);
  });

  it('предупреждает о приближении к потолку', () => {
    const budget = new RunBudget(limits);
    budget.addTokens(800, 0);
    expect(budget.nearlyExhausted).toBe(true);
  });
});

describe('allowlist доменов', () => {
  it('пропускает сам домен и поддомены', () => {
    expect(isAllowedUrl('https://una.md/page', ['una.md'])).toBe(true);
    expect(isAllowedUrl('https://blog.una.md/x', ['una.md'])).toBe(true);
  });

  it('не пропускает чужой домен', () => {
    expect(isAllowedUrl('https://evil.com/x', ['una.md'])).toBe(false);
  });

  it('не покупается на домен, который лишь заканчивается на разрешённый', () => {
    expect(isAllowedUrl('https://notuna.md/x', ['una.md'])).toBe(false);
  });

  it('отвергает не-HTTP схемы', () => {
    expect(isAllowedUrl('file:///etc/passwd', ['una.md'])).toBe(false);
    expect(isAllowedUrl('не ссылка', ['una.md'])).toBe(false);
  });
});

describe('инструменты', () => {
  it('site_fetch отказывает домену вне allowlist, не обращаясь в сеть', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await siteFetchTool.run(
      { url: 'https://evil.com' },
      { run_id: 'r', network_allowlist: ['una.md'], run_mode: 'execute' },
    );
    expect(result).toMatch(/ОТКАЗАНО/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lang_check ловит отсутствие румынской диакритики', async () => {
    const out = JSON.parse(
      await langCheckTool.run(
        { text: 'Contabilitate pentru organizatii', locale: 'ro-MD' },
        { run_id: 'r', network_allowlist: [], run_mode: 'execute' },
      ),
    );
    expect(out.issues.join()).toMatch(/диакритич/);
  });

  it('lang_check ловит седиль вместо запятой снизу', async () => {
    const out = JSON.parse(
      await langCheckTool.run(
        { text: 'Acesta este un text cu ş şi ţ greşite', locale: 'ro-MD' },
        { run_id: 'r', network_allowlist: [], run_mode: 'execute' },
      ),
    );
    expect(out.issues.join()).toMatch(/седиль/);
  });

  it('lang_check считает плотность ключа и ловит переспам', async () => {
    const text = Array(10).fill('бухгалтерия НКО').join(' ');
    const out = JSON.parse(
      await langCheckTool.run(
        { text, keyword: 'бухгалтерия НКО', locale: 'ru-MD' },
        { run_id: 'r', network_allowlist: [], run_mode: 'execute' },
      ),
    );
    expect(out.keyword_density_pct).toBeGreaterThan(2.5);
    expect(out.issues.join()).toMatch(/плотность/);
  });

  it('lang_check ловит слишком длинный title', async () => {
    const out = JSON.parse(
      await langCheckTool.run(
        { text: 'текст', title: 'т'.repeat(70) },
        { run_id: 'r', network_allowlist: [], run_mode: 'execute' },
      ),
    );
    expect(out.issues.join()).toMatch(/title/);
  });
});

describe('проверка доступности инструментов', () => {
  const registry = defaultRegistry();

  it('пропускает, когда всё есть', () => {
    expect(assertToolsAvailable(registry, ['mcp-site', 'mcp-lang'], false)).toEqual([]);
  });

  it('отклоняет запуск, если инструмента нет', () => {
    expect(() => assertToolsAvailable(registry, ['mcp-serp'], false)).toThrow(/mcp-serp/);
  });

  it('разрешает частичный запуск по явному согласию и возвращает список недостающих', () => {
    expect(assertToolsAvailable(registry, ['mcp-site', 'mcp-serp'], true)).toEqual(['mcp-serp']);
  });
});

describe('ClaudeRunner', () => {
  it('исполняет плейбук и разбирает отчёт с артефактами', async () => {
    const { client } = fakeClient([textResponse(REPORT_TEXT)]);
    const runner = new ClaudeRunner({ client });
    const outcome = await runner.execute({ run_id: 'r-1', content: '# Задача', front_matter: FM });

    expect(outcome.status).toBe('awaiting_approval');
    expect(outcome.artifacts).toHaveLength(1);
    expect(outcome.artifacts[0]?.path).toBe('artifacts/article-draft.md');
  });

  it('считает стоимость по цене модели', async () => {
    const { client } = fakeClient([
      textResponse(REPORT_TEXT, { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ]);
    const outcome = await new ClaudeRunner({ client }).execute({
      run_id: 'r-2', content: '# Задача', front_matter: FM,
    });
    // claude-opus-5: $5 за миллион входных и $25 за миллион выходных.
    expect(outcome.cost.amount).toBeCloseTo(30);
  });

  it('передаёт модели только разрешённые инструменты', async () => {
    const { client, calls } = fakeClient([textResponse(REPORT_TEXT)]);
    await new ClaudeRunner({ client }).execute({
      run_id: 'r-3', content: '# Задача',
      front_matter: { ...FM, tools_allowed: ['mcp-lang'] },
    });
    const tools = (calls[0]?.['tools'] ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['lang_check']);
  });

  it('отклоняет запуск при недостающем инструменте', async () => {
    const { client } = fakeClient([textResponse(REPORT_TEXT)]);
    const outcome = await new ClaudeRunner({ client }).execute({
      run_id: 'r-4', content: '# Задача',
      front_matter: { ...FM, tools_allowed: ['mcp-serp'] },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/mcp-serp/);
  });

  it('при явном согласии запускается и помечает недостающие инструменты в отчёте', async () => {
    const { client } = fakeClient([textResponse(REPORT_TEXT)]);
    const outcome = await new ClaudeRunner({ client }).execute({
      run_id: 'r-5', content: '# Задача',
      front_matter: { ...FM, tools_allowed: ['mcp-site', 'mcp-serp'] },
      allow_missing_tools: true,
    });
    expect(outcome.status).toBe('awaiting_approval');
    expect(outcome.report['missing_tools']).toEqual(['mcp-serp']);
  });

  it('исполняет вызов инструмента и продолжает цикл', async () => {
    const toolCall = {
      content: [{ type: 'tool_use', id: 'tu-1', name: 'lang_check', input: { text: 'проверка' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 500, output_tokens: 100 },
    };
    const { client, calls } = fakeClient([toolCall, textResponse(REPORT_TEXT)]);
    const outcome = await new ClaudeRunner({ client }).execute({
      run_id: 'r-6', content: '# Задача', front_matter: FM,
    });
    expect(outcome.status).toBe('awaiting_approval');
    // Второй запрос должен нести результат инструмента.
    const second = calls[1]?.['messages'] as Array<{ role: string; content: unknown }>;
    expect(second.at(-1)?.role).toBe('user');
    expect(JSON.stringify(second.at(-1)?.content)).toContain('tool_result');
  });

  it('останавливается по лимиту токенов и не уходит в бесконечный цикл', async () => {
    const toolCall = {
      content: [{ type: 'tool_use', id: 'tu-1', name: 'lang_check', input: { text: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 60_000, output_tokens: 10_000 },
    };
    const { client } = fakeClient([toolCall]);
    const outcome = await new ClaudeRunner({ client }).execute({
      run_id: 'r-7', content: '# Задача', front_matter: FM,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/лимит токенов/);
  });

  it('добавляет в промпт пометку про dry-run', async () => {
    const { client, calls } = fakeClient([textResponse(REPORT_TEXT)]);
    await new ClaudeRunner({ client }).execute({
      run_id: 'r-8', content: '# Задача', front_matter: { ...FM, run_mode: 'dry-run' },
    });
    const messages = calls[0]?.['messages'] as Array<{ content: string }>;
    expect(messages[0]?.content).toMatch(/dry-run/);
  });
});

describe('RunWorker', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close();
  });

  async function queueRun(): Promise<string> {
    const site = await db.query<{ id: string }>(
      `INSERT INTO sites (domain, name, locales) VALUES ('una.md','UNA',ARRAY['ru-MD']) RETURNING id`,
    );
    const siteId = site.rows[0]!.id;
    const playbook = await db.query<{ id: string }>(
      `INSERT INTO playbooks (site_id, template_code, template_version, front_matter, body, content,
                              file_path, generated_at, created_by)
       VALUES ($1,'31-article-draft','1.0.0',$2,'body','content','path.md',now(),'test') RETURNING id`,
      [siteId, JSON.stringify(FM)],
    );
    const run = await db.query<{ id: string }>(
      `INSERT INTO task_runs (playbook_id, site_id, status, run_mode)
       VALUES ($1,$2,'queued','execute') RETURNING id`,
      [playbook.rows[0]!.id, siteId],
    );
    return run.rows[0]!.id;
  }

  const stubRunner = (outcome: RunOutcome): SessionRunner => ({
    name: 'stub',
    execute: async () => outcome,
  });

  const OK: RunOutcome = {
    status: 'awaiting_approval',
    report: { status: 'awaiting_approval' },
    artifacts: [{ type: 'article', path: 'artifacts/a.md', content: '# a' }],
    cost: { tokens_in: 100, tokens_out: 50, external_calls: 2, amount: 0.5, currency: 'USD' },
  };

  it('сообщает, что очередь пуста', async () => {
    const worker = new RunWorker({ db, runner: stubRunner(OK) });
    expect(await worker.processOne()).toBe(false);
  });

  it('забирает запуск, исполняет и сохраняет результат с артефактами', async () => {
    const runId = await queueRun();
    const worker = new RunWorker({ db, runner: stubRunner(OK) });
    expect(await worker.processOne()).toBe(true);

    const run = await db.query<{ status: string; cost_amount: string }>(
      `SELECT status, cost_amount FROM task_runs WHERE id = $1`, [runId],
    );
    expect(run.rows[0]?.status).toBe('awaiting_approval');
    expect(Number(run.rows[0]?.cost_amount)).toBeCloseTo(0.5);

    const artifacts = await db.query(`SELECT id FROM artifacts WHERE run_id = $1`, [runId]);
    expect(artifacts.rows).toHaveLength(1);
  });

  it('не берёт один и тот же запуск дважды', async () => {
    await queueRun();
    const worker = new RunWorker({ db, runner: stubRunner(OK) });
    expect(await worker.processOne()).toBe(true);
    expect(await worker.processOne()).toBe(false);
  });

  it('падение раннера не оставляет запуск в running', async () => {
    const runId = await queueRun();
    const worker = new RunWorker({
      db,
      runner: { name: 'boom', execute: async () => { throw new Error('раннер упал'); } },
    });
    await worker.processOne();
    const run = await db.query<{ status: string; error: string }>(
      `SELECT status, error FROM task_runs WHERE id = $1`, [runId],
    );
    expect(run.rows[0]?.status).toBe('failed');
    expect(run.rows[0]?.error).toMatch(/раннер упал/);
  });

  it('пишет завершение в аудит', async () => {
    const runId = await queueRun();
    await new RunWorker({ db, runner: stubRunner(OK) }).processOne();
    const log = await db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE run_id = $1`, [runId],
    );
    expect(log.rows.map((r) => r.action)).toContain('run.finish');
  });
});

describe('ToolRegistry', () => {
  it('находит инструмент по имени для модели', () => {
    const registry = new ToolRegistry().register(siteFetchTool);
    expect(registry.byName('site_fetch')?.id).toBe('mcp-site');
    expect(registry.byName('нет такого')).toBeUndefined();
  });
});
