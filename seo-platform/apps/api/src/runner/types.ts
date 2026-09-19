import type { PlaybookFrontMatter } from '@seo/playbook-engine';

/** Что раннер получает на вход для одного исполнения плейбука. */
export interface RunInput {
  run_id: string;
  /** Полный текст .md — он же промпт сессии. */
  content: string;
  front_matter: PlaybookFrontMatter;
  /**
   * Разрешить запуск, когда часть инструментов из tools_allowed не реализована.
   * По умолчанию запрещено: молча выполнить SEO-задачу без доступа к выдаче
   * означает получить правдоподобный вымысел вместо данных.
   */
  allow_missing_tools?: boolean;
}

export interface RunCost {
  tokens_in: number;
  tokens_out: number;
  external_calls: number;
  amount: number;
  currency: string;
}

export interface RunArtifact {
  type: string;
  path: string;
  content?: string;
}

export type RunStatus = 'awaiting_approval' | 'success' | 'partial' | 'failed';

export interface RunOutcome {
  status: RunStatus;
  /** Разобранный report.json из ответа агента. */
  report: Record<string, unknown>;
  artifacts: RunArtifact[];
  cost: RunCost;
  error?: string;
}

export interface SessionRunner {
  readonly name: string;
  execute(input: RunInput): Promise<RunOutcome>;
}

/** Инструмент, доступный сессии. */
export interface RunnerTool {
  /** Имя из tools_allowed плейбука, например mcp-site. */
  id: string;
  /** Имя, под которым инструмент виден модели. */
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Считается ли вызов внешним обращением (для лимита max_external_calls). */
  external: boolean;
  run(input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

export interface ToolContext {
  run_id: string;
  /** Домены, к которым сессии разрешено обращаться. */
  network_allowlist: string[];
  /** Режим: в dry-run запрещены любые изменяющие действия. */
  run_mode: 'dry-run' | 'execute';
}

export class RunnerError extends Error {
  constructor(message: string, readonly kind: 'tools' | 'budget' | 'api' | 'report') {
    super(message);
    this.name = 'RunnerError';
  }
}
