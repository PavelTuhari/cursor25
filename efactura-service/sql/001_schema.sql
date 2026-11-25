-- =====================================================================
-- una-efactura: tables owned by the service.
--
-- The service never writes to the accounting system. Everything it needs to
-- remember - the outbox, reserved series, statuses and an audit trail - lives
-- here, so an ERP upgrade cannot break it and dropping this schema removes the
-- integration completely.
--
-- Run as the EFACTURA user:
--   sqlplus EFACTURA/password@host:1521/PDB @sql/001_schema.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Outbox: one row per document on its way to e-Factura.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_OUTBOX (
  ID              NUMBER(19)     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID       VARCHAR2(64)   NOT NULL,
  EXTERNAL_ID     VARCHAR2(128)  NOT NULL,
  SERIA           VARCHAR2(16),
  NUMBER_         VARCHAR2(32),
  STATE           VARCHAR2(16)   NOT NULL,
  INVOICE_STATUS  NUMBER(3),
  ATTEMPTS        NUMBER(5)      DEFAULT 0 NOT NULL,
  LAST_ERROR      VARCHAR2(4000),
  PAYLOAD         CLOB           NOT NULL,
  XML             CLOB,
  SIGNED_XML      CLOB,
  QR_CODE_TEXT    VARCHAR2(512),
  PDF_CONTENT     BLOB,
  CREATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  NEXT_ATTEMPT_AT TIMESTAMP(6),
  CONSTRAINT EFACT_OUTBOX_STATE_CK CHECK (
    STATE IN ('pending','reserved','built','signed','posted','confirmed','failed','canceled')
  )
);

-- One document is submitted once per tenant; the unique key makes a retry of
-- the caller idempotent instead of producing a duplicate invoice.
CREATE UNIQUE INDEX EFACT_OUTBOX_EXT_UK ON EFACT_OUTBOX (TENANT_ID, EXTERNAL_ID);
CREATE INDEX EFACT_OUTBOX_DUE_IX ON EFACT_OUTBOX (STATE, NEXT_ATTEMPT_AT);
CREATE INDEX EFACT_OUTBOX_SN_IX  ON EFACT_OUTBOX (TENANT_ID, SERIA, NUMBER_);

-- ---------------------------------------------------------------------
-- Series and numbers reserved from e-Factura ahead of time.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_SERIES (
  ID           NUMBER(19)    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID    VARCHAR2(64)  NOT NULL,
  SERIA        VARCHAR2(16)  NOT NULL,
  NUMBER_      VARCHAR2(32)  NOT NULL,
  INVOICE_TYPE NUMBER(1)     DEFAULT 0 NOT NULL,
  STATE        VARCHAR2(16)  DEFAULT 'free' NOT NULL,
  OUTBOX_ID    NUMBER(19),
  RESERVED_AT  TIMESTAMP(6)  DEFAULT SYSTIMESTAMP NOT NULL,
  USED_AT      TIMESTAMP(6),
  CONSTRAINT EFACT_SERIES_STATE_CK CHECK (STATE IN ('free','taken','used','void'))
);

CREATE UNIQUE INDEX EFACT_SERIES_UK    ON EFACT_SERIES (TENANT_ID, SERIA, NUMBER_);
CREATE INDEX        EFACT_SERIES_FREE_IX ON EFACT_SERIES (TENANT_ID, INVOICE_TYPE, STATE);

-- ---------------------------------------------------------------------
-- Taxpayer cache: GetTaxpayersInfo is slow and its answers change rarely.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_TAXPAYER (
  IDNO             VARCHAR2(16)  PRIMARY KEY,
  NAME             VARCHAR2(512),
  ADDRESS          VARCHAR2(1024),
  COD_TVA          VARCHAR2(32),
  TAXPAYER_TYPE    NUMBER(2),
  IS_EFACTURA      NUMBER(1),
  IN_TAX_REGISTRY  NUMBER(1),
  REFRESHED_AT     TIMESTAMP(6)  DEFAULT SYSTIMESTAMP NOT NULL
);

-- ---------------------------------------------------------------------
-- Audit: every call to SFS, kept for reconciliation with GetLogs.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_AUDIT (
  ID          NUMBER(19)    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID   VARCHAR2(64)  NOT NULL,
  OUTBOX_ID   NUMBER(19),
  OPERATION   VARCHAR2(64)  NOT NULL,
  REQUEST_ID  VARCHAR2(64),
  STATUS      NUMBER(3),
  DURATION_MS NUMBER(10),
  ERROR       VARCHAR2(4000),
  CREATED_AT  TIMESTAMP(6)  DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE INDEX EFACT_AUDIT_OUTBOX_IX ON EFACT_AUDIT (OUTBOX_ID);
CREATE INDEX EFACT_AUDIT_TIME_IX   ON EFACT_AUDIT (TENANT_ID, CREATED_AT);

-- ---------------------------------------------------------------------
-- Schema version, so the migrator knows what has already been applied.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_SCHEMA_VERSION (
  VERSION     NUMBER(5)     PRIMARY KEY,
  NAME        VARCHAR2(128) NOT NULL,
  APPLIED_AT  TIMESTAMP(6)  DEFAULT SYSTIMESTAMP NOT NULL
);
