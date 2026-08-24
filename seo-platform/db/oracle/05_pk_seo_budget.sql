-- =====================================================================
-- PK_SEO_BUDGET: план/факт и контроль лимитов.
--
-- CHECK_LIMIT - главный предохранитель контура: его обязана вызывать
-- каждая AI-сессия перед действием, влекущим расход (ТЗ ч. II §25.2).
-- Именно здесь останавливается автономный агент, а не в приложении.
-- =====================================================================
CREATE OR REPLACE PACKAGE PK_SEO_BUDGET AS

    TYPE t_limit IS RECORD (
        plan_suma       NUMBER,
        committed_suma  NUMBER,
        actual_suma     NUMBER,
        available_suma  NUMBER,
        used_pct        NUMBER,
        is_allowed      NUMBER(1),
        reason          VARCHAR2(400)
    );

    -- Остаток по статье. p_channel_cod1 = NULL - бюджет статьи целиком.
    FUNCTION GET_AVAILABLE (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    ) RETURN NUMBER;

    -- Можно ли потратить p_suma. Не бросает исключение: возвращает вердикт,
    -- чтобы вызывающая сессия могла корректно завершиться и отчитаться.
    FUNCTION CHECK_LIMIT (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_suma          IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    ) RETURN t_limit;

    -- Жёсткий вариант для проведения документов: превышение - ошибка.
    PROCEDURE ASSERT_LIMIT (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_suma          IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    );

END PK_SEO_BUDGET;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_BUDGET AS

    FUNCTION GET_AVAILABLE (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    ) RETURN NUMBER IS
        v_available NUMBER;
    BEGIN
        SELECT NVL(SUM(AVAILABLE_SUMA), 0) INTO v_available
          FROM VSEO_BUDGET_PLANFACT
         WHERE DIV = p_div
           AND PERIOD = p_period
           AND ARTICLE_COD1 = p_article_cod1
           AND (p_channel_cod1 IS NULL OR NVL(CHANNEL_COD1, -1) = p_channel_cod1);
        RETURN v_available;
    END GET_AVAILABLE;

    FUNCTION CHECK_LIMIT (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_suma          IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    ) RETURN t_limit IS
        v_result  t_limit;
        v_warn_pct NUMBER := PK_SEO_UTIL.GET_SETUP_NUM('BUDGET_WARN_PCT');
    BEGIN
        SELECT NVL(SUM(PLAN_SUMA), 0),
               NVL(SUM(COMMITTED_SUMA), 0),
               NVL(SUM(ACTUAL_SUMA), 0),
               NVL(SUM(AVAILABLE_SUMA), 0)
          INTO v_result.plan_suma, v_result.committed_suma,
               v_result.actual_suma, v_result.available_suma
          FROM VSEO_BUDGET_PLANFACT
         WHERE DIV = p_div
           AND PERIOD = p_period
           AND ARTICLE_COD1 = p_article_cod1
           AND (p_channel_cod1 IS NULL OR NVL(CHANNEL_COD1, -1) = p_channel_cod1);

        IF NNN(v_result.plan_suma) = 0 THEN
            v_result.used_pct   := NULL;
            v_result.is_allowed := 0;
            v_result.reason     := 'Бюджет на период ' || p_period || ' по статье ' ||
                                   p_article_cod1 || ' не утверждён';
            RETURN v_result;
        END IF;

        v_result.used_pct := ROUND(
            (NNN(v_result.actual_suma) + NNN(v_result.committed_suma)) * 100 / NNN(v_result.plan_suma), 2);

        IF NNN(p_suma) > NNN(v_result.available_suma) THEN
            v_result.is_allowed := 0;
            v_result.reason     := 'Превышение бюджета: запрошено ' || p_suma ||
                                   ', доступно ' || v_result.available_suma;
        ELSE
            v_result.is_allowed := 1;
            v_result.reason     := NULL;
            IF v_result.used_pct >= NNN(v_warn_pct) THEN
                WARN('Бюджет ' || p_div || '/' || p_period || '/' || p_article_cod1 ||
                     ' освоен на ' || v_result.used_pct || '%');
            END IF;
        END IF;

        RETURN v_result;
    END CHECK_LIMIT;

    PROCEDURE ASSERT_LIMIT (
        p_div           IN VARCHAR2,
        p_period        IN VARCHAR2,
        p_article_cod1  IN NUMBER,
        p_suma          IN NUMBER,
        p_channel_cod1  IN NUMBER DEFAULT NULL
    ) IS
        v_check t_limit := CHECK_LIMIT(p_div, p_period, p_article_cod1, p_suma, p_channel_cod1);
    BEGIN
        IF v_check.is_allowed = 0 THEN
            MSG('PK_SEO_BUDGET: ' || v_check.reason ||
                '. Требуется документ «Корректировка бюджета» с согласованием на уровень выше');
        END IF;
    END ASSERT_LIMIT;

END PK_SEO_BUDGET;
/
