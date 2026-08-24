-- =====================================================================
-- Права. Технический пользователь AI-сессий не получает ничего сверх
-- необходимого: он читает справочники и создаёт черновики.
--
-- Проведение, платежи, согласование и правка справочников для него
-- закрыты на уровне БД, а не только на уровне приложения - иначе
-- ошибка в приложении означала бы бесконтрольные деньги (ТЗ ч. II §30).
-- =====================================================================

-- Роль для AI-сессий.
CREATE ROLE SEO_AI_ROLE;

-- Чтение справочников и вьюшек контура.
GRANT SELECT ON VSEO_SITE            TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_PLATFORM        TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_CAMPAIGN        TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_BUDGET_PLAN     TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_BUDGET_PLANFACT TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_SPEND_FACT      TO SEO_AI_ROLE;
GRANT SELECT ON VSEO_CHANNEL_ROI     TO SEO_AI_ROLE;
GRANT SELECT ON TMS_UNIVERS          TO SEO_AI_ROLE;
GRANT SELECT ON TMS_PDC              TO SEO_AI_ROLE;
GRANT SELECT ON TMS_SYSS             TO SEO_AI_ROLE;

-- Работа только через пакеты. Прямого DML по таблицам у роли нет.
GRANT EXECUTE ON PK_SEO_UTIL   TO SEO_AI_ROLE;
GRANT EXECUTE ON PK_SEO_DOC    TO SEO_AI_ROLE;
GRANT EXECUTE ON PK_SEO_BUDGET TO SEO_AI_ROLE;
GRANT EXECUTE ON PK_SEO_SPEND  TO SEO_AI_ROLE;
GRANT EXECUTE ON PK_SEO_POST   TO SEO_AI_ROLE;

-- Чего у роли нет намеренно:
--   * INSERT/UPDATE/DELETE на TMDB_DOCS, TMDB_CM, TMS_* напрямую;
--   * доступа к пакетам проведения и генерации проводок (UN$GFC);
--   * прав на платёжные документы (D9) и на изменение плана счетов.
-- APPROVE/REJECT/CANCEL в PK_SEO_DOC доступны технически, но отклоняются
-- внутри пакета проверкой PK_SEO_UTIL.IS_AI_SESSION: так попытка обхода
-- попадает в лог, а не проходит молча.

CREATE USER SEO_AI_BOT IDENTIFIED BY "&ai_bot_password";
GRANT CREATE SESSION TO SEO_AI_BOT;
GRANT SEO_AI_ROLE TO SEO_AI_BOT;

-- Роль интеграционного шлюза: то же плюс синхронизация справочников.
CREATE ROLE SEO_GATEWAY_ROLE;
GRANT SEO_AI_ROLE TO SEO_GATEWAY_ROLE;
GRANT SELECT ON YSEO_XREF TO SEO_GATEWAY_ROLE;

-- Логирование изменений контура штатным механизмом UNA.
BEGIN
    FOR t IN (SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'YSEO!_%' ESCAPE '!') LOOP
        P$CHGLOG_MAKE_TRIGGER(t.TABLE_NAME);
    END LOOP;
END;
/
