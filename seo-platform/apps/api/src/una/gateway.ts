/**
 * Шлюз к UNA.md.
 *
 * Платформа никогда не пишет в таблицы UNA напрямую — только через пакеты
 * PK_SEO_* (ТЗ ч. II §23.2). Интерфейс ниже повторяет их сигнатуры, так что
 * замена мока на Oracle не меняет вызывающий код.
 */

export interface BudgetCheck {
  plan: number;
  committed: number;
  actual: number;
  available: number;
  used_pct: number | null;
  is_allowed: boolean;
  reason: string | null;
}

export interface CreateDocInput {
  ext_system: string;
  /** Ключ идемпотентности: повторный вызов возвращает тот же документ. */
  ext_id: string;
  sysfid: string;
  doc_date: string;
  div: string;
  campaign_code?: string;
  run_id?: string;
  playbook_sha?: string;
  note?: string;
  amount?: number;
}

export interface UnaDocument {
  una_cod: number;
  doc_no: string;
  sysfid: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
  created: boolean;
}

export interface UnaGateway {
  checkBudget(input: {
    div: string;
    period: string;
    article: string;
    amount: number;
    channel?: string;
  }): Promise<BudgetCheck>;

  createDocument(input: CreateDocInput): Promise<UnaDocument>;
  submitDocument(cod: number, actor: string, comment?: string): Promise<UnaDocument>;
  approveDocument(cod: number, actor: string, comment?: string): Promise<UnaDocument>;
  getDocument(cod: number): Promise<UnaDocument | null>;
}
