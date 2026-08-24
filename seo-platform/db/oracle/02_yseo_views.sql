-- =====================================================================
-- Вьюшки контура. По соглашению UNA прикладной код обращается к вьюшкам,
-- а не к таблицам напрямую. Вычисляемые поля именуются CLC[Field]T.
-- =====================================================================

-- Сайты с расшифровкой наименования из универсального справочника.
CREATE OR REPLACE VIEW VSEO_SITE AS
SELECT s.COD,
       s.DOMAIN,
       s.LOCALES,
       s.GEO,
       s.DIV,
       s.NICHE,
       s.ISARHIV,
       (SELECT u.DENUMIREA FROM TMS_UNIVERS u WHERE u.COD = s.COD) AS CLCDENUMIREAT
  FROM YSEO_TMS_SITE s;

-- Площадки с расшифровкой канала и контрагента.
CREATE OR REPLACE VIEW VSEO_PLATFORM AS
SELECT p.COD,
       p.PLATFORM_CODE,
       p.URL,
       p.CHANNEL_COD1,
       p.GEO,
       p.HAS_API,
       p.MANUAL_PUBLISH,
       p.QUALITY_SCORE,
       p.RATE_LIMIT_DAY,
       p.POSTING_RULES,
       p.ISARHIV,
       (SELECT u.DENUMIREA FROM TMS_UNIVERS u WHERE u.COD = p.COD) AS CLCDENUMIREAT,
       (SELECT v.DENUMIREA FROM TMS_SYSS v
         WHERE v.TIP = 'W' AND v.COD = 1 AND v.COD1 = p.CHANNEL_COD1) AS CLCCHANNELT
  FROM YSEO_TMS_PLATFORM p;

-- Кампании: шапка документа плюс строка, с датой и статусом документа.
CREATE OR REPLACE VIEW VSEO_CAMPAIGN AS
SELECT c.NRDOC,
       c.NRDOC1,
       c.CAMP_CODE,
       c.SITE_COD,
       c.NAME_RU,
       c.NAME_RO,
       c.NAME_EN,
       c.PROMO_TYPE_COD1,
       c.DISCOUNT_VALUE,
       c.PROMO_CODE,
       c.DATE_START,
       c.DATE_END,
       c.BUDGET_PLAN,
       c.KPI_TARGET,
       c.LEGAL_TEXT_REF,
       d.DATAMANUAL,
       d.NRMANUAL,
       d.SYSFID,
       d.DIV,
       d.ISVALID,
       (SELECT v.DENUMIREA FROM TMS_SYSS v
         WHERE v.TIP = 'W' AND v.COD = 4 AND v.COD1 = c.PROMO_TYPE_COD1) AS CLCPROMOTYPET,
       (SELECT s.DOMAIN FROM YSEO_TMS_SITE s WHERE s.COD = c.SITE_COD) AS CLCSITET
  FROM YSEO_TMDB_CAMP_D c
  JOIN TMDB_DOCS d ON d.COD = c.NRDOC
 WHERE d.ISVALID = 1;

-- План бюджета по действующим (не аннулированным) документам D1.
CREATE OR REPLACE VIEW VSEO_BUDGET_PLAN AS
SELECT b.PERIOD,
       b.ARTICLE_COD1,
       b.CHANNEL_COD1,
       b.SITE_COD,
       s.DIV,
       b.VALUTA,
       SUM(b.PLAN_SUMA) AS PLAN_SUMA
  FROM YSEO_TMDB_BUDG_D b
  JOIN TMDB_DOCS d ON d.COD = b.NRDOC
  LEFT JOIN YSEO_TMS_SITE s ON s.COD = b.SITE_COD
 WHERE d.ISVALID = 1
 GROUP BY b.PERIOD, b.ARTICLE_COD1, b.CHANNEL_COD1, b.SITE_COD, s.DIV, b.VALUTA;

-- Факт затрат по проводкам маркетинга.
-- Разрез: DTDIV = сайт, DTSC1 = канал, DTSTRSC = кампания (ТЗ ч. II §21.4).
-- Счета затрат перечислены в настройке, а не зашиты: см. YSEO_TMS_SETUP.
CREATE OR REPLACE VIEW VSEO_SPEND_FACT AS
SELECT TO_CHAR(d.DATAMANUAL, 'YYYY-MM') AS PERIOD,
       cm.DTDIV                          AS DIV,
       cm.DTSC1                          AS CHANNEL_COD1,
       cm.DTSTRSC                        AS CAMP_CODE,
       cm.DT                             AS CONT,
       SUM(cm.SUMA)                      AS ACTUAL_SUMA
  FROM TMDB_CM cm
  JOIN TMDB_DOCS d ON d.COD = cm.COD
 WHERE cm.ISVALID = 1
   AND d.ISVALID  = 1
   AND cm.FUNCT IN ('MKTACC', 'MKTALLOC')
 GROUP BY TO_CHAR(d.DATAMANUAL, 'YYYY-MM'), cm.DTDIV, cm.DTSC1, cm.DTSTRSC, cm.DT;

-- Сводный план/факт. Committed считается по утверждённым, но ещё не проведённым
-- документам-обязательствам (медиапланы и договоры).
CREATE OR REPLACE VIEW VSEO_BUDGET_PLANFACT AS
SELECT p.PERIOD,
       p.DIV,
       p.ARTICLE_COD1,
       p.CHANNEL_COD1,
       p.SITE_COD,
       p.VALUTA,
       p.PLAN_SUMA,
       NVL(f.ACTUAL_SUMA, 0) AS ACTUAL_SUMA,
       NVL(c.COMMITTED_SUMA, 0) AS COMMITTED_SUMA,
       p.PLAN_SUMA - NVL(c.COMMITTED_SUMA, 0) - NVL(f.ACTUAL_SUMA, 0) AS AVAILABLE_SUMA
  FROM VSEO_BUDGET_PLAN p
  LEFT JOIN (SELECT PERIOD, DIV, CHANNEL_COD1, SUM(ACTUAL_SUMA) AS ACTUAL_SUMA
               FROM VSEO_SPEND_FACT
              GROUP BY PERIOD, DIV, CHANNEL_COD1) f
    ON f.PERIOD = p.PERIOD AND f.DIV = p.DIV
   AND NVL(f.CHANNEL_COD1, -1) = NVL(p.CHANNEL_COD1, -1)
  LEFT JOIN (SELECT TO_CHAR(pl.DATE_START, 'YYYY-MM') AS PERIOD,
                    d.DIV,
                    pl.CHANNEL_COD1,
                    SUM(pl.SUMA) AS COMMITTED_SUMA
               FROM YSEO_TMDB_PLACE_D pl
               JOIN TMDB_DOCS d ON d.COD = pl.NRDOC
              WHERE d.ISVALID = 1
                AND d.DOCCOLOR = 3          -- голубой: утверждён
              GROUP BY TO_CHAR(pl.DATE_START, 'YYYY-MM'), d.DIV, pl.CHANNEL_COD1) c
    ON c.PERIOD = p.PERIOD AND c.DIV = p.DIV
   AND NVL(c.CHANNEL_COD1, -1) = NVL(p.CHANNEL_COD1, -1);

-- Эффективность канала: затраты против результата.
CREATE OR REPLACE VIEW VSEO_CHANNEL_ROI AS
SELECT m.SITE_COD,
       s.DIV,
       m.CHANNEL_COD1,
       m.CAMP_CODE,
       TO_CHAR(m.FACT_DATE, 'YYYY-MM') AS PERIOD,
       SUM(m.SESSIONS)    AS SESSIONS,
       SUM(m.LEADS)       AS LEADS,
       SUM(m.ORDERS)      AS ORDERS,
       SUM(m.REVENUE_MDL) AS REVENUE_MDL,
       NVL((SELECT SUM(f.ACTUAL_SUMA)
              FROM VSEO_SPEND_FACT f
             WHERE f.DIV = s.DIV
               AND f.CHANNEL_COD1 = m.CHANNEL_COD1
               AND NVL(f.CAMP_CODE, '-') = m.CAMP_CODE
               AND f.PERIOD = TO_CHAR(m.FACT_DATE, 'YYYY-MM')), 0) AS COST_MDL
  FROM YSEO_METRICS_FACT m
  JOIN YSEO_TMS_SITE s ON s.COD = m.SITE_COD
 GROUP BY m.SITE_COD, s.DIV, m.CHANNEL_COD1, m.CAMP_CODE, TO_CHAR(m.FACT_DATE, 'YYYY-MM');
