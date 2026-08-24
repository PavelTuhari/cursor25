import { ApiError } from '../errors.js';
import type { BudgetCheck, CreateDocInput, UnaDocument, UnaGateway } from './gateway.js';

/**
 * Мок UNA для разработки и тестов, пока нет доступа к Oracle.
 *
 * Он намеренно повторяет инварианты, зашитые в пакетах PK_SEO_* (ТЗ ч. II §30):
 * AI не согласует, автор не согласует сам себя, повтор по ext_id не создаёт
 * дубль, сумма документа от AI ограничена. Иначе тесты на моке доказывали бы
 * не то поведение, которое будет в проде.
 */

export interface MockBudgetLine {
  div: string;
  period: string;
  article: string;
  channel?: string;
  plan: number;
  committed?: number;
  actual?: number;
}

export interface MockGatewayOptions {
  budgets?: MockBudgetLine[];
  /** Пользователи, считающиеся AI-сессиями (аналог настройки AI_TECH_USERS). */
  aiUsers?: string[];
  /** Предел суммы документа, создаваемого AI (аналог AI_MAX_DOC_SUMA). */
  aiMaxDocAmount?: number;
}

interface StoredDoc extends UnaDocument {
  author: string;
  ext_key: string;
  amount: number;
}

export class MockUnaGateway implements UnaGateway {
  private readonly docs = new Map<number, StoredDoc>();
  private readonly byExtKey = new Map<string, number>();
  private readonly budgets: MockBudgetLine[];
  private readonly aiUsers: Set<string>;
  private readonly aiMaxDocAmount: number;
  private nextCod = 1;

  constructor(options: MockGatewayOptions = {}) {
    this.budgets = options.budgets ?? [];
    this.aiUsers = new Set((options.aiUsers ?? ['SEO_AI_BOT']).map((u) => u.toUpperCase()));
    this.aiMaxDocAmount = options.aiMaxDocAmount ?? 10_000;
  }

  private isAi(actor: string): boolean {
    return this.aiUsers.has(actor.toUpperCase());
  }

  async checkBudget(input: {
    div: string;
    period: string;
    article: string;
    amount: number;
    channel?: string;
  }): Promise<BudgetCheck> {
    const lines = this.budgets.filter(
      (b) =>
        b.div === input.div &&
        b.period === input.period &&
        b.article === input.article &&
        (input.channel === undefined || (b.channel ?? null) === input.channel),
    );
    const plan = lines.reduce((sum, b) => sum + b.plan, 0);
    const committed = lines.reduce((sum, b) => sum + (b.committed ?? 0), 0);
    const actual = lines.reduce((sum, b) => sum + (b.actual ?? 0), 0);
    const available = plan - committed - actual;

    if (plan === 0) {
      return {
        plan, committed, actual, available,
        used_pct: null,
        is_allowed: false,
        reason: `Бюджет на период ${input.period} по статье ${input.article} не утверждён`,
      };
    }
    const used_pct = Math.round(((actual + committed) / plan) * 10_000) / 100;
    if (input.amount > available) {
      return {
        plan, committed, actual, available, used_pct,
        is_allowed: false,
        reason: `Превышение бюджета: запрошено ${input.amount}, доступно ${available}`,
      };
    }
    return { plan, committed, actual, available, used_pct, is_allowed: true, reason: null };
  }

  async createDocument(input: CreateDocInput): Promise<UnaDocument> {
    if (!input.ext_id || !input.ext_system) {
      throw ApiError.badRequest('ext_system и ext_id обязательны: без них нет идемпотентности');
    }
    const key = `${input.ext_system}:${input.ext_id}`;
    const existingCod = this.byExtKey.get(key);
    if (existingCod !== undefined) {
      return { ...this.docs.get(existingCod)!, created: false };
    }

    const actor = input.run_id ? 'SEO_AI_BOT' : 'system';
    if (this.isAi(actor) && (input.amount ?? 0) > this.aiMaxDocAmount) {
      throw ApiError.forbidden(
        `AI-сессии запрещено создавать документы на сумму свыше ${this.aiMaxDocAmount}. Требуется ручной ввод`,
      );
    }

    const cod = this.nextCod++;
    const year = input.doc_date.slice(0, 4);
    const seq = String(
      [...this.docs.values()].filter((d) => d.sysfid === input.sysfid).length + 1,
    ).padStart(4, '0');
    const doc: StoredDoc = {
      una_cod: cod,
      doc_no: `${input.sysfid}/${year}/${seq}`,
      sysfid: input.sysfid,
      status: 'draft',
      created: true,
      author: actor,
      ext_key: key,
      amount: input.amount ?? 0,
    };
    this.docs.set(cod, doc);
    this.byExtKey.set(key, cod);
    return doc;
  }

  private require(cod: number): StoredDoc {
    const doc = this.docs.get(cod);
    if (!doc) throw ApiError.notFound(`Документ UNA ${cod}`);
    return doc;
  }

  async submitDocument(cod: number, actor: string, _comment?: string): Promise<UnaDocument> {
    const doc = this.require(cod);
    if (doc.status !== 'draft') {
      throw ApiError.conflict(`Документ ${cod} в статусе "${doc.status}", ожидался "draft"`);
    }
    doc.status = 'submitted';
    doc.author = doc.author || actor;
    return { ...doc, created: false };
  }

  async approveDocument(cod: number, actor: string, _comment?: string): Promise<UnaDocument> {
    const doc = this.require(cod);
    if (this.isAi(actor)) {
      throw ApiError.forbidden('AI-сессия не может согласовывать документы');
    }
    if (doc.status !== 'submitted') {
      throw ApiError.conflict(`Документ ${cod} в статусе "${doc.status}", ожидался "submitted"`);
    }
    if (doc.author.toUpperCase() === actor.toUpperCase()) {
      throw ApiError.forbidden('Автор документа не может быть согласующим (принцип четырёх глаз)');
    }
    doc.status = 'approved';
    return { ...doc, created: false };
  }

  async getDocument(cod: number): Promise<UnaDocument | null> {
    const doc = this.docs.get(cod);
    return doc ? { ...doc, created: false } : null;
  }
}
