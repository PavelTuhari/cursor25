import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';

import { buildEnvelope, call, parseResponse, SoapFaultError } from '../src/sfs/soap.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

const NAMESPACES = {
  soapNamespace: 'http://tempuri.org/',
  modelNamespace: 'http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel',
  username: 'supplier',
  password: 'secret',
  now: new Date('2026-08-24T10:00:00.000Z'),
  tokenId: 'uuid-fixed-1',
};

test('the envelope carries a WS-Security UsernameToken and a Timestamp', () => {
  const xml = buildEnvelope({
    operation: 'Test',
    requestType: 'BaseRequest',
    payload: { RequestId: 'r1' },
    ...NAMESPACES,
  });
  const parsed = parser.parse(xml) as any;
  const security = parsed.Envelope.Header.Security;

  assert.equal(security['@_mustUnderstand'], '1');
  assert.equal(security.UsernameToken.Username, 'supplier');
  assert.equal(security.UsernameToken.Password['#text'], 'secret');
  assert.ok(String(security.UsernameToken.Password['@_Type']).endsWith('#PasswordText'));
  assert.equal(security.Timestamp.Created, '2026-08-24T10:00:00.000Z');
  assert.equal(security.Timestamp.Expires, '2026-08-24T10:05:00.000Z');
});

test('members go out in the DataContract order, base type first', () => {
  const xml = buildEnvelope({
    operation: 'GetSeriaAndNumbers',
    requestType: 'SeriaNumberRequest',
    payload: { RequestId: 'r2', Count: 10, InvoiceType: 0, Seria: 'EAA', StartNumber: 5 },
    ...NAMESPACES,
  });

  const body = xml.slice(xml.indexOf('<request>') + '<request>'.length, xml.indexOf('</request>'));
  const order = [...body.matchAll(/<(\w+)>/g)].map((match) => match[1]);
  assert.deepEqual(order, ['RequestId', 'Count', 'InvoiceType', 'Seria', 'StartNumber']);
});

test('an array of fiscal codes uses the Microsoft Arrays namespace', () => {
  const xml = buildEnvelope({
    operation: 'GetTaxpayersInfo',
    requestType: 'TaxpayersRequest',
    payload: { RequestId: 'r3', FiscalCodes: ['1000000000033', '1000000000015'] },
    ...NAMESPACES,
  });

  assert.ok(xml.includes('xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays"'));
  assert.ok(xml.includes('<a:string>1000000000033</a:string>'));
  assert.ok(xml.includes('<a:string>1000000000015</a:string>'));
});

test('nested identifiers are written with their own field order', () => {
  const xml = buildEnvelope({
    operation: 'GetInvoicesQRcodes',
    requestType: 'InvoicesRequest',
    payload: {
      RequestId: 'r4',
      SeriaAndNumbers: [{ Seria: 'EAA', Number: '000004664' }],
    },
    ...NAMESPACES,
  });

  const item = xml.slice(
    xml.indexOf('<InvoiceIndentificator>') + '<InvoiceIndentificator>'.length,
    xml.indexOf('</InvoiceIndentificator>'),
  );
  const order = [...item.matchAll(/<(\w+)>/g)].map((match) => match[1]);
  assert.deepEqual(order, ['Number', 'Seria']);
});

test('dates are serialised as xsd:dateTime', () => {
  const xml = buildEnvelope({
    operation: 'GetLogs',
    requestType: 'LogsRequest',
    payload: { RequestId: 'r5', From: new Date('2026-08-01T00:00:00.000Z') },
    ...NAMESPACES,
  });
  assert.ok(xml.includes('<From>2026-08-01T00:00:00.000Z</From>'));
});

test('a response is unwrapped and single results still arrive as an array', () => {
  const xml = `<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <GetTaxpayersInfoResponse xmlns="http://tempuri.org/">
          <GetTaxpayersInfoResult xmlns:a="urn:m">
            <a:RequestId>r6</a:RequestId>
            <a:Status>2</a:Status>
            <a:TimeStamp>2026-08-24T10:00:00Z</a:TimeStamp>
            <a:Results>
              <a:Taxpayer><a:IDNO>1000000000033</a:IDNO><a:Name>UNA RETAIL SRL</a:Name></a:Taxpayer>
            </a:Results>
          </GetTaxpayersInfoResult>
        </GetTaxpayersInfoResponse>
      </s:Body>
    </s:Envelope>`;

  const result = parseResponse<any>(xml, 'GetTaxpayersInfo', 200);
  assert.equal(result.RequestId, 'r6');
  assert.equal(result.Status, '2');
  assert.ok(Array.isArray(result.Results));
  assert.equal(result.Results[0].Name, 'UNA RETAIL SRL');
});

test('a SOAP fault becomes SoapFaultError', () => {
  const xml = `<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body><s:Fault>
        <faultcode>s:Client</faultcode>
        <faultstring>AuthenticationFailedException</faultstring>
      </s:Fault></s:Body>
    </s:Envelope>`;

  assert.throws(
    () => parseResponse(xml, 'Test', 500),
    (error: Error) =>
      error instanceof SoapFaultError && error.message.includes('AuthenticationFailedException'),
  );
});

test('a timeout is retried and then reported', async () => {
  let attempts = 0;
  const slowFetch: typeof fetch = async () => {
    attempts += 1;
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };

  await assert.rejects(
    call({
      endpoint: 'https://example.invalid/Service.svc',
      operation: 'Test',
      soapNamespace: 'http://tempuri.org/',
      envelope: '<x/>',
      timeoutMs: 10,
      retries: 2,
      retryBackoffMs: 1,
      fetchImpl: slowFetch,
      sleep: async () => {},
    }),
    /timed out|aborted/,
  );
  assert.equal(attempts, 3);
});

test('a 400 is not retried', async () => {
  let attempts = 0;
  const badFetch: typeof fetch = async () => {
    attempts += 1;
    return new Response('nope', { status: 400 });
  };

  await assert.rejects(
    call({
      endpoint: 'https://example.invalid/Service.svc',
      operation: 'Test',
      soapNamespace: 'http://tempuri.org/',
      envelope: '<x/>',
      timeoutMs: 100,
      retries: 3,
      retryBackoffMs: 1,
      fetchImpl: badFetch,
      sleep: async () => {},
    }),
    /HTTP 400/,
  );
  assert.equal(attempts, 1);
});

test('the SOAPAction header follows the published WSDL', async () => {
  let action = '';
  const capturing: typeof fetch = async (_url, init) => {
    action = String((init?.headers as Record<string, string>)['SOAPAction']);
    return new Response(
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
         <TestResponse xmlns="http://tempuri.org/"><TestResult><Status>2</Status></TestResult></TestResponse>
       </s:Body></s:Envelope>`,
      { status: 200 },
    );
  };

  await call({
    endpoint: 'https://example.invalid/Service.svc',
    operation: 'Test',
    soapNamespace: 'http://tempuri.org/',
    envelope: '<x/>',
    timeoutMs: 100,
    retries: 0,
    retryBackoffMs: 1,
    fetchImpl: capturing,
  });

  assert.equal(action, '"http://tempuri.org/IService/Test"');
});
