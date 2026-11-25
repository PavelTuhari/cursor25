/**
 * Types for the SIA "e-Factura" API of the State Tax Service of Moldova.
 *
 * Derived from the live contract published at
 * https://efactura-api.sfs.md/Service.svc?singleWsdl (DataContract namespace
 * http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel) and from
 * the CTIF integration guide "Ghidul de integrare Complet Automatizat".
 *
 * WCF serialises a DataContract as: inherited members first, then the type's own
 * members, each group in alphabetical order. The element order below reproduces
 * that exactly - the service rejects a body whose sequence differs, so
 * FIELD_ORDER is the single source of truth for the writer in `soap.ts`.
 */

/** Status of an API call itself (not of an invoice). */
export const RESPONSE_STATUS = {
  accepted: 1,
  success: 2,
  error: 3,
} as const;
export type ResponseStatus = (typeof RESPONSE_STATUS)[keyof typeof RESPONSE_STATUS];

/** Lifecycle of a fiscal invoice inside e-Factura. */
export const INVOICE_STATUS = {
  draft: 0,
  signedBySupplier: 1,
  rejectedByBuyer: 2,
  acceptedByBuyer: 3,
  canceledBySupplier: 5,
  sentToBuyer: 7,
  signedByBuyer: 8,
  delivered: 10,
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const INVOICE_STATUS_NAME: Record<number, string> = {
  0: 'draft',
  1: 'signed_by_supplier',
  2: 'rejected_by_buyer',
  3: 'accepted_by_buyer',
  5: 'canceled_by_supplier',
  7: 'sent_to_buyer',
  8: 'signed_by_buyer',
  10: 'delivered',
};

/** Status of a reserved series/number pair. */
export const SERIES_STATUS = {
  issuedForExternalUse: 2,
  usedFromExternal: 3,
} as const;

export const TAXPAYER_TYPE = {
  legalEntity: 1,
  naturalPerson: 2,
  nonResident: 3,
} as const;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface BaseRequest {
  /** Unique per call; may be reused to fetch a previously returned result. */
  RequestId: string;
}

export interface ActorBaseRequest extends BaseRequest {
  /** 1 supplier, 2 buyer, 3 transporter. */
  ActorRole: number;
}

export interface TaxpayersRequest extends BaseRequest {
  FiscalCodes: string[];
}

export interface BankAccountRequest extends BaseRequest {
  AccountNumber?: string;
  IDNO?: string;
}

export interface SeriaNumberRequest extends BaseRequest {
  Count: number;
  /** 0 tax invoice, 1 waybill. */
  InvoiceType: number;
  Seria?: string;
  StartNumber?: number;
}

export interface InvoiceIdentifier {
  Number: string;
  Seria: string;
}

export interface InvoicesRequest extends BaseRequest {
  SeriaAndNumbers: InvoiceIdentifier[];
}

export interface AcceptedRequest extends InvoicesRequest {}

export interface InvoicesContentRequest extends InvoicesRequest {
  ActorRole: number;
  /** 0 portrait, 1 landscape. */
  Orientation: number;
}

export interface SignRequest extends ActorBaseRequest {
  /** Position of this signature in the signing sequence. */
  Order: number;
}

export interface DateSearch {
  StartDate: Date;
  EndDate?: Date;
}

export interface ArchivedRequest extends BaseRequest {
  ActorRole: number;
  IssuedOn?: DateSearch;
  Page: number;
}

export interface InvoiceComment extends InvoiceIdentifier {
  Comment: string;
}

export interface DecisionRequest extends BaseRequest {
  InvoicesComments: InvoiceComment[];
}
export interface RejectRequest extends DecisionRequest {}
export interface CanceledRequest extends DecisionRequest {}

export interface Attachment {
  FileContent: string;
  FileName: string;
}

export interface PostInvoicesRequest extends ActorBaseRequest {
  Attachment?: Attachment;
  /** One `<Documents>` element carrying one or more `<Document>` children. */
  InvoicesXml: string;
  /** 1 signed, 0 unsigned. */
  InvoicesXmlStatus: number;
}

export interface SearchParameters {
  APIeInvoiceId?: string;
  BuyerIDNO?: string;
  DeliveredOn?: DateSearch;
  InvoiceStatus: number;
  InvoiceType?: number;
  IssuedOn?: DateSearch;
  Number?: string;
  RegisteredOn?: DateSearch;
  Seria?: string;
  SupplierIDNO?: string;
  TransporterIDNO?: string;
}

export interface SearchRequest extends BaseRequest {
  ActorRole: number;
  Parameters: SearchParameters;
}

export interface LogsRequest extends BaseRequest {
  From: Date;
  To?: Date;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface BaseResponse {
  RequestId: string;
  Status: number;
  TimeStamp: string;
}

export interface Taxpayer {
  Address: string;
  CodTVA: string;
  ExistInTaxRegistry: boolean;
  IDNO: string;
  IsEFacturaActor: boolean;
  Name: string;
  TaxpayerType: number;
}

export interface BankAccountInfo {
  AccountNumber: string;
  BranchCode: string;
  BranchTitle: string;
  IsRegistered: boolean;
}

export interface SeriaAndNumber extends InvoiceIdentifier {
  Status: number;
}

export interface InvoiceResult extends InvoiceIdentifier {
  Message?: string;
  Status: number;
  TimeStamp: string;
}

export interface InvoiceQRCode extends InvoiceResult {
  /** base64 PNG. */
  QRCode: string;
  QRCodeText: string;
}

export interface Invoice extends InvoiceResult {
  InvoiceStatus: number;
}

export interface XmlInvoice extends Invoice {
  Xml: string;
}

export interface InvoiceContent extends InvoiceResult {
  /** base64 document, usually a PDF. */
  Content: string;
  Format: string;
}

export interface RequestLog {
  EndDateTime?: string;
  Error?: string;
  Method: string;
  Response: string;
  StartDateTime: string;
  Status: number;
  Username: string;
}

export interface TaxpayersResponse extends BaseResponse {
  Results: Taxpayer[];
}
export interface BankAccountResponse extends BaseResponse {
  Results: BankAccountInfo[];
}
export interface SeriaNumberResponse extends BaseResponse {
  Results: SeriaAndNumber[];
}
export interface QRCodesResponse extends BaseResponse {
  Results: InvoiceQRCode[];
}
export interface InvoicesResponse extends BaseResponse {
  Results: Invoice[];
}
export interface InvoicesXmlResponse extends BaseResponse {
  Message?: string;
  Results: XmlInvoice[];
}
export interface InvoiceContentResponse extends BaseResponse {
  Result: InvoiceContent;
}
export interface DecisionResponse extends BaseResponse {
  Results: InvoiceResult[];
}
export interface PostInvoicesResponse extends BaseResponse {
  ErrorMessage?: string;
  TotalInvoices: number;
  TotalInvoicesPosted: number;
}
export interface LogsResponse extends BaseResponse {
  Results: RequestLog[];
}

// ---------------------------------------------------------------------------
// Wire layout
// ---------------------------------------------------------------------------

/**
 * Element order per DataContract type: inherited members first, then own
 * members, each alphabetically. Changing these breaks deserialisation on the
 * service side, so they mirror the XSD literally.
 */
export const FIELD_ORDER: Record<string, readonly string[]> = {
  BaseRequest: ['RequestId'],
  ActorBaseRequest: ['RequestId', 'ActorRole'],
  TaxpayersRequest: ['RequestId', 'FiscalCodes'],
  BankAccountRequest: ['RequestId', 'AccountNumber', 'IDNO'],
  SeriaNumberRequest: ['RequestId', 'Count', 'InvoiceType', 'Seria', 'StartNumber'],
  InvoicesRequest: ['RequestId', 'SeriaAndNumbers'],
  AcceptedRequest: ['RequestId', 'SeriaAndNumbers'],
  InvoicesContentRequest: ['RequestId', 'SeriaAndNumbers', 'ActorRole', 'Orientation'],
  SignRequest: ['RequestId', 'ActorRole', 'Order'],
  ArchivedRequest: ['RequestId', 'ActorRole', 'IssuedOn', 'Page'],
  DecisionRequest: ['RequestId', 'InvoicesComments'],
  RejectRequest: ['RequestId', 'InvoicesComments'],
  CanceledRequest: ['RequestId', 'InvoicesComments'],
  PostInvocesRequest: [
    'RequestId',
    'ActorRole',
    'Attachment',
    'InvoicesXml',
    'InvoicesXmlStatus',
  ],
  SearchRequest: ['RequestId', 'ActorRole', 'Parameters'],
  SearchParameters: [
    'APIeInvoiceId',
    'BuyerIDNO',
    'DeliveredOn',
    'InvoiceStatus',
    'InvoiceType',
    'IssuedOn',
    'Number',
    'RegisteredOn',
    'Seria',
    'SupplierIDNO',
    'TransporterIDNO',
  ],
  LogsRequest: ['RequestId', 'From', 'To'],
  DateSearch: ['EndDate', 'StartDate'],
  InvoiceIndentificator: ['Number', 'Seria'],
  InvoiceComment: ['Number', 'Seria', 'Comment'],
  Attachment: ['FileContent', 'FileName'],
};

/** Operation name -> [request DataContract type, request parameter name]. */
export const OPERATIONS = {
  GetTaxpayersInfo: 'TaxpayersRequest',
  GetBankAccountInfo: 'BankAccountRequest',
  GetSeriaAndNumbers: 'SeriaNumberRequest',
  GetInvoicesQRcodes: 'InvoicesRequest',
  GetInvoicesBySeriaNumber: 'InvoicesRequest',
  CheckInvoicesStatus: 'InvoicesRequest',
  GetInvoicesForSigning: 'SignRequest',
  GetInvoicesContentForPrint: 'InvoicesContentRequest',
  GetAcceptedInvoices: 'ActorBaseRequest',
  GetRejectedInvoices: 'ActorBaseRequest',
  GetArchivedInvoices: 'ArchivedRequest',
  PostRejectedInvoices: 'RejectRequest',
  PostAcceptedInvoices: 'AcceptedRequest',
  PostCanceledInvoices: 'CanceledRequest',
  PostInvoices: 'PostInvocesRequest',
  PostInvoicesWithAttachment: 'PostInvocesRequest',
  SearchInvoices: 'SearchRequest',
  GetLogs: 'LogsRequest',
  Test: 'BaseRequest',
} as const;

export type OperationName = keyof typeof OPERATIONS;

/** Members that are arrays, with the element name used for each item. */
export const ARRAY_ITEM_NAME: Record<string, string> = {
  FiscalCodes: 'string',
  SeriaAndNumbers: 'InvoiceIndentificator',
  InvoicesComments: 'InvoiceComment',
};

/** Members whose value is a complex type, so the writer knows the field order. */
export const COMPLEX_MEMBER_TYPE: Record<string, string> = {
  Attachment: 'Attachment',
  Parameters: 'SearchParameters',
  IssuedOn: 'DateSearch',
  DeliveredOn: 'DateSearch',
  RegisteredOn: 'DateSearch',
};

/** Members serialised from a JS Date. */
export const DATE_MEMBERS = new Set(['From', 'To', 'StartDate', 'EndDate']);
