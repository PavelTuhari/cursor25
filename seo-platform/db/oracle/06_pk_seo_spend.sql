-- =====================================================================
-- PK_SEO_SPEND: импорт расходов рекламных кабинетов (документ D8),
-- PK_SEO_POST: регистрация факта публикации (документ D10).
--
-- Оба пакета идемпотентны по внешнему ключу: ежедневный автоимпорт и
-- повторный прогон за тот же период не должны множить строки и суммы.
-- =====================================================================
CREATE OR REPLACE PACKAGE PK_SEO_SPEND AS

    -- Загружает одну строку расхода. Возвращает 1, если строка добавлена,
    -- и 0, если она уже была загружена ранее (дубликат пропущен).
    FUNCTION IMPORT_ADSPEND (
        p_ext_system        IN VARCHAR2,
        p_ext_id            IN VARCHAR2,
        p_site_cod          IN NUMBER,
        p_channel_cod1      IN NUMBER,
        p_account_id        IN VARCHAR2,
        p_spend_date        IN DATE,
        p_account_campaign  IN VARCHAR2,
        p_camp_code         IN VARCHAR2,
        p_impressions       IN NUMBER,
        p_clicks            IN NUMBER,
        p_conversions       IN NUMBER,
        p_suma_val          IN NUMBER,
        p_valuta            IN VARCHAR2,
        p_run_id            IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER;

END PK_SEO_SPEND;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_SPEND AS

    -- Курс берём только из справочника валют UNA (TMS_SYSS 'S',3),
    -- а не из внешнего источника: иначе учёт разойдётся с бухгалтерией.
    FUNCTION GET_CURS (p_valuta IN VARCHAR2, p_date IN DATE) RETURN NUMBER IS
        v_curs NUMBER;
    BEGIN
        IF p_valuta = 'MDL' THEN
            RETURN 1;
        END IF;
        SELECT PRET INTO v_curs
          FROM TMS_SYSS
         WHERE TIP = 'S' AND COD = 3 AND DENUMIREA = p_valuta;
        RETURN v_curs;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            MSG('PK_SEO_SPEND: не найден курс валюты ' || p_valuta || ' на ' ||
                TO_CHAR(p_date, 'DD.MM.YYYY') || ' в справочнике TMS_SYSS (S,3)');
            RETURN NULL;
    END GET_CURS;

    FUNCTION IMPORT_ADSPEND (
        p_ext_system        IN VARCHAR2,
        p_ext_id            IN VARCHAR2,
        p_site_cod          IN NUMBER,
        p_channel_cod1      IN NUMBER,
        p_account_id        IN VARCHAR2,
        p_spend_date        IN DATE,
        p_account_campaign  IN VARCHAR2,
        p_camp_code         IN VARCHAR2,
        p_impressions       IN NUMBER,
        p_clicks            IN NUMBER,
        p_conversions       IN NUMBER,
        p_suma_val          IN NUMBER,
        p_valuta            IN VARCHAR2,
        p_run_id            IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER IS
        v_doc       NUMBER;
        v_nrdoc1    NUMBER;
        v_curs      NUMBER;
        v_suma_mdl  NUMBER;
        v_div       VARCHAR2(20);
        v_period    VARCHAR2(10) := PK_SEO_UTIL.PERIOD_OF(p_spend_date);
        v_check     PK_SEO_BUDGET.t_limit;
        v_over      NUMBER(1) := 0;
        v_exists    NUMBER;
    BEGIN
        IF p_ext_id IS NULL THEN
            MSG('PK_SEO_SPEND.IMPORT_ADSPEND: p_ext_id обязателен (идемпотентность)');
        END IF;

        -- Дубликат по внешнему ключу: молча пропускаем, но сообщаем вызывающему.
        SELECT COUNT(*) INTO v_exists
          FROM YSEO_XREF
         WHERE EXT_SYSTEM = p_ext_system AND EXT_ID = p_ext_id;
        IF v_exists > 0 THEN
            RETURN 0;
        END IF;

        SELECT DIV INTO v_div FROM YSEO_TMS_SITE WHERE COD = p_site_cod;

        v_curs     := GET_CURS(p_valuta, p_spend_date);
        v_suma_mdl := ROUND(NNN(p_suma_val) * NNN(v_curs), 2);

        -- Расход уже понесён: загрузку не блокируем, но помечаем перерасход
        -- и оставляем документ черновиком для разбора (ТЗ ч. II §25.2).
        v_check := PK_SEO_BUDGET.CHECK_LIMIT(v_div, v_period,
                       S2N(PK_SEO_UTIL.GET_SETUP('ARTICLE_ADS_DEFAULT')), v_suma_mdl, p_channel_cod1);
        IF v_check.is_allowed = 0 THEN
            v_over := 1;
            WARN('Перерасход по рекламе: ' || v_check.reason || ' (' || p_account_id ||
                 ', ' || TO_CHAR(p_spend_date, 'DD.MM.YYYY') || ')');
        END IF;

        -- Один документ D8 на кабинет и день: строки накапливаются в нём.
        v_doc := PK_SEO_DOC.CREATE_DOC(
            p_ext_system   => p_ext_system,
            p_ext_id       => 'DOC:' || p_account_id || ':' || TO_CHAR(p_spend_date, 'YYYY-MM-DD'),
            p_sysfid       => 'WSEO08',
            p_doc_date     => p_spend_date,
            p_div          => v_div,
            p_camp_code    => p_camp_code,
            p_run_id       => p_run_id,
            p_note         => 'Автоимпорт расходов ' || p_account_id);

        SELECT NVL(MAX(NRDOC1), 0) + 1 INTO v_nrdoc1
          FROM YSEO_TMDB_ADSPEND_D WHERE NRDOC = v_doc;

        INSERT INTO YSEO_TMDB_ADSPEND_D (
            NRDOC, NRDOC1, SITE_COD, CHANNEL_COD1, ACCOUNT_ID, SPEND_DATE,
            CAMP_CODE, ACCOUNT_CAMPAIGN, IMPRESSIONS, CLICKS, CONVERSIONS,
            SUMA_VAL, VALUTA, CURS, SUMA_MDL, IS_OVERBUDGET)
        VALUES (
            v_doc, v_nrdoc1, p_site_cod, p_channel_cod1, p_account_id, p_spend_date,
            p_camp_code, p_account_campaign, NNN(p_impressions), NNN(p_clicks), NNN(p_conversions),
            p_suma_val, p_valuta, v_curs, v_suma_mdl, v_over);

        INSERT INTO YSEO_XREF (EXT_SYSTEM, EXT_ID, UNA_TABLE, UNA_COD, DIRECTION, SYNCED_AT)
        VALUES (p_ext_system, p_ext_id, 'YSEO_TMDB_ADSPEND_D', v_doc, 'I', SYSDATE);

        RETURN 1;
    END IMPORT_ADSPEND;

END PK_SEO_SPEND;
/

CREATE OR REPLACE PACKAGE PK_SEO_POST AS

    -- Регистрирует факт публикации в реестре (D10). Идемпотентно по URL.
    FUNCTION REGISTER_PUBLICATION (
        p_ext_system    IN VARCHAR2,
        p_ext_id        IN VARCHAR2,
        p_site_cod      IN NUMBER,
        p_channel_cod1  IN NUMBER,
        p_platform_cod  IN NUMBER,
        p_camp_code     IN VARCHAR2,
        p_locale        IN VARCHAR2,
        p_format_cod1   IN NUMBER,
        p_title         IN VARCHAR2,
        p_url           IN VARCHAR2,
        p_published_at  IN DATE,
        p_cost_suma     IN NUMBER DEFAULT 0,
        p_valuta        IN VARCHAR2 DEFAULT 'MDL',
        p_run_id        IN VARCHAR2 DEFAULT NULL,
        p_playbook_sha  IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER;

END PK_SEO_POST;
/

CREATE OR REPLACE PACKAGE BODY PK_SEO_POST AS

    FUNCTION REGISTER_PUBLICATION (
        p_ext_system    IN VARCHAR2,
        p_ext_id        IN VARCHAR2,
        p_site_cod      IN NUMBER,
        p_channel_cod1  IN NUMBER,
        p_platform_cod  IN NUMBER,
        p_camp_code     IN VARCHAR2,
        p_locale        IN VARCHAR2,
        p_format_cod1   IN NUMBER,
        p_title         IN VARCHAR2,
        p_url           IN VARCHAR2,
        p_published_at  IN DATE,
        p_cost_suma     IN NUMBER DEFAULT 0,
        p_valuta        IN VARCHAR2 DEFAULT 'MDL',
        p_run_id        IN VARCHAR2 DEFAULT NULL,
        p_playbook_sha  IN VARCHAR2 DEFAULT NULL
    ) RETURN NUMBER IS
        v_doc    NUMBER;
        v_nrdoc1 NUMBER;
        v_div    VARCHAR2(20);
        v_exists NUMBER;
    BEGIN
        IF p_url IS NULL THEN
            MSG('PK_SEO_POST: URL публикации обязателен');
        END IF;

        SELECT COUNT(*) INTO v_exists FROM YSEO_TMDB_POST_D WHERE EXTERNAL_URL = p_url;
        IF v_exists > 0 THEN
            WARN('PK_SEO_POST: публикация ' || p_url || ' уже зарегистрирована');
            RETURN 0;
        END IF;

        PK_SEO_UTIL.ASSERT_AI_SUMA_LIMIT(p_cost_suma);
        SELECT DIV INTO v_div FROM YSEO_TMS_SITE WHERE COD = p_site_cod;

        -- Один документ-реестр на сайт и месяц публикации.
        v_doc := PK_SEO_DOC.CREATE_DOC(
            p_ext_system   => p_ext_system,
            p_ext_id       => 'POSTREG:' || p_site_cod || ':' || PK_SEO_UTIL.PERIOD_OF(p_published_at),
            p_sysfid       => 'WSEO10',
            p_doc_date     => LAST_DAY(p_published_at),
            p_div          => v_div,
            p_camp_code    => p_camp_code,
            p_run_id       => p_run_id,
            p_playbook_sha => p_playbook_sha,
            p_note         => 'Реестр публикаций');

        SELECT NVL(MAX(NRDOC1), 0) + 1 INTO v_nrdoc1 FROM YSEO_TMDB_POST_D WHERE NRDOC = v_doc;

        INSERT INTO YSEO_TMDB_POST_D (
            NRDOC, NRDOC1, SITE_COD, CHANNEL_COD1, PLATFORM_COD, CAMP_CODE, LOCALE,
            FORMAT_COD1, TITLE, EXTERNAL_URL, PUBLISHED_AT, COST_SUMA, VALUTA, RUN_ID, PLAYBOOK_SHA)
        VALUES (
            v_doc, v_nrdoc1, p_site_cod, p_channel_cod1, p_platform_cod, p_camp_code, p_locale,
            p_format_cod1, p_title, p_url, p_published_at, NNN(p_cost_suma), p_valuta, p_run_id, p_playbook_sha);

        INSERT INTO YSEO_XREF (EXT_SYSTEM, EXT_ID, UNA_TABLE, UNA_COD, DIRECTION, SYNCED_AT)
        VALUES (p_ext_system, p_ext_id, 'YSEO_TMDB_POST_D', v_doc, 'I', SYSDATE);

        RETURN 1;
    END REGISTER_PUBLICATION;

END PK_SEO_POST;
/
