import type Anthropic from '@anthropic-ai/sdk';
import { RunBudget } from './budget.js';
import { assertToolsAvailable, defaultRegistry, type ToolRegistry } from './tools.js';
import {
  RunnerError,
  type RunArtifact,
  type RunInput,
  type RunOutcome,
  type RunStatus,
  type SessionRunner,
  type ToolContext,
} from './types.js';

/**
 * Цены за миллион токенов. Вынесены в настройку, потому что попадают
 * в статью бюджета «AI-токены»: занижение здесь искажает ROI канала.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const DEFAULT_MODEL = 'claude-opus-5';

/** Извлекает последний JSON-блок из текста ответа. */
export function extractReport(text: string): Record<string, unknown> {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  const candidates = blocks.length > 0 ? blocks : [text];
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // пробуем следующий блок
    }
  }
  throw new RunnerError('Сессия не вернула report.json в разборном виде', 'report');
}

function normalizeStatus(value: unknown): RunStatus {
  const allowed: RunStatus[] = ['awaiting_approval', 'success', 'partial', 'failed'];
  return allowed.includes(value as RunStatus) ? (value as RunStatus) : 'partial';
}

function collectArtifacts(report: Record<string, unknown>): RunArtifact[] {
  const raw = report['artifacts'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      type: String(item['type'] ?? 'file'),
      path: String(item['path'] ?? ''),
      content: typeof item['content'] === 'string' ? item['content'] : undefined,
    }))
    .filter((artifact) => artifact.path !== '');
}

export interface ClaudeRunnerOptions {
  client: Anthropic;
  registry?: ToolRegistry;
  /** Потолок итераций цикла: защита от бесконечного хождения по инструментам. */
  maxIterations?: number;
}

/**
 * Исполнение плейбука через Messages API.
 *
 * Цикл написан вручную, а не через tool_runner, потому что между итерациями
 * нужно проверять бюджет сессии и останавливать её по лимиту — хук, которого
 * у готового раннера нет.
 */
export class ClaudeRunner implements SessionRunner {
  readonly name = 'claude';
  private readonly registry: ToolRegistry;
  private readonly maxIterations: number;

  constructor(private readonly options: ClaudeRunnerOptions) {
    this.registry = options.registry ?? defaultRegistry();
    this.maxIterations = options.maxIterations ?? 24;
  }

  async execute(input: RunInput): Promise<RunOutcome> {
    const { front_matter: fm } = input;
    const budget = new RunBudget(fm.budget);
    const model = fm.model_hint ?? DEFAULT_MODEL;
    const context: ToolContext = {
      run_id: input.run_id,
      network_allowlist: fm.network_allowlist,
      run_mode: fm.run_mode,
    };

    let lastText = '';
    try {
      // Проверка внутри try: нехватка инструментов — это неуспешный запуск
      // с понятной причиной в отчёте, а не исключение наружу.
      const missing = assertToolsAvailable(
        this.registry,
        fm.tools_allowed,
        input.allow_missing_tools === true,
      );
      const tools = this.registry.resolve(fm.tools_allowed);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: this.buildPrompt(input, missing) },
      ];

      for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
        budget.check();

        const stream = this.options.client.messages.stream({
          model,
          max_tokens: 64_000,
          system: SYSTEM_PROMPT,
          messages,
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.input_schema as Anthropic.Tool['input_schema'],
                  strict: true,
                })),
              }
            : {}),
        });
        const response = await stream.finalMessage();
        budget.addTokens(response.usage.input_tokens, response.usage.output_tokens);

        lastText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n');

        if (response.stop_reason !== 'tool_use') {
          return this.finish(lastText, budget, model, missing);
        }

        messages.push({ role: 'assistant', content: response.content });
        const results = await this.runTools(response.content, context, budget);
        // Все результаты возвращаются одним сообщением: разнесение по разным
        // сообщениям отучает модель вызывать инструменты параллельно.
        messages.push({ role: 'user', content: results });

        if (budget.nearlyExhausted) {
          messages.push({
            role: 'user',
            content:
              'Бюджет сессии почти исчерпан. Заверши работу и верни report.json ' +
              'с тем, что уже сделано, а незавершённое перечисли в open_questions.',
          });
        }
      }
      throw new RunnerError(`Сессия не завершилась за ${this.maxIterations} итераций`, 'budget');
    } catch (error) {
      const usage = budget.usage;
      return {
        status: 'failed',
        report: { error: (error as Error).message },
        artifacts: [],
        cost: this.priceOf(usage, model),
        error: (error as Error).message,
      };
    }
  }

  private async runTools(
    content: Anthropic.ContentBlock[],
    context: ToolContext,
    budget: RunBudget,
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const calls = content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const tool = this.registry.byName(call.name);
      if (!tool) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Инструмент ${call.name} недоступен в этой сессии`,
        });
        continue;
      }
      try {
        if (tool.external) budget.addExternalCall();
        const output = await tool.run(call.input as Record<string, unknown>, context);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: output });
      } catch (error) {
        if (error instanceof RunnerError && error.kind === 'budget') throw error;
        // Ошибка инструмента возвращается модели, а не роняет сессию:
        // она должна решить, обойтись без него или остановиться.
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Ошибка инструмента: ${(error as Error).message}`,
        });
      }
    }
    return results;
  }

  private finish(
    text: string,
    budget: RunBudget,
    model: string,
    missing: string[],
  ): RunOutcome {
    const report = extractReport(text);
    if (missing.length > 0) {
      report['missing_tools'] = missing;
    }
    return {
      status: normalizeStatus(report['status']),
      report,
      artifacts: collectArtifacts(report),
      cost: this.priceOf(budget.usage, model),
    };
  }

  private priceOf(
    usage: { tokens_in: number; tokens_out: number; external_calls: number },
    model: string,
  ) {
    const price = MODEL_PRICES[model];
    const amount = price
      ? (usage.tokens_in * price.input + usage.tokens_out * price.output) / 1_000_000
      : 0;
    return {
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      external_calls: usage.external_calls,
      amount: Number(amount.toFixed(4)),
      currency: 'USD',
    };
  }

  private buildPrompt(input: RunInput, missing: string[]): string {
    const parts = [input.content];
    if (missing.length > 0) {
      parts.push(
        '\n---\n\n## Недоступные инструменты\n\n' +
          `В этой сессии недоступны: ${missing.join(', ')}.\n` +
          'Не придумывай данные, которые они должны были дать. Каждый пункт задачи, ' +
          'который без них не выполняется, пометь `[TODO: нет доступа к инструменту]` ' +
          'и перечисли в `open_questions` отчёта.',
      );
    }
    if (input.front_matter.run_mode === 'dry-run') {
      parts.push(
        '\n---\n\n## Режим\n\nЗапуск в режиме dry-run: никаких изменяющих действий, только чтение и подготовка артефактов.',
      );
    }
    return parts.join('\n');
  }
}

const SYSTEM_PROMPT = `Ты исполняешь SEO-плейбук — задание с контекстом, шагами, ограничениями и форматом отчёта.

Правила, которые важнее содержания задачи:
1. Соблюдай раздел «Ограничения» буквально. Если шаг задачи противоречит ограничению, выполняется ограничение.
2. Не выдумывай факты, цифры, кейсы, отзывы и названия клиентов. Чего нет в контексте или в ответах инструментов — помечай [TODO: уточнить].
3. Ничего не публикуй и не отправляй наружу. Артефакты готовятся для человеческого утверждения.
4. Последним сообщением верни report.json в блоке \`\`\`json по схеме из плейбука.
   Обязательные поля: status, cost. Файлы перечисляй в artifacts: [{type, path, content}],
   где content — полный текст артефакта.
5. Если задача выполнена частично — status: "partial", а причины в open_questions.`;
