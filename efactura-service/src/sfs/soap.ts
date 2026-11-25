/**
 * Minimal SOAP 1.1 transport for the e-Factura WCF service.
 *
 * The published binding is `BasicHttpBinding` with
 * `TransportWithMessageCredential`: TLS protects the channel and the caller is
 * identified by a WS-Security UsernameToken carrying a plain-text password.
 * That is a small, fixed envelope, so the service writes it directly instead of
 * pulling in a WSDL-driven SOAP stack - fewer moving parts to install at a
 * client site, and complete control over element order, which WCF's
 * DataContract deserialiser insists on.
 */
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

import {
  ARRAY_ITEM_NAME,
  COMPLEX_MEMBER_TYPE,
  DATE_MEMBERS,
  FIELD_ORDER,
} from './types.js';

export const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  passwordText:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText',
  arrays: 'http://schemas.microsoft.com/2003/10/Serialization/Arrays',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
} as const;

export class SoapFaultError extends Error {
  constructor(
    message: string,
    readonly faultCode: string,
    readonly detail: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'SoapFaultError';
  }
}

export class SoapTransportError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SoapTransportError';
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** WCF accepts ISO-8601; milliseconds are kept because the API echoes them. */
export function toXsdDateTime(value: Date): string {
  return value.toISOString();
}

function writeValue(name: string, value: unknown, indent: string): string {
  if (value === undefined || value === null) {
    // A nillable member that is absent must still be emitted in order, or the
    // members that follow are read into the wrong slots.
    return `${indent}<${name} i:nil="true" />`;
  }

  if (DATE_MEMBERS.has(name) && value instanceof Date) {
    return `${indent}<${name}>${toXsdDateTime(value)}</${name}>`;
  }

  if (Array.isArray(value)) {
    const itemName = ARRAY_ITEM_NAME[name] ?? 'string';
    if (value.length === 0) return `${indent}<${name} />`;
    const itemNs = itemName === 'string' ? ' xmlns:a="' + NS.arrays + '"' : '';
    const prefix = itemName === 'string' ? 'a:' : '';
    const items = value
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return writeComplex(`${prefix}${itemName}`, itemName, item as Record<string, unknown>, indent + '  ');
        }
        return `${indent}  <${prefix}${itemName}>${escapeXml(String(item))}</${prefix}${itemName}>`;
      })
      .join('\n');
    return `${indent}<${name}${itemNs}>\n${items}\n${indent}</${name}>`;
  }

  if (typeof value === 'object') {
    const typeName = COMPLEX_MEMBER_TYPE[name] ?? name;
    return writeComplex(name, typeName, value as Record<string, unknown>, indent);
  }

  if (typeof value === 'boolean') return `${indent}<${name}>${value ? 'true' : 'false'}</${name}>`;
  return `${indent}<${name}>${escapeXml(String(value))}</${name}>`;
}

function writeComplex(
  elementName: string,
  typeName: string,
  value: Record<string, unknown>,
  indent: string,
): string {
  const order = FIELD_ORDER[typeName];
  if (!order) throw new Error(`no declared field order for DataContract type ${typeName}`);

  const children = order
    .filter((field) => {
      // Optional members that were never set are omitted rather than nilled,
      // except where the contract marks them nillable and the service expects
      // the slot - arrays and required scalars always go out.
      const present = value[field] !== undefined && value[field] !== null;
      return present || REQUIRED_MEMBERS.has(`${typeName}.${field}`);
    })
    .map((field) => writeValue(field, value[field], indent + '  '))
    .join('\n');

  if (children === '') return `${indent}<${elementName} />`;
  return `${indent}<${elementName}>\n${children}\n${indent}</${elementName}>`;
}

/**
 * Members the service requires even when empty. Everything else is dropped when
 * unset, which keeps the envelope small and avoids nil-versus-default surprises.
 */
const REQUIRED_MEMBERS = new Set<string>([
  'TaxpayersRequest.RequestId',
  'TaxpayersRequest.FiscalCodes',
  'SeriaNumberRequest.RequestId',
  'SeriaNumberRequest.Count',
  'SeriaNumberRequest.InvoiceType',
  'InvoicesRequest.RequestId',
  'InvoicesRequest.SeriaAndNumbers',
  'AcceptedRequest.RequestId',
  'AcceptedRequest.SeriaAndNumbers',
  'ActorBaseRequest.RequestId',
  'ActorBaseRequest.ActorRole',
  'SignRequest.RequestId',
  'SignRequest.ActorRole',
  'SignRequest.Order',
  'DecisionRequest.RequestId',
  'DecisionRequest.InvoicesComments',
  'RejectRequest.RequestId',
  'RejectRequest.InvoicesComments',
  'CanceledRequest.RequestId',
  'CanceledRequest.InvoicesComments',
  'PostInvocesRequest.RequestId',
  'PostInvocesRequest.ActorRole',
  'PostInvocesRequest.InvoicesXml',
  'PostInvocesRequest.InvoicesXmlStatus',
  'SearchRequest.RequestId',
  'SearchRequest.ActorRole',
  'SearchRequest.Parameters',
  'SearchParameters.InvoiceStatus',
  'LogsRequest.RequestId',
  'LogsRequest.From',
  'DateSearch.StartDate',
  'InvoiceIndentificator.Number',
  'InvoiceIndentificator.Seria',
  'InvoiceComment.Number',
  'InvoiceComment.Seria',
  'InvoiceComment.Comment',
  'BaseRequest.RequestId',
]);

export interface EnvelopeOptions {
  operation: string;
  requestType: string;
  payload: Record<string, unknown>;
  username: string;
  password: string;
  soapNamespace: string;
  modelNamespace: string;
  /** Injected in tests so the envelope is reproducible. */
  now?: Date;
  tokenId?: string;
}

export function buildEnvelope(options: EnvelopeOptions): string {
  const now = options.now ?? new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const tokenId = options.tokenId ?? `uuid-${randomUUID()}-1`;

  const body = writeComplex('request', options.requestType, options.payload, '      ');

  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="${NS.soap}">
  <s:Header>
    <o:Security s:mustUnderstand="1" xmlns:o="${NS.wsse}" xmlns:u="${NS.wsu}">
      <u:Timestamp u:Id="_0">
        <u:Created>${toXsdDateTime(now)}</u:Created>
        <u:Expires>${toXsdDateTime(expires)}</u:Expires>
      </u:Timestamp>
      <o:UsernameToken u:Id="${escapeXml(tokenId)}">
        <o:Username>${escapeXml(options.username)}</o:Username>
        <o:Password Type="${NS.passwordText}">${escapeXml(options.password)}</o:Password>
      </o:UsernameToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <${options.operation} xmlns="${options.soapNamespace}" xmlns:i="${NS.xsi}">
${body}
    </${options.operation}>
  </s:Body>
</s:Envelope>`;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Normalises the WCF array wrappers into plain JS arrays. */
function unwrapArrays(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map(unwrapArrays);
  if (typeof node !== 'object') return node;

  const record = node as Record<string, unknown>;
  if (record['@_nil'] === 'true') return null;

  const keys = Object.keys(record).filter((k) => !k.startsWith('@_'));
  // `<Results><Taxpayer/><Taxpayer/></Results>` becomes `[{...},{...}]`.
  if (keys.length === 1) {
    const only = record[keys[0]!];
    if (Array.isArray(only)) return only.map(unwrapArrays);
  }

  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = unwrapArrays(record[key]);
  return out;
}

/** Members that hold a collection even when the service returned a single item. */
const COLLECTION_MEMBERS = new Set(['Results', 'FiscalCodes', 'SeriaAndNumbers']);

function coerceCollections(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(coerceCollections);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const coerced = coerceCollections(value);
    if (!COLLECTION_MEMBERS.has(key)) {
      out[key] = coerced;
      continue;
    }

    if (Array.isArray(coerced)) {
      out[key] = coerced;
    } else if (coerced === null || coerced === '') {
      // `<Results />` and `<Results i:nil="true" />` both mean "nothing".
      out[key] = [];
    } else if (typeof coerced === 'object') {
      // A collection holding exactly one item survives `unwrapArrays` as
      // `{ Taxpayer: {...} }`, because there was no array to flatten. Unwrap
      // that single item so callers always see a list.
      const inner = Object.values(coerced as Record<string, unknown>);
      out[key] = inner.length === 1 && typeof inner[0] === 'object' ? [inner[0]] : [coerced];
    } else {
      out[key] = [coerced];
    }
  }
  return out;
}

export function parseResponse<T>(xml: string, operation: string, httpStatus: number): T {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const envelope = doc['Envelope'] as Record<string, unknown> | undefined;
  if (!envelope) throw new SoapTransportError('response is not a SOAP envelope', httpStatus, false);

  const body = envelope['Body'] as Record<string, unknown> | undefined;
  if (!body) throw new SoapTransportError('SOAP envelope has no Body', httpStatus, false);

  const fault = body['Fault'] as Record<string, unknown> | undefined;
  if (fault) {
    const code = String(fault['faultcode'] ?? fault['Code'] ?? 'unknown');
    const reason = String(fault['faultstring'] ?? fault['Reason'] ?? 'SOAP fault');
    const detail = fault['detail'] ? JSON.stringify(fault['detail']) : '';
    throw new SoapFaultError(reason, code, detail, httpStatus);
  }

  const wrapper = body[`${operation}Response`] as Record<string, unknown> | undefined;
  if (!wrapper) {
    throw new SoapTransportError(
      `SOAP body has no ${operation}Response element`,
      httpStatus,
      false,
    );
  }

  const result = wrapper[`${operation}Result`];
  return coerceCollections(unwrapArrays(result)) as T;
}

export interface CallOptions {
  endpoint: string;
  operation: string;
  soapNamespace: string;
  envelope: string;
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  fetchImpl?: typeof fetch;
  onRetry?: (attempt: number, error: Error) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function call<T>(options: CallOptions): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const action = `${options.soapNamespace.replace(/\/$/, '')}/IService/${options.operation}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(options.retryBackoffMs * 2 ** (attempt - 1));
      options.onRetry?.(attempt, lastError!);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await doFetch(options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${action}"`,
        },
        body: options.envelope,
        signal: controller.signal,
      });
      const text = await response.text();

      if (!response.ok && response.status !== 500) {
        // 500 still carries a SOAP fault worth parsing; other codes do not.
        const retryable = response.status === 429 || response.status >= 502;
        lastError = new SoapTransportError(
          `HTTP ${response.status} from ${options.endpoint}`,
          response.status,
          retryable,
        );
        if (!retryable) throw lastError;
        continue;
      }

      return parseResponse<T>(text, options.operation, response.status);
    } catch (error) {
      const err = error as Error;
      if (err instanceof SoapFaultError) throw err;
      if (err instanceof SoapTransportError && !err.retryable) throw err;
      const aborted = err.name === 'AbortError';
      lastError = aborted
        ? new SoapTransportError(`timed out after ${options.timeoutMs} ms`, null, true)
        : new SoapTransportError(err.message, null, true);
      if (attempt === options.retries) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new SoapTransportError('request failed', null, false);
}
