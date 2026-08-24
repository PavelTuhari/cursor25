-- =====================================================================
-- PK_SEO_UTIL: настройки контура, определение AI-сессии, аудит.
-- Используются штатные механизмы UNA: GET_ENV вместо SYS_CONTEXT,
-- MSG для ошибок, WARN для предупреждений, NNN/S2N для чисел.
-- =====================================================================
CREATE OR REPLACE PACKAGE PK_SEO_UTIL AS

    -- Значение настройки из YSEO_TMS_SETUP. Отсутствие ключа - ошибка,
    -- а не молчаливый NULL: иначе проводка уйдёт на пустой счёт.
    FUNCTION GET_SETUP (p_key IN VARCHAR2) RETURN VARCHAR2;
    FUNCTION GET_SETUP_NUM (p_key IN VARCHAR2) RETURN NUMBER;

    -- Текущий исполнитель: логин пользователя либо технический пользователь AI.
    FUNCTION CURRENT_ACTOR RETURN VARCHAR2;

    -- TRUE, если текущая сессия - AI. От этого зависят все ограничения:
    -- AI не согласует, не проводит и не платит.
    FUNCTION IS_AI_SESSION RETURN BOOLEAN;

    -- Проверка предела суммы для документов, создаваемых AI.
    PROCEDURE ASSERT_AI_SUMA_LIMIT (p_suma IN NUMBER);

    -- Период YYYY-MM из даты.
    FUNCTION PERIOD_OF (p_date IN DATE) RETURN VARCHAR2;

END PK_SEO_UTIL;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_UTIL AS

    FUNCTION GET_SETUP (p_key IN VARCHAR2) RETURN VARCHAR2 IS
        v_value YSEO_TMS_SETUP.PARAM_VALUE%TYPE;
    BEGIN
        SELECT PARAM_VALUE INTO v_value FROM YSEO_TMS_SETUP WHERE PARAM_KEY = p_key;
        RETURN v_value;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            MSG('PK_SEO_UTIL: не задана настройка "' || p_key || '" в YSEO_TMS_SETUP');
            RETURN NULL;
    END GET_SETUP;

    FUNCTION GET_SETUP_NUM (p_key IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN S2N(GET_SETUP(p_key));
    END GET_SETUP_NUM;

    FUNCTION CURRENT_ACTOR RETURN VARCHAR2 IS
        v_actor VARCHAR2(100);
    BEGIN
        v_actor := GET_ENV('SEO_ACTOR');
        IF v_actor IS NULL THEN
            v_actor := SYS_CONTEXT('USERENV', 'SESSION_USER');
        END IF;
        RETURN v_actor;
    END CURRENT_ACTOR;

    FUNCTION IS_AI_SESSION RETURN BOOLEAN IS
        v_list  VARCHAR2(400) := ',' || REPLACE(GET_SETUP('AI_TECH_USERS'), ' ') || ',';
        v_actor VARCHAR2(100) := UPPER(CURRENT_ACTOR);
    BEGIN
        RETURN INSTR(UPPER(v_list), ',' || v_actor || ',') > 0;
    END IS_AI_SESSION;

    PROCEDURE ASSERT_AI_SUMA_LIMIT (p_suma IN NUMBER) IS
        v_limit NUMBER;
    BEGIN
        IF NOT IS_AI_SESSION THEN
            RETURN;
        END IF;
        v_limit := GET_SETUP_NUM('AI_MAX_DOC_SUMA');
        IF NNN(p_suma) > NNN(v_limit) THEN
            MSG('AI-сессии запрещено создавать документы на сумму свыше ' || v_limit ||
                '. Требуется ручной ввод. Запрошено: ' || p_suma);
        END IF;
    END ASSERT_AI_SUMA_LIMIT;

    FUNCTION PERIOD_OF (p_date IN DATE) RETURN VARCHAR2 IS
    BEGIN
        RETURN TO_CHAR(p_date, 'YYYY-MM');
    END PERIOD_OF;

END PK_SEO_UTIL;
/
