-- =====================================================================
-- Контур маркетинга SEO в схеме UN4 системы UNA.md
-- Префикс YSEO_ по соглашению UNA для таблиц конкретного контура.
--
-- Соблюдаются требования ТЗ ч. II §21.2 и соглашения UNA:
--   * FK: ON DELETE CASCADE + DEFERRABLE INITIALLY DEFERRED
--   * отдельный индекс по полям FK (иначе блокировки на родителе)
--   * полный PK родителя входит в PK дочерней таблицы
--   * из справочников не удаляем, ставим ISARHIV
-- =====================================================================

-- ---------------------------------------------------------------------
-- Справочник продвигаемых сайтов. Расширение TMS_UNIVERS 1:1, TIP='W'.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMS_SITE (
    COD             NUMBER          NOT NULL,
    DOMAIN          VARCHAR2(255)   NOT NULL,
    LOCALES         VARCHAR2(200)   NOT NULL,
    GEO             VARCHAR2(100),
    -- Подразделение, на которое относятся затраты сайта (TMDB_DOCS.DIV).
    DIV             VARCHAR2(20)    NOT NULL,
    NICHE           VARCHAR2(400),
    ISARHIV         NUMBER(1)       DEFAULT 0 NOT NULL,
    CONSTRAINT PK_YSEO_TMS_SITE PRIMARY KEY (COD),
    CONSTRAINT UK_YSEO_TMS_SITE_DOMAIN UNIQUE (DOMAIN),
    CONSTRAINT FK_YSEO_TMS_SITE_UNIVERS FOREIGN KEY (COD)
        REFERENCES TMS_UNIVERS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_TMS_SITE_ARH CHECK (ISARHIV IN (0, 1))
);
COMMENT ON TABLE YSEO_TMS_SITE IS 'Продвигаемые сайты. Расширение TMS_UNIVERS (TIP=W)';

-- ---------------------------------------------------------------------
-- Справочник площадок размещения. Расширение TMS_UNIVERS для TIP='OE'
-- (площадка одновременно является контрагентом-поставщиком услуг).
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMS_PLATFORM (
    COD             NUMBER          NOT NULL,
    PLATFORM_CODE   VARCHAR2(50)    NOT NULL,
    URL             VARCHAR2(500)   NOT NULL,
    -- COD1 элемента раздела TMS_SYSS ('W',1) - канал продвижения.
    CHANNEL_COD1    NUMBER          NOT NULL,
    GEO             VARCHAR2(100),
    HAS_API         NUMBER(1)       DEFAULT 0 NOT NULL,
    -- 1 = публикация только человеком (нет API либо автоматизация против правил площадки).
    MANUAL_PUBLISH  NUMBER(1)       DEFAULT 1 NOT NULL,
    QUALITY_SCORE   NUMBER(4,2),
    RATE_LIMIT_DAY  NUMBER,
    POSTING_RULES   VARCHAR2(2000),
    ISARHIV         NUMBER(1)       DEFAULT 0 NOT NULL,
    CONSTRAINT PK_YSEO_TMS_PLATFORM PRIMARY KEY (COD),
    CONSTRAINT UK_YSEO_TMS_PLATFORM_CODE UNIQUE (PLATFORM_CODE),
    CONSTRAINT FK_YSEO_TMS_PLATFORM_UNIVERS FOREIGN KEY (COD)
        REFERENCES TMS_UNIVERS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_TMS_PLATFORM_FLAGS CHECK (HAS_API IN (0,1) AND MANUAL_PUBLISH IN (0,1)),
    CONSTRAINT CK_YSEO_TMS_PLATFORM_SCORE CHECK (QUALITY_SCORE IS NULL OR QUALITY_SCORE BETWEEN 0 AND 10)
);
CREATE INDEX IX_YSEO_TMS_PLATFORM_CHAN ON YSEO_TMS_PLATFORM (CHANNEL_COD1);

-- ---------------------------------------------------------------------
-- D1 «Маркетинговый бюджет», табличная часть.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_BUDG_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    -- Период планирования в формате YYYY-MM либо YYYY-Q1.
    PERIOD          VARCHAR2(10)    NOT NULL,
    -- Статья бюджета: COD1 раздела TMS_SYSS ('W',6).
    ARTICLE_COD1    NUMBER          NOT NULL,
    CHANNEL_COD1    NUMBER,
    SITE_COD        NUMBER,
    PLAN_SUMA       NUMBER(16,2)    DEFAULT 0 NOT NULL,
    VALUTA          VARCHAR2(3)     DEFAULT 'MDL' NOT NULL,
    NOTE            VARCHAR2(1000),
    CONSTRAINT PK_YSEO_TMDB_BUDG_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_BUDG_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_BUDG_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_BUDG_D_SUMA CHECK (PLAN_SUMA >= 0)
);
CREATE INDEX IX_YSEO_BUDG_D_DOCS ON YSEO_TMDB_BUDG_D (NRDOC);
CREATE INDEX IX_YSEO_BUDG_D_SITE ON YSEO_TMDB_BUDG_D (SITE_COD);
CREATE INDEX IX_YSEO_BUDG_D_LOOKUP ON YSEO_TMDB_BUDG_D (PERIOD, ARTICLE_COD1, CHANNEL_COD1);

-- ---------------------------------------------------------------------
-- D2 «Кампания / Акция», табличная часть.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_CAMP_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    -- Код кампании, он же utm_campaign и аналитика TMDB_CM.DTSTRSC.
    CAMP_CODE       VARCHAR2(50)    NOT NULL,
    SITE_COD        NUMBER          NOT NULL,
    NAME_RU         VARCHAR2(400),
    NAME_RO         VARCHAR2(400),
    NAME_EN         VARCHAR2(400),
    -- Тип промо: COD1 раздела TMS_SYSS ('W',4).
    PROMO_TYPE_COD1 NUMBER          NOT NULL,
    DISCOUNT_VALUE  NUMBER(12,2),
    PROMO_CODE      VARCHAR2(50),
    SCOPE_KIND      VARCHAR2(20)    DEFAULT 'SITE' NOT NULL,
    DATE_START      DATE            NOT NULL,
    DATE_END        DATE            NOT NULL,
    LIMIT_QTY       NUMBER,
    LIMIT_SUM       NUMBER(16,2),
    BUDGET_PLAN     NUMBER(16,2)    DEFAULT 0 NOT NULL,
    KPI_TARGET      VARCHAR2(2000),
    LEGAL_TEXT_REF  VARCHAR2(500),
    CONSTRAINT PK_YSEO_TMDB_CAMP_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_CAMP_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_CAMP_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_CAMP_D_PERIOD CHECK (DATE_END >= DATE_START),
    CONSTRAINT CK_YSEO_CAMP_D_SCOPE CHECK (SCOPE_KIND IN ('SITE','CATEGORY','ITEMS'))
);
CREATE INDEX IX_YSEO_CAMP_D_DOCS ON YSEO_TMDB_CAMP_D (NRDOC);
CREATE INDEX IX_YSEO_CAMP_D_SITE ON YSEO_TMDB_CAMP_D (SITE_COD);
CREATE INDEX IX_YSEO_CAMP_D_CODE ON YSEO_TMDB_CAMP_D (CAMP_CODE);

-- ---------------------------------------------------------------------
-- D3 «Медиаплан» / D11 «Отчёт о размещении», общая табличная часть.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_PLACE_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    CAMP_CODE       VARCHAR2(50),
    SITE_COD        NUMBER          NOT NULL,
    PLATFORM_COD    NUMBER,
    CHANNEL_COD1    NUMBER          NOT NULL,
    -- Формат размещения: COD1 раздела TMS_SYSS ('W',5).
    FORMAT_COD1     NUMBER,
    -- Единица закупки: COD1 раздела TMS_SYSS ('W',7): CPC/CPM/CPA/Fix/...
    BUYUNIT_COD1    NUMBER,
    DATE_START      DATE            NOT NULL,
    DATE_END        DATE            NOT NULL,
    RATE            NUMBER(16,4)    DEFAULT 0 NOT NULL,
    QTY             NUMBER(16,3)    DEFAULT 0 NOT NULL,
    SUMA            NUMBER(16,2)    DEFAULT 0 NOT NULL,
    VALUTA          VARCHAR2(3)     DEFAULT 'MDL' NOT NULL,
    -- Факт по строке заполняется документом D11.
    FACT_SUMA       NUMBER(16,2),
    FACT_URL        VARCHAR2(1000),
    RATE_DEVIATION_NOTE VARCHAR2(1000),
    CONSTRAINT PK_YSEO_TMDB_PLACE_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_PLACE_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_PLACE_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_PLACE_D_PLATF FOREIGN KEY (PLATFORM_COD)
        REFERENCES YSEO_TMS_PLATFORM (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_PLACE_D_PERIOD CHECK (DATE_END >= DATE_START),
    CONSTRAINT CK_YSEO_PLACE_D_SUMA CHECK (SUMA >= 0)
);
CREATE INDEX IX_YSEO_PLACE_D_DOCS ON YSEO_TMDB_PLACE_D (NRDOC);
CREATE INDEX IX_YSEO_PLACE_D_SITE ON YSEO_TMDB_PLACE_D (SITE_COD);
CREATE INDEX IX_YSEO_PLACE_D_PLATF ON YSEO_TMDB_PLACE_D (PLATFORM_COD);
CREATE INDEX IX_YSEO_PLACE_D_CAMP ON YSEO_TMDB_PLACE_D (CAMP_CODE);

-- ---------------------------------------------------------------------
-- D10 «Реестр публикаций», табличная часть.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_POST_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    SITE_COD        NUMBER          NOT NULL,
    CHANNEL_COD1    NUMBER          NOT NULL,
    PLATFORM_COD    NUMBER,
    CAMP_CODE       VARCHAR2(50),
    LOCALE          VARCHAR2(10)    NOT NULL,
    FORMAT_COD1     NUMBER,
    TITLE           VARCHAR2(500),
    EXTERNAL_URL    VARCHAR2(1000),
    PUBLISHED_AT    DATE,
    COST_SUMA       NUMBER(16,2)    DEFAULT 0 NOT NULL,
    VALUTA          VARCHAR2(3)     DEFAULT 'MDL' NOT NULL,
    -- Прослеживаемость до AI-сессии, породившей публикацию.
    RUN_ID          VARCHAR2(64),
    PLAYBOOK_SHA    VARCHAR2(64),
    CONSTRAINT PK_YSEO_TMDB_POST_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_POST_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_POST_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_POST_D_PLATF FOREIGN KEY (PLATFORM_COD)
        REFERENCES YSEO_TMS_PLATFORM (COD) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IX_YSEO_POST_D_DOCS ON YSEO_TMDB_POST_D (NRDOC);
CREATE INDEX IX_YSEO_POST_D_SITE ON YSEO_TMDB_POST_D (SITE_COD);
CREATE INDEX IX_YSEO_POST_D_PLATF ON YSEO_TMDB_POST_D (PLATFORM_COD);
-- Один URL регистрируется один раз: защита от повторной регистрации публикации.
CREATE UNIQUE INDEX UX_YSEO_POST_D_URL ON YSEO_TMDB_POST_D (EXTERNAL_URL);

-- ---------------------------------------------------------------------
-- D8 «Расход на рекламу», табличная часть (импорт из кабинетов).
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_ADSPEND_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    SITE_COD        NUMBER          NOT NULL,
    CHANNEL_COD1    NUMBER          NOT NULL,
    ACCOUNT_ID      VARCHAR2(100)   NOT NULL,
    SPEND_DATE      DATE            NOT NULL,
    CAMP_CODE       VARCHAR2(50),
    ACCOUNT_CAMPAIGN VARCHAR2(300),
    IMPRESSIONS     NUMBER          DEFAULT 0 NOT NULL,
    CLICKS          NUMBER          DEFAULT 0 NOT NULL,
    CONVERSIONS     NUMBER          DEFAULT 0 NOT NULL,
    SUMA_VAL        NUMBER(16,4)    DEFAULT 0 NOT NULL,
    VALUTA          VARCHAR2(3)     NOT NULL,
    -- Курс НБМ на дату операции и сумма в MDL.
    CURS            NUMBER(16,6),
    SUMA_MDL        NUMBER(16,2),
    IS_OVERBUDGET   NUMBER(1)       DEFAULT 0 NOT NULL,
    CONSTRAINT PK_YSEO_TMDB_ADSPEND_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_ADSPEND_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_ADSPEND_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_ADSPEND_D_OVR CHECK (IS_OVERBUDGET IN (0,1))
);
CREATE INDEX IX_YSEO_ADSPEND_D_DOCS ON YSEO_TMDB_ADSPEND_D (NRDOC);
CREATE INDEX IX_YSEO_ADSPEND_D_SITE ON YSEO_TMDB_ADSPEND_D (SITE_COD);
-- Ключ дедупликации импорта: кабинет + день + кампания кабинета.
CREATE UNIQUE INDEX UX_YSEO_ADSPEND_D_DEDUP
    ON YSEO_TMDB_ADSPEND_D (ACCOUNT_ID, SPEND_DATE, ACCOUNT_CAMPAIGN);

-- ---------------------------------------------------------------------
-- D4 «Договор с подрядчиком», табличная часть (этапы и условия).
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMDB_CONTRACT_D (
    NRDOC           NUMBER          NOT NULL,
    NRDOC1          NUMBER          NOT NULL,
    -- Контрагент: COD в TMS_UNIVERS (TIP='OE').
    SC_CONTRACTOR   NUMBER          NOT NULL,
    SITE_COD        NUMBER,
    STAGE_NAME      VARCHAR2(400)   NOT NULL,
    DATE_START      DATE,
    DATE_END        DATE,
    SUMA            NUMBER(16,2)    DEFAULT 0 NOT NULL,
    VALUTA          VARCHAR2(3)     DEFAULT 'MDL' NOT NULL,
    KPI_TEXT        VARCHAR2(2000),
    PAYMENT_TERMS   VARCHAR2(1000),
    CONSTRAINT PK_YSEO_TMDB_CONTRACT_D PRIMARY KEY (NRDOC, NRDOC1),
    CONSTRAINT FK_YSEO_CONTRACT_D_DOCS FOREIGN KEY (NRDOC)
        REFERENCES TMDB_DOCS (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT FK_YSEO_CONTRACT_D_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT CK_YSEO_CONTRACT_D_PERIOD CHECK (DATE_END IS NULL OR DATE_START IS NULL OR DATE_END >= DATE_START)
);
CREATE INDEX IX_YSEO_CONTRACT_D_DOCS ON YSEO_TMDB_CONTRACT_D (NRDOC);
CREATE INDEX IX_YSEO_CONTRACT_D_SITE ON YSEO_TMDB_CONTRACT_D (SITE_COD);
CREATE INDEX IX_YSEO_CONTRACT_D_SC ON YSEO_TMDB_CONTRACT_D (SC_CONTRACTOR);

-- ---------------------------------------------------------------------
-- Кросс-таблица идемпотентности внешних систем (ТЗ ч. II §23.3).
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_XREF (
    EXT_SYSTEM      VARCHAR2(32)    NOT NULL,
    EXT_ID          VARCHAR2(128)   NOT NULL,
    UNA_TABLE       VARCHAR2(64)    NOT NULL,
    UNA_COD         NUMBER          NOT NULL,
    HASH            VARCHAR2(64),
    DIRECTION       CHAR(1)         DEFAULT 'I' NOT NULL,
    SYNCED_AT       DATE            DEFAULT SYSDATE NOT NULL,
    CONSTRAINT PK_YSEO_XREF PRIMARY KEY (EXT_SYSTEM, EXT_ID),
    CONSTRAINT CK_YSEO_XREF_DIR CHECK (DIRECTION IN ('I','O','B'))
);
CREATE INDEX IX_YSEO_XREF_TARGET ON YSEO_XREF (UNA_TABLE, UNA_COD);

-- ---------------------------------------------------------------------
-- Факт по метрикам продвижения: нужен для отчёта ROI внутри UNA,
-- чтобы затраты и результат считались в одном месте.
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_METRICS_FACT (
    SITE_COD        NUMBER          NOT NULL,
    CHANNEL_COD1    NUMBER          NOT NULL,
    FACT_DATE       DATE            NOT NULL,
    CAMP_CODE       VARCHAR2(50)    DEFAULT '-' NOT NULL,
    SESSIONS        NUMBER          DEFAULT 0 NOT NULL,
    LEADS           NUMBER          DEFAULT 0 NOT NULL,
    ORDERS          NUMBER          DEFAULT 0 NOT NULL,
    REVENUE_MDL     NUMBER(16,2)    DEFAULT 0 NOT NULL,
    KEYWORDS_TOP10  NUMBER,
    CONSTRAINT PK_YSEO_METRICS_FACT PRIMARY KEY (SITE_COD, CHANNEL_COD1, FACT_DATE, CAMP_CODE),
    CONSTRAINT FK_YSEO_METRICS_SITE FOREIGN KEY (SITE_COD)
        REFERENCES YSEO_TMS_SITE (COD) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IX_YSEO_METRICS_SITE ON YSEO_METRICS_FACT (SITE_COD, FACT_DATE);

-- ---------------------------------------------------------------------
-- Настройки контура. Счета, ставки налогов, пороги согласования и лимиты
-- живут здесь, а не в коде: смена плана счетов или учётной политики
-- не должна требовать доработки (ТЗ ч. II §27, критерий приёмки 4).
-- ---------------------------------------------------------------------
CREATE TABLE YSEO_TMS_SETUP (
    PARAM_KEY       VARCHAR2(64)    NOT NULL,
    PARAM_VALUE     VARCHAR2(400)   NOT NULL,
    NOTE            VARCHAR2(1000),
    CONSTRAINT PK_YSEO_TMS_SETUP PRIMARY KEY (PARAM_KEY)
);

-- Значения по умолчанию. Счета обязательны к сверке с рабочим планом счетов
-- предприятия перед вводом в эксплуатацию (см. ТЗ ч. II §33, вопрос Q1).
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('ACC_MARKETING_EXPENSE', '712', 'Счёт расходов на распространение. Сверить с планом счетов');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('ACC_SUPPLIER', '521', 'Счёт торговых обязательств. Сверить с планом счетов');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('ACC_PREPAID', '261', 'Счёт расходов будущих периодов. Сверить с планом счетов');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('FUNCT_EXPENSE', 'MKTACC', 'Функция проводки признания расхода');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('AI_MAX_DOC_SUMA', '10000', 'Предел суммы документа, создаваемого AI-сессией, в MDL');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('BUDGET_WARN_PCT', '80', 'Процент освоения бюджета, при котором отправляется предупреждение');
INSERT INTO YSEO_TMS_SETUP (PARAM_KEY, PARAM_VALUE, NOTE) VALUES
    ('AI_TECH_USERS', 'SEO_AI_BOT', 'Список технических пользователей AI через запятую');
COMMIT;
