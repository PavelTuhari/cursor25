-- =====================================================================
-- PK_SEO_DOC: жизненный цикл маркетинговых документов.
--
-- Инварианты, которые пакет обязан удерживать (ТЗ ч. II §22.3, §30):
--   * AI создаёт только черновики и никогда не согласует;
--   * автор не может быть согласующим (принцип четырёх глаз);
--   * документ не проводится, пока не утверждён;
--   * удаления нет - только ISVALID = 0;
--   * повторный вызов с тем же p_ext_id возвращает существующий документ.
--
-- DOCCOLOR используется как визуальный статус: 1 - жёлтый (черновик),
-- 2 - серый (на согласовании), 3 - голубой (утверждён).
-- =====================================================================
CREATE OR REPLACE PACKAGE PK_SEO_DOC AS

    C_COLOR_DRAFT     CONSTANT NUMBER := 1;
    C_COLOR_SUBMITTED CONSTANT NUMBER := 2;
    C_COLOR_APPROVED  CONSTANT NUMBER := 3;

    -- Создаёт шапку документа. Идемпотентно по (p_ext_system, p_ext_id).
    FUNCTION CREATE_DOC (
        p_ext_system    IN VARCHAR2,
        p_ext_id        IN VARCHAR2,
        p_sysfid        IN VARCHAR2,
        p_doc_date      IN DATE,
        p_div           IN VARCHAR2,
        p_camp_code     IN VARCHAR2 DEFAULT NULL,
        p_run_id        IN VARCHAR2 DEFAULT NULL,
        p_playbook_sha  IN VARCHAR2 DEFAULT NULL,
        p_note          IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER;

    PROCEDURE SUBMIT  (p_cod IN NUMBER, p_comment IN VARCHAR2 DEFAULT NULL);
    PROCEDURE APPROVE (p_cod IN NUMBER, p_comment IN VARCHAR2 DEFAULT NULL);
    PROCEDURE REJECT  (p_cod IN NUMBER, p_comment IN VARCHAR2);
    PROCEDURE CANCEL  (p_cod IN NUMBER, p_comment IN VARCHAR2);

    -- Проверка, что документ утверждён. Вызывается генератором проводок.
    PROCEDURE ASSERT_APPROVED (p_cod IN NUMBER);

    FUNCTION GET_STATUS (p_cod IN NUMBER) RETURN VARCHAR2;
    FUNCTION FIND_BY_EXT (p_ext_system IN VARCHAR2, p_ext_id IN VARCHAR2) RETURN NUMBER;

END PK_SEO_DOC;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_DOC AS

    -- Пишет переход в историю движения документа. TMDB_DOCS_LOG намеренно
    -- без FK - история должна пережить удаление документа.
    PROCEDURE LOG_MOVE (p_cod IN NUMBER, p_from IN VARCHAR2, p_to IN VARCHAR2, p_comment IN VARCHAR2) IS
    BEGIN
        INSERT INTO TMDB_DOCS_LOG (COD, USERID, DATAOPER, STATUS_FROM, STATUS_TO, NOTE)
        VALUES (p_cod, PK_SEO_UTIL.CURRENT_ACTOR, SYSDATE, p_from, p_to, p_comment);
    END LOG_MOVE;

    FUNCTION FIND_BY_EXT (p_ext_system IN VARCHAR2, p_ext_id IN VARCHAR2) RETURN NUMBER IS
        v_cod NUMBER;
    BEGIN
        SELECT UNA_COD INTO v_cod
          FROM YSEO_XREF
         WHERE EXT_SYSTEM = p_ext_system AND EXT_ID = p_ext_id;
        RETURN v_cod;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN RETURN NULL;
    END FIND_BY_EXT;

    FUNCTION GET_STATUS (p_cod IN NUMBER) RETURN VARCHAR2 IS
        v_color   NUMBER;
        v_isvalid NUMBER;
    BEGIN
        SELECT DOCCOLOR, ISVALID INTO v_color, v_isvalid FROM TMDB_DOCS WHERE COD = p_cod;
        IF v_isvalid = 0 THEN RETURN 'cancelled'; END IF;
        RETURN CASE v_color
                   WHEN C_COLOR_DRAFT     THEN 'draft'
                   WHEN C_COLOR_SUBMITTED THEN 'submitted'
                   WHEN C_COLOR_APPROVED  THEN 'approved'
                   ELSE 'unknown'
               END;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            MSG('PK_SEO_DOC: документ ' || p_cod || ' не найден');
            RETURN NULL;
    END GET_STATUS;

    FUNCTION CREATE_DOC (
        p_ext_system    IN VARCHAR2,
        p_ext_id        IN VARCHAR2,
        p_sysfid        IN VARCHAR2,
        p_doc_date      IN DATE,
        p_div           IN VARCHAR2,
        p_camp_code     IN VARCHAR2 DEFAULT NULL,
        p_run_id        IN VARCHAR2 DEFAULT NULL,
        p_playbook_sha  IN VARCHAR2 DEFAULT NULL,
        p_note          IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER IS
        v_existing NUMBER;
        v_cod      NUMBER;
        v_nr       VARCHAR2(50);
    BEGIN
        IF p_ext_id IS NULL OR p_ext_system IS NULL THEN
            MSG('PK_SEO_DOC.CREATE_DOC: p_ext_system и p_ext_id обязательны (идемпотентность)');
        END IF;

        -- Повторный вызов не создаёт второй документ.
        v_existing := FIND_BY_EXT(p_ext_system, p_ext_id);
        IF v_existing IS NOT NULL THEN
            WARN('PK_SEO_DOC: документ по ext_id ' || p_ext_id || ' уже существует (COD=' || v_existing || ')');
            RETURN v_existing;
        END IF;

        SELECT NVL(MAX(COD), 0) + 1 INTO v_cod FROM TMDB_DOCS;
        SELECT UN$G$UTIL.TextIncrement(NVL(MAX(NRMANUAL), p_sysfid || '/' || TO_CHAR(p_doc_date, 'YYYY') || '/0000'))
          INTO v_nr
          FROM TMDB_DOCS
         WHERE SYSFID = p_sysfid
           AND TO_CHAR(DATAMANUAL, 'YYYY') = TO_CHAR(p_doc_date, 'YYYY');

        INSERT INTO TMDB_DOCS (COD, SYSFID, DATAMANUAL, NRMANUAL, USERID, DIV, DOCCOLOR, ISVALID)
        VALUES (v_cod, p_sysfid, p_doc_date, v_nr, PK_SEO_UTIL.CURRENT_ACTOR, p_div, C_COLOR_DRAFT, 1);

        INSERT INTO TMDB_DOCS_ADD (COD, CAMP_CODE, RUN_ID, PLAYBOOK_SHA, NOTE)
        VALUES (v_cod, p_camp_code, p_run_id, p_playbook_sha, p_note);

        INSERT INTO YSEO_XREF (EXT_SYSTEM, EXT_ID, UNA_TABLE, UNA_COD, DIRECTION, SYNCED_AT)
        VALUES (p_ext_system, p_ext_id, 'TMDB_DOCS', v_cod, 'I', SYSDATE);

        LOG_MOVE(v_cod, NULL, 'draft', p_note);
        RETURN v_cod;
    END CREATE_DOC;

    PROCEDURE SUBMIT (p_cod IN NUMBER, p_comment IN VARCHAR2 DEFAULT NULL) IS
        v_status VARCHAR2(20) := GET_STATUS(p_cod);
    BEGIN
        IF v_status <> 'draft' THEN
            MSG('PK_SEO_DOC.SUBMIT: документ ' || p_cod || ' в статусе "' || v_status || '", ожидался "draft"');
        END IF;
        UPDATE TMDB_DOCS SET DOCCOLOR = C_COLOR_SUBMITTED WHERE COD = p_cod;
        LOG_MOVE(p_cod, 'draft', 'submitted', p_comment);
    END SUBMIT;

    PROCEDURE APPROVE (p_cod IN NUMBER, p_comment IN VARCHAR2 DEFAULT NULL) IS
        v_status VARCHAR2(20) := GET_STATUS(p_cod);
        v_author TMDB_DOCS.USERID%TYPE;
        v_actor  VARCHAR2(100) := PK_SEO_UTIL.CURRENT_ACTOR;
    BEGIN
        -- Согласование - исключительно человеческое действие.
        IF PK_SEO_UTIL.IS_AI_SESSION THEN
            MSG('PK_SEO_DOC.APPROVE: AI-сессия не может согласовывать документы');
        END IF;
        IF v_status <> 'submitted' THEN
            MSG('PK_SEO_DOC.APPROVE: документ ' || p_cod || ' в статусе "' || v_status || '", ожидался "submitted"');
        END IF;

        SELECT USERID INTO v_author FROM TMDB_DOCS WHERE COD = p_cod;
        IF UPPER(v_author) = UPPER(v_actor) THEN
            MSG('PK_SEO_DOC.APPROVE: автор документа не может быть согласующим (принцип четырёх глаз)');
        END IF;

        UPDATE TMDB_DOCS SET DOCCOLOR = C_COLOR_APPROVED WHERE COD = p_cod;
        LOG_MOVE(p_cod, 'submitted', 'approved', p_comment);
    END APPROVE;

    PROCEDURE REJECT (p_cod IN NUMBER, p_comment IN VARCHAR2) IS
        v_status VARCHAR2(20) := GET_STATUS(p_cod);
    BEGIN
        IF PK_SEO_UTIL.IS_AI_SESSION THEN
            MSG('PK_SEO_DOC.REJECT: AI-сессия не может отклонять документы');
        END IF;
        IF v_status <> 'submitted' THEN
            MSG('PK_SEO_DOC.REJECT: документ ' || p_cod || ' в статусе "' || v_status || '", ожидался "submitted"');
        END IF;
        IF p_comment IS NULL THEN
            MSG('PK_SEO_DOC.REJECT: комментарий обязателен');
        END IF;
        UPDATE TMDB_DOCS SET DOCCOLOR = C_COLOR_DRAFT WHERE COD = p_cod;
        LOG_MOVE(p_cod, 'submitted', 'rejected', p_comment);
    END REJECT;

    PROCEDURE CANCEL (p_cod IN NUMBER, p_comment IN VARCHAR2) IS
        v_status VARCHAR2(20) := GET_STATUS(p_cod);
    BEGIN
        IF PK_SEO_UTIL.IS_AI_SESSION THEN
            MSG('PK_SEO_DOC.CANCEL: AI-сессия не может аннулировать документы');
        END IF;
        IF v_status = 'cancelled' THEN
            WARN('PK_SEO_DOC.CANCEL: документ ' || p_cod || ' уже аннулирован');
            RETURN;
        END IF;
        -- Физического удаления нет и не будет: только деактивация.
        UPDATE TMDB_DOCS SET ISVALID = 0 WHERE COD = p_cod;
        UPDATE TMDB_CM   SET ISVALID = 0 WHERE COD = p_cod;
        LOG_MOVE(p_cod, v_status, 'cancelled', p_comment);
    END CANCEL;

    PROCEDURE ASSERT_APPROVED (p_cod IN NUMBER) IS
        v_status VARCHAR2(20) := GET_STATUS(p_cod);
    BEGIN
        IF v_status <> 'approved' THEN
            MSG('Документ ' || p_cod || ' не утверждён (статус "' || v_status ||
                '"): проведение запрещено');
        END IF;
    END ASSERT_APPROVED;

END PK_SEO_DOC;
/
