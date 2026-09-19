import type { PlaybookBudget } from '@seo/playbook-engine';
import { RunnerError } from './types.js';

/**
 * Учёт лимитов одной сессии.
 *
 * Лимиты объявлены в front-matter плейбука и обязаны соблюдаться здесь, а не
 * «по договорённости» внутри промпта: модель не может себя ограничить, а
 * автономная сессия без потолка тратит деньги неограниченно.
 */
export class RunBudget {
  private tokensIn = 0;
  private tokensOut = 0;
  private externalCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: PlaybookBudget,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  get usage(): { tokens_in: number; tokens_out: number; external_calls: number } {
    return { tokens_in: this.tokensIn, tokens_out: this.tokensOut, external_calls: this.externalCalls };
  }

  get elapsedMinutes(): number {
    return (this.now() - this.startedAt) / 60_000;
  }

  addTokens(input: number, output: number): void {
    this.tokensIn += input;
    this.tokensOut += output;
  }

  /** Регистрирует внешний вызов. Бросает, если лимит исчерпан. */
  addExternalCall(): void {
    this.externalCalls += 1;
    if (this.externalCalls > this.limits.max_external_calls) {
      throw new RunnerError(
        `Исчерпан лимит внешних вызовов: ${this.limits.max_external_calls}`,
        'budget',
      );
    }
  }

  /** Осталось ли место на ещё один шаг. Проверяется между итерациями цикла. */
  check(): void {
    if (this.tokensIn + this.tokensOut > this.limits.max_tokens) {
      throw new RunnerError(
        `Исчерпан лимит токенов: ${this.limits.max_tokens} ` +
          `(израсходовано ${this.tokensIn + this.tokensOut})`,
        'budget',
      );
    }
    if (this.elapsedMinutes > this.limits.max_minutes) {
      throw new RunnerError(
        `Превышен лимит времени: ${this.limits.max_minutes} мин`,
        'budget',
      );
    }
  }

  /** Осталось ли ещё хотя бы четверть лимита токенов — сигнал сворачиваться. */
  get nearlyExhausted(): boolean {
    return this.tokensIn + this.tokensOut > this.limits.max_tokens * 0.75;
  }
}
