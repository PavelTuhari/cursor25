-- =====================================================================
-- una-efactura: multi-company support.
--
-- Until this migration the service acted for one company, in one role, with
-- credentials from its configuration. From here it acts for many: each company
-- is a connection carrying its own e-Factura API user, and incoming invoices
-- get an inbox that mirrors the outbox.
--
-- The credential itself is stored sealed (AES-256-GCM); the key never touches
-- this database. See src/crypto/secretBox.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- One company, in one role, with its own API user.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_CONNECTION (
  ID              NUMBER(19)     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID       VARCHAR2(64)   NOT NULL,
  IDNO            VARCHAR2(16)   NOT NULL,
  TITLE           VARCHAR2(512),
  -- 1 supplier, 2 buyer, 3 transporter - the role this company plays.
  ACTOR_ROLE      NUMBER(1)      NOT NULL,
  SFS_USERNAME    VARCHAR2(128),
  -- iv | tag | ciphertext, or NULL once the connection is revoked.
  SFS_SECRET      BLOB,
  STATE           VARCHAR2(16)   NOT NULL,
  -- Recorded when the owner agreed to let us read on their behalf.
  CONSENT_AT      TIMESTAMP(6),
  CONSENT_VERSION VARCHAR2(32),
  -- Cursor for the incoming poll: everything issued after this is new to us.
  LAST_POLL_AT    TIMESTAMP(6),
  LAST_SEEN_AT    TIMESTAMP(6),
  LAST_ERROR      VARCHAR2(1000),
  CREATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT EFACT_CONNECTION_STATE_CK CHECK (
    STATE IN ('pending','active','invalid','revoked')
  ),
  CONSTRAINT EFACT_CONNECTION_ROLE_CK CHECK (ACTOR_ROLE IN (1,2,3))
);

-- A company appears once per role: the same firm may both sell and buy.
CREATE UNIQUE INDEX EFACT_CONNECTION_UK
  ON EFACT_CONNECTION (TENANT_ID, IDNO, ACTOR_ROLE);
CREATE INDEX EFACT_CONNECTION_POLL_IX
  ON EFACT_CONNECTION (STATE, ACTOR_ROLE, LAST_POLL_AT);

-- ---------------------------------------------------------------------
-- Incoming invoices: documents where one of our companies is the buyer.
-- ---------------------------------------------------------------------
CREATE TABLE EFACT_INBOX (
  ID              NUMBER(19)     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  TENANT_ID       VARCHAR2(64)   NOT NULL,
  CONNECTION_ID   NUMBER(19)     NOT NULL,
  SERIA           VARCHAR2(16)   NOT NULL,
  NUMBER_         VARCHAR2(32)   NOT NULL,
  SUPPLIER_IDNO   VARCHAR2(16)   NOT NULL,
  SUPPLIER_NAME   VARCHAR2(512),
  BUYER_IDNO      VARCHAR2(16)   NOT NULL,
  ISSUED_AT       TIMESTAMP(6),
  TOTAL           NUMBER(18,2),
  TOTAL_VAT       NUMBER(18,2),
  INVOICE_STATUS  NUMBER(3),
  -- Our side of the decision, separate from what SFS currently reports.
  DECISION        VARCHAR2(16)   DEFAULT 'none' NOT NULL,
  DECISION_NOTE   VARCHAR2(1000),
  DECISION_AT     TIMESTAMP(6),
  ATTEMPTS        NUMBER(5)      DEFAULT 0 NOT NULL,
  LAST_ERROR      VARCHAR2(4000),
  XML             CLOB,
  PDF_CONTENT     BLOB,
  QR_TEXT         VARCHAR2(512),
  -- 'sfs' when we read it from the tax service, 'platform' when a seller on
  -- UNA.md handed it to us directly.
  SOURCE          VARCHAR2(16)   NOT NULL,
  CREATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  UPDATED_AT      TIMESTAMP(6)   DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT EFACT_INBOX_DECISION_CK CHECK (
    DECISION IN ('none','accepting','accepted','rejecting','rejected','failed')
  ),
  CONSTRAINT EFACT_INBOX_SOURCE_CK CHECK (SOURCE IN ('sfs','platform'))
);

-- The de-duplication key. An invoice issued by a seller on the platform reaches
-- us twice - once directly, once through the tax service - and must stay one
-- row. Supplier IDNO is part of the key because series and number are only
-- unique per issuer.
CREATE UNIQUE INDEX EFACT_INBOX_DOC_UK
  ON EFACT_INBOX (TENANT_ID, SUPPLIER_IDNO, SERIA, NUMBER_);

CREATE INDEX EFACT_INBOX_CONN_IX  ON EFACT_INBOX (CONNECTION_ID, ISSUED_AT);
CREATE INDEX EFACT_INBOX_PEND_IX  ON EFACT_INBOX (TENANT_ID, DECISION);
CREATE INDEX EFACT_INBOX_BUYER_IX ON EFACT_INBOX (TENANT_ID, BUYER_IDNO, ISSUED_AT);

-- ---------------------------------------------------------------------
-- Audit gains a connection reference, so a company can be shown exactly what
-- was done on its behalf.
-- ---------------------------------------------------------------------
ALTER TABLE EFACT_AUDIT ADD (CONNECTION_ID NUMBER(19));
CREATE INDEX EFACT_AUDIT_CONN_IX ON EFACT_AUDIT (CONNECTION_ID, CREATED_AT);
