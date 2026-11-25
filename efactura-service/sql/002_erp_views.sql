-- =====================================================================
-- The contract between the accounting system and the service.
--
-- These three views are the ONLY thing the service reads from the ERP. Point
-- them at whatever the client's schema actually looks like - the column names
-- and types below are what must not change. Nothing here writes.
--
-- Run as the ERP owner, then grant SELECT to EFACTURA:
--   GRANT SELECT ON V_EFACT_DOCUMENTS      TO EFACTURA;
--   GRANT SELECT ON V_EFACT_DOCUMENT_LINES TO EFACTURA;
--   GRANT SELECT ON V_EFACT_PARTNERS       TO EFACTURA;
--
-- The definitions below are a worked example against a generic sales-document
-- model; replace the FROM clauses, keep the SELECT list.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Documents ready to be sent. A row appears here only when the accounting
-- system considers the document final.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EFACT_DOCUMENTS AS
SELECT
    d.doc_id                    AS EXTERNAL_ID,
    d.doc_series                AS SERIA,          -- NULL to have SFS assign one
    d.doc_number                AS NUMBER_,
    d.delivery_date             AS DELIVERY_DATE,
    d.supplier_idno             AS SUPPLIER_IDNO,
    d.buyer_idno                AS BUYER_IDNO,
    d.transporter_idno          AS TRANSPORTER_IDNO,
    d.delegate_name             AS DELEGATE_NAME,
    d.delegate_date             AS DELEGATE_DATE,
    d.total_amount              AS TOTAL,
    d.total_vat                 AS TOTAL_VAT,
    CASE WHEN d.is_pharma = 'Y' THEN 1 ELSE 0 END AS IS_PHARMA,
    NVL(d.creation_motive, 4)   AS CREATION_MOTIVE,
    d.updated_at                AS UPDATED_AT
FROM sales_documents d
WHERE d.status = 'FINAL'
  AND d.is_fiscal_invoice = 'Y';

-- ---------------------------------------------------------------------
-- Lines. ROW_NO fixes the order inside the invoice.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EFACT_DOCUMENT_LINES AS
SELECT
    l.doc_id                        AS EXTERNAL_ID,
    l.line_no                       AS ROW_NO,
    l.article_code                  AS CODE,
    l.article_name                  AS NAME,
    l.unit_of_measure               AS UNIT_OF_MEASURE,
    l.quantity                      AS QUANTITY,
    l.unit_price_net                AS UNIT_PRICE_WITHOUT_VAT,
    l.total_net                     AS TOTAL_PRICE_WITHOUT_VAT,
    l.vat_rate                      AS VAT_RATE,
    l.total_vat                     AS TOTAL_VAT,
    l.total_gross                   AS TOTAL_PRICE
FROM sales_document_lines l;

-- ---------------------------------------------------------------------
-- Parties. Supplier, buyers and carriers all resolve through this one view.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EFACT_PARTNERS AS
SELECT
    p.idno                          AS IDNO,
    p.name                          AS TITLE,
    p.legal_address                 AS ADDRESS,
    NVL(p.taxpayer_type, 1)         AS TAXPAYER_TYPE,
    p.bank_account                  AS BANK_ACCOUNT,
    p.bank_name                     AS BANK_BRANCH_TITLE,
    p.bank_swift                    AS BANK_BRANCH_CODE
FROM partners p;
