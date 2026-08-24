import { ApiError } from '../errors.js';
import type { BudgetCheck, CreateDocInput, UnaDocument, UnaGateway } from './gateway.js';

/**
 * Реальный шлюз к UNA: вызовы пакетов PK_SEO_* через oracledb.
 *
 * Драйвер и пул подключений подключаются лениво, чтобы сборка и тесты
 * платформы не требовали Oracle Instant Client.
 *
 * Внимание: сигнатуры вызовов ниже соответствуют db/oracle/*.sql этого
 * репозитория. Часть внутренних деталей UNA (состав TMDB_DOCS_ADD, выдача COD,
 * кодировка DOCCOLOR) в опубликованной документации не раскрыта и помечена в
 * db/oracle/README.md — до сверки с командой UNA этот класс не включать в прод.
 */
export class OracleUnaGateway implements UnaGateway {
  constructor(
    private readonly config: { connectString: string; user: string; password: string },
  ) {}

  private async withConnection<T>(fn: (conn: any) => Promise<T>): Promise<T> {
    let oracledb: any;
    try {
      oracledb = await import('oracledb' as string);
    } catch {
      throw new ApiError(
        503,
        'Драйвер oracledb не установлен. Для работы с UNA поставьте oracledb и Instant Client либо используйте MockUnaGateway',
      );
    }
    const conn = await oracledb.default.getConnection(this.config);
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }

  async checkBudget(input: {
    div: string;
    period: string;
    article: string;
    amount: number;
    channel?: string;
  }): Promise<BudgetCheck> {
    return this.withConnection(async (conn) => {
      const result = await conn.execute(
        `BEGIN
           :res := PK_SEO_BUDGET.CHECK_LIMIT(:div, :period, :article, :amount, :channel);
         END;`,
        {
          div: input.div,
          period: input.period,
          article: Number(input.article),
          amount: input.amount,
          channel: input.channel ? Number(input.channel) : null,
          res: { dir: 3003 /* BIND_OUT */, type: 2003 /* OBJECT */ },
        },
      );
      const row = result.outBinds.res;
      return {
        plan: row.PLAN_SUMA,
        committed: row.COMMITTED_SUMA,
        actual: row.ACTUAL_SUMA,
        available: row.AVAILABLE_SUMA,
        used_pct: row.USED_PCT,
        is_allowed: row.IS_ALLOWED === 1,
        reason: row.REASON ?? null,
      };
    });
  }

  async createDocument(input: CreateDocInput): Promise<UnaDocument> {
    return this.withConnection(async (conn) => {
      const result = await conn.execute(
        `BEGIN
           :cod := PK_SEO_DOC.CREATE_DOC(:ext_system, :ext_id, :sysfid, TO_DATE(:doc_date,'YYYY-MM-DD'),
                                         :div, :camp_code, :run_id, :playbook_sha, :note);
         END;`,
        {
          ext_system: input.ext_system,
          ext_id: input.ext_id,
          sysfid: input.sysfid,
          doc_date: input.doc_date,
          div: input.div,
          camp_code: input.campaign_code ?? null,
          run_id: input.run_id ?? null,
          playbook_sha: input.playbook_sha ?? null,
          note: input.note ?? null,
          cod: { dir: 3003, type: 2010 /* NUMBER */ },
        },
        { autoCommit: true },
      );
      const cod = Number(result.outBinds.cod);
      const doc = await this.getDocument(cod);
      if (!doc) throw ApiError.notFound(`Документ UNA ${cod}`);
      return doc;
    });
  }

  private async changeStatus(cod: number, proc: 'SUBMIT' | 'APPROVE', actor: string, comment?: string) {
    return this.withConnection(async (conn) => {
      // Исполнитель передаётся контекстной переменной: пакеты читают её через
      // GET_ENV и по ней решают, AI это или человек.
      await conn.execute(`BEGIN ENVUN4.SET_ENV('SEO_ACTOR', :actor); END;`, { actor });
      await conn.execute(`BEGIN PK_SEO_DOC.${proc}(:cod, :comment); END;`, {
        cod,
        comment: comment ?? null,
      }, { autoCommit: true });
      const doc = await this.getDocument(cod);
      if (!doc) throw ApiError.notFound(`Документ UNA ${cod}`);
      return doc;
    });
  }

  async submitDocument(cod: number, actor: string, comment?: string): Promise<UnaDocument> {
    return this.changeStatus(cod, 'SUBMIT', actor, comment);
  }

  async approveDocument(cod: number, actor: string, comment?: string): Promise<UnaDocument> {
    return this.changeStatus(cod, 'APPROVE', actor, comment);
  }

  async getDocument(cod: number): Promise<UnaDocument | null> {
    return this.withConnection(async (conn) => {
      const result = await conn.execute(
        `SELECT d.COD, d.NRMANUAL, d.SYSFID, PK_SEO_DOC.GET_STATUS(d.COD) AS STATUS
           FROM TMDB_DOCS d WHERE d.COD = :cod`,
        { cod },
        { outFormat: 4002 /* OBJECT */ },
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        una_cod: row.COD,
        doc_no: row.NRMANUAL,
        sysfid: row.SYSFID,
        status: row.STATUS,
        created: false,
      };
    });
  }
}
