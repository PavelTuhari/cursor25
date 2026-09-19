-- =====================================================================
-- PK_SEO_GL: проведение маркетинговых документов.
--
-- Генерация проводок в UNA делается пакетом UN$GFC по настройкам, а не
-- прямыми INSERT в TMDB_CM. Его сигнатура в опубликованной документации не
-- раскрыта, поэтому здесь ровно одна точка интеграции — GENERATE_POSTINGS.
-- Пока она не заполнена, проведение отказывается работать и говорит почему:
-- это лучше, чем угадать интерфейс и тихо сформировать неверные проводки.
--
-- Всё остальное — определение счетов по настройкам, аналитика, проверка
-- статуса и лимита бюджета — реализовано и от UN$GFC не зависит.
-- =====================================================================
CREATE OR REPLACE PACKAGE PK_SEO_GL AS

    -- Готовит аналитику проводки по документу: счета из настроек,
    -- DIV = сайт, SC1 = канал, STRSC = кампания.
    TYPE t_posting IS RECORD (
        cont_dt     VARCHAR2(10),
        cont_ct     VARCHAR2(10),
        div         VARCHAR2(20),
        sc          NUMBER,          -- контрагент
        sc1         NUMBER,          -- канал продвижения
        strsc       VARCHAR2(50),    -- код кампании
        suma        NUMBER,
        valuta      VARCHAR2(3),
        suma_val    NUMBER,
        funct       VARCHAR2(20)
    );

    -- Собирает проводку для документа. Ничего не пишет.
    FUNCTION BUILD_POSTING (p_cod IN NUMBER) RETURN t_posting;

    -- Проводит документ. Требует статуса «Утверждён» и наличия бюджета.
    PROCEDURE POST_DOCUMENT (p_cod IN NUMBER);

    -- Отменяет проведение: проводки деактивируются, не удаляются.
    PROCEDURE UNPOST_DOCUMENT (p_cod IN NUMBER, p_comment IN VARCHAR2);

    -- Готова ли интеграция с генератором проводок.
    FUNCTION IS_GL_READY RETURN BOOLEAN;

END PK_SEO_GL;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_GL AS

    -- Переключатель интеграции. Ставится в 'Y' после того, как вызов
    -- UN$GFC в GENERATE_POSTINGS заполнен и проверен на тестовом периоде.
    C_SETUP_GL_READY CONSTANT VARCHAR2(32) := 'GL_INTEGRATION_READY';

    FUNCTION IS_GL_READY RETURN BOOLEAN IS
    BEGIN
        RETURN UPPER(NVL(PK_SEO_UTIL.GET_SETUP(C_SETUP_GL_READY), 'N')) = 'Y';
    END IS_GL_READY;

    FUNCTION BUILD_POSTING (p_cod IN NUMBER) RETURN t_posting IS
        v_posting   t_posting;
        v_sysfid    TMDB_DOCS.SYSFID%TYPE;
        v_div       TMDB_DOCS.DIV%TYPE;
        v_camp      VARCHAR2(50);
    BEGIN
        SELECT d.SYSFID, d.DIV, a.CAMP_CODE
          INTO v_sysfid, v_div, v_camp
          FROM TMDB_DOCS d
          LEFT JOIN TMDB_DOCS_ADD a ON a.COD = d.COD
         WHERE d.COD = p_cod;

        -- Счета берутся из настроек, а не из кода: смена плана счетов или
        -- учётной политики не должна требовать доработки (ТЗ ч. II §27).
        v_posting.cont_dt := PK_SEO_UTIL.GET_SETUP('ACC_MARKETING_EXPENSE');
        v_posting.cont_ct := PK_SEO_UTIL.GET_SETUP('ACC_SUPPLIER');
        v_posting.funct   := PK_SEO_UTIL.GET_SETUP('FUNCT_EXPENSE');
        v_posting.div     := v_div;
        v_posting.strsc   := v_camp;
        v_posting.valuta  := 'MDL';

        CASE v_sysfid
            WHEN 'WSEO08' THEN      -- расход на рекламу
                SELECT NVL(SUM(SUMA_MDL), 0), MAX(CHANNEL_COD1)
                  INTO v_posting.suma, v_posting.sc1
                  FROM YSEO_TMDB_ADSPEND_D WHERE NRDOC = p_cod;
            WHEN 'WSEO03' THEN      -- медиаплан
                SELECT NVL(SUM(SUMA), 0), MAX(CHANNEL_COD1)
                  INTO v_posting.suma, v_posting.sc1
                  FROM YSEO_TMDB_PLACE_D WHERE NRDOC = p_cod;
            ELSE
                MSG('PK_SEO_GL: для типа документа ' || v_sysfid ||
                    ' схема проводки не настроена');
        END CASE;

        RETURN v_posting;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            MSG('PK_SEO_GL: документ ' || p_cod || ' не найден');
            RETURN v_posting;
    END BUILD_POSTING;

    -- -----------------------------------------------------------------
    -- ЕДИНСТВЕННАЯ ТОЧКА ИНТЕГРАЦИИ С UN$GFC.
    --
    -- Заполнить после сверки сигнатуры с командой UNA, затем выставить
    -- настройку GL_INTEGRATION_READY = 'Y'. Ожидаемый вызов примерно такой:
    --
    --   UN$GFC.<процедура>(
    --       p_cod    => p_cod,
    --       p_dt     => p_posting.cont_dt,
    --       p_ct     => p_posting.cont_ct,
    --       p_suma   => p_posting.suma,
    --       p_div    => p_posting.div,
    --       p_sc1    => p_posting.sc1,
    --       p_strsc  => p_posting.strsc,
    --       p_funct  => p_posting.funct);
    --
    -- Прямой INSERT в TMDB_CM здесь недопустим: он обойдёт настройки
    -- генерации проводок и расчёт сальдо.
    -- -----------------------------------------------------------------
    PROCEDURE GENERATE_POSTINGS (p_cod IN NUMBER, p_posting IN t_posting) IS
    BEGIN
        MSG('PK_SEO_GL: интеграция с UN$GFC не настроена. ' ||
            'Документ ' || p_cod || ' не проведён. ' ||
            'Заполните GENERATE_POSTINGS в 08_pk_seo_gl.sql и выставьте ' ||
            'настройку ' || C_SETUP_GL_READY || ' = Y.');
    END GENERATE_POSTINGS;

    PROCEDURE POST_DOCUMENT (p_cod IN NUMBER) IS
        v_posting t_posting;
        v_period  VARCHAR2(10);
        v_date    DATE;
    BEGIN
        IF PK_SEO_UTIL.IS_AI_SESSION THEN
            MSG('PK_SEO_GL: AI-сессия не может проводить документы');
        END IF;

        -- Непроведение неутверждённого документа — жёсткое правило контура.
        PK_SEO_DOC.ASSERT_APPROVED(p_cod);

        IF NOT IS_GL_READY THEN
            MSG('PK_SEO_GL: проведение отключено, пока не настроена интеграция ' ||
                'с генератором проводок (' || C_SETUP_GL_READY || ' = N)');
        END IF;

        v_posting := BUILD_POSTING(p_cod);
        IF NNN(v_posting.suma) <= 0 THEN
            MSG('PK_SEO_GL: сумма документа ' || p_cod || ' равна нулю, проводить нечего');
        END IF;

        SELECT DATAMANUAL INTO v_date FROM TMDB_DOCS WHERE COD = p_cod;
        v_period := PK_SEO_UTIL.PERIOD_OF(v_date);

        -- Перерасход блокирует проведение: документ можно провести только
        -- после корректировки бюджета согласованием на уровень выше.
        PK_SEO_BUDGET.ASSERT_LIMIT(
            p_div          => v_posting.div,
            p_period       => v_period,
            p_article_cod1 => S2N(PK_SEO_UTIL.GET_SETUP('ARTICLE_ADS_DEFAULT')),
            p_suma         => v_posting.suma,
            p_channel_cod1 => v_posting.sc1);

        GENERATE_POSTINGS(p_cod, v_posting);
    END POST_DOCUMENT;

    PROCEDURE UNPOST_DOCUMENT (p_cod IN NUMBER, p_comment IN VARCHAR2) IS
    BEGIN
        IF PK_SEO_UTIL.IS_AI_SESSION THEN
            MSG('PK_SEO_GL: AI-сессия не может отменять проведение');
        END IF;
        IF p_comment IS NULL THEN
            MSG('PK_SEO_GL: комментарий к отмене проведения обязателен');
        END IF;
        -- Проводки деактивируются, а не удаляются: история должна остаться.
        UPDATE TMDB_CM SET ISVALID = 0 WHERE COD = p_cod;
        INSERT INTO TMDB_DOCS_LOG (COD, USERID, DATAOPER, STATUS_FROM, STATUS_TO, NOTE)
        VALUES (p_cod, PK_SEO_UTIL.CURRENT_ACTOR, SYSDATE, 'posted', 'approved', p_comment);
    END UNPOST_DOCUMENT;

END PK_SEO_GL;
/
