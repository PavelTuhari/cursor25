/**
 * A local stand-in for SIA "e-Factura".
 *
 * It speaks the same SOAP envelope as the real service - same operation names,
 * same DataContract element order, same status codes - and keeps invoices in
 * memory, walking them through the real lifecycle (7 sent -> 3 accepted). That
 * is enough to develop and test the whole pipeline before SFS issues sandbox
 * credentials, and it is what the integration test runs against.
 *
 * Point the service at it with:
 *   EFACT__SFS__ENDPOINT=http://127.0.0.1:4010/Service.svc
 */
import { createServer } from 'node:http';
import { XMLParser } from 'fast-xml-parser';

const PORT = Number(process.env.MOCK_SFS_PORT ?? 4010);
const MODEL_NS = 'http://schemas.datacontract.org/2004/07/AX.EFactura.Model.ApiModel';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

interface StoredInvoice {
  seria: string;
  number: string;
  xml: string;
  signed: boolean;
  status: number;
  postedAt: number;
  supplierIdno: string;
  buyerIdno: string;
  /** Set when the buyer rejected it, so the supplier can see the reason. */
  rejectComment?: string;
  /** Fixed status instead of the ageing one - used by seeded documents. */
  pinnedStatus?: number;
}

const invoices = new Map<string, StoredInvoice>();
const issued = new Set<string>();
let sequence = 5000;

/**
 * Credentials the mock accepts, and what each may see. The real service scopes
 * every answer to the company behind the API user, so the mock must too -
 * otherwise a test would pass while the production code leaks other companies'
 * documents.
 */
const USERS: Record<string, { password: string; idno: string }> = {
  supplier: { password: 'supplier', idno: '1000000000033' },
  buyer: { password: 'buyer', idno: '1000000000015' },
  beta: { password: 'beta', idno: '1000000000024' },
};

/** Demo register, keyed by IDNO. */
const TAXPAYERS: Record<string, { name: string; address: string; codTVA: string }> = {
  '1000000000033': { name: 'UNA RETAIL SRL', address: 'mun. Chisinau, str. Alba Iulia 75', codTVA: '0301234' },
  '1000000000015': { name: 'ALFA DEMO SRL', address: 'mun. Chisinau, bd. Dacia 47', codTVA: '0305678' },
  '1000000000024': { name: 'BETA DEMO SRL', address: 'mun. Balti, str. Stefan cel Mare 12', codTVA: '0309876' },
};

function element(name: string, value: string | number | boolean): string {
  return `<${name}>${String(value)}</${name}>`;
}

/** The document XML travels inside an element, so it has to be escaped. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function envelope(operation: string, inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <${operation}Response xmlns="http://tempuri.org/">
      <${operation}Result xmlns:a="${MODEL_NS}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        ${inner}
      </${operation}Result>
    </${operation}Response>
  </s:Body>
</s:Envelope>`;
}

function fault(message: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <s:Fault>
      <faultcode>s:Client</faultcode>
      <faultstring>${message}</faultstring>
    </s:Fault>
  </s:Body>
</s:Envelope>`;
}

function base(requestId: string, status = 2): string {
  return (
    `<a:RequestId>${requestId}</a:RequestId>` +
    `<a:Status>${status}</a:Status>` +
    `<a:TimeStamp>${new Date().toISOString()}</a:TimeStamp>`
  );
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A company sees a document only when it is a party to it. */
function visibleTo(invoice: StoredInvoice, idno: string): boolean {
  return invoice.supplierIdno === idno || invoice.buyerIdno === idno;
}

function invoiceList(selected: StoredInvoice[]): string {
  return selected
    .map(
      (invoice) =>
        `<a:Invoice>` +
        element('a:Number', invoice.number) +
        element('a:Seria', invoice.seria) +
        element('a:Status', 2) +
        element('a:TimeStamp', new Date().toISOString()) +
        element('a:InvoiceStatus', currentStatus(invoice)) +
        `</a:Invoice>`,
    )
    .join('');
}

/** Ages an invoice through the lifecycle so status polling has something to see. */
function currentStatus(invoice: StoredInvoice): number {
  if (invoice.pinnedStatus !== undefined) return invoice.pinnedStatus;
  const ageMs = Date.now() - invoice.postedAt;
  if (!invoice.signed) return 0; // draft until signed
  if (ageMs < 2000) return 1; // signed by supplier
  if (ageMs < 5000) return 7; // sent to buyer
  return 3; // accepted by buyer
}

/**
 * Seeds a document that never passed through our own outgoing pipeline - the
 * case that proves the wallet shows invoices from suppliers outside the
 * platform, not just the ones we issued ourselves.
 */
export function seedIncomingInvoice(options: {
  seria: string;
  number: string;
  supplierIdno: string;
  supplierName: string;
  buyerIdno: string;
  buyerName: string;
  total: number;
  totalVat: number;
  status?: number;
  issuedAt?: string;
}): void {
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const xml =
    `<Documents><Document><SupplierInfo>` +
    `<Seria>${options.seria}</Seria><Number>${options.number}</Number>` +
    `<DeliveryDate>${issuedAt}</DeliveryDate>` +
    `<Supplier IDNO="${options.supplierIdno}" TaxpayerType="1" Title="${options.supplierName}" Address="mun. Balti" />` +
    `<Buyer IDNO="${options.buyerIdno}" TaxpayerType="1" Title="${options.buyerName}" Address="mun. Chisinau" />` +
    `<Total>${options.total.toFixed(2)}</Total>` +
    `<TotalTVA>${options.totalVat.toFixed(2)}</TotalTVA>` +
    `<Merchandises><Row Code="1" Name="Servicii" UnitOfMeasure="buc" Quantity="1" ` +
    `UnitPriceWithoutTVA="${(options.total - options.totalVat).toFixed(2)}" ` +
    `TotalPriceWithoutTVA="${(options.total - options.totalVat).toFixed(2)}" TVA="20" ` +
    `TotalTVA="${options.totalVat.toFixed(2)}" TotalPrice="${options.total.toFixed(2)}" /></Merchandises>` +
    `<IsFarma>false</IsFarma><CreationMotiv>4</CreationMotiv>` +
    `</SupplierInfo></Document></Documents>`;

  invoices.set(`${options.seria}/${options.number}`, {
    seria: options.seria,
    number: options.number,
    xml,
    signed: true,
    status: options.status ?? 7,
    pinnedStatus: options.status ?? 7,
    postedAt: Date.now(),
    supplierIdno: options.supplierIdno,
    buyerIdno: options.buyerIdno,
  });
}

const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const doc = parser.parse(body) as Record<string, any>;
    const soapBody = doc?.Envelope?.Body ?? {};
    const security = doc?.Envelope?.Header?.Security;

    const send = (status: number, payload: string) => {
      response.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
      response.end(payload);
    };

    // The real binding rejects an unauthenticated call before it looks at the body.
    const username = security?.UsernameToken?.Username
      ? String(security.UsernameToken.Username)
      : '';
    const passwordNode = security?.UsernameToken?.Password;
    const password =
      passwordNode && typeof passwordNode === 'object'
        ? String(passwordNode['#text'] ?? '')
        : String(passwordNode ?? '');

    if (!username) {
      send(500, fault('AuthenticationFailedException: missing UsernameToken'));
      return;
    }

    const account = USERS[username];
    if (!account || account.password !== password) {
      // A wrong password must be distinguishable from an outage: the service
      // stops the connection on this, and retries on anything else.
      send(500, fault('AuthenticationFailedException: invalid user name or password'));
      return;
    }

    const operation = Object.keys(soapBody)[0];
    if (!operation) {
      send(500, fault('empty SOAP body'));
      return;
    }
    const payload = soapBody[operation]?.request ?? {};
    const requestId = String(payload.RequestId ?? '');

    switch (operation) {
      case 'Test':
        return send(200, envelope('Test', base(requestId)));

      case 'GetTaxpayersInfo': {
        const codes = asArray<string>(payload.FiscalCodes?.string).map(String);
        const results = codes
          .map((code) => {
            const known = TAXPAYERS[code];
            return (
              `<a:Taxpayer>` +
              element('a:Address', known?.address ?? '') +
              element('a:CodTVA', known?.codTVA ?? '') +
              element('a:ExistInTaxRegistry', known ? 'true' : 'false') +
              element('a:IDNO', code) +
              element('a:IsEFacturaActor', known ? 'true' : 'false') +
              element('a:Name', known?.name ?? '') +
              element('a:TaxpayerType', 1) +
              `</a:Taxpayer>`
            );
          })
          .join('');
        return send(200, envelope('GetTaxpayersInfo', `${base(requestId)}<a:Results>${results}</a:Results>`));
      }

      case 'GetSeriaAndNumbers': {
        const count = Number(payload.Count ?? 1);
        const seria = String(payload.Seria || 'EAA');
        const results: string[] = [];
        for (let i = 0; i < count; i += 1) {
          sequence += 1;
          const number = String(sequence).padStart(9, '0');
          issued.add(`${seria}/${number}`);
          results.push(
            `<a:SeriaAndNumber>` +
              element('a:Number', number) +
              element('a:Seria', seria) +
              element('a:Status', 2) +
              `</a:SeriaAndNumber>`,
          );
        }
        return send(
          200,
          envelope('GetSeriaAndNumbers', `${base(requestId)}<a:Results>${results.join('')}</a:Results>`),
        );
      }

      case 'PostInvoices':
      case 'PostInvoicesWithAttachment': {
        const xml = String(payload.InvoicesXml ?? '');
        const signed = String(payload.InvoicesXmlStatus ?? '0') === '1';
        const documents = parser.parse(xml) as Record<string, any>;
        const list = asArray(documents?.Documents?.Document);

        let posted = 0;
        for (const item of list) {
          const info = item?.SupplierInfo ?? {};
          const seria = String(info.Seria ?? '');
          const number = String(info.Number ?? '');
          if (!seria || !number) continue;
          invoices.set(`${seria}/${number}`, {
            seria,
            number,
            xml,
            signed,
            status: signed ? 1 : 0,
            postedAt: Date.now(),
            supplierIdno: String(info.Supplier?.['@_IDNO'] ?? account.idno),
            buyerIdno: String(info.Buyer?.['@_IDNO'] ?? ''),
          });
          posted += 1;
        }

        const errorMessage = posted === 0 ? '1 - XML incorect' : '';
        return send(
          200,
          envelope(
            operation,
            base(requestId, posted === 0 ? 3 : 2) +
              (errorMessage ? element('a:ErrorMessage', errorMessage) : '') +
              element('a:TotalInvoices', list.length) +
              element('a:TotalInvoicesPosted', posted),
          ),
        );
      }

      case 'CheckInvoicesStatus': {
        const wanted = asArray(payload.SeriaAndNumbers?.InvoiceIndentificator);
        const selected = wanted
          .map((id: any) => invoices.get(`${id.Seria}/${id.Number}`))
          .filter((value): value is StoredInvoice => Boolean(value))
          .filter((invoice) => visibleTo(invoice, account.idno));

        return send(
          200,
          envelope(operation, `${base(requestId)}<a:Results>${invoiceList(selected)}</a:Results>`),
        );
      }

      case 'SearchInvoices': {
        const parameters = payload.Parameters ?? {};
        const wantedStatus = Number(parameters.InvoiceStatus ?? -1);
        const buyer = parameters.BuyerIDNO ? String(parameters.BuyerIDNO) : null;
        const supplier = parameters.SupplierIDNO ? String(parameters.SupplierIDNO) : null;
        const startDate = parameters.IssuedOn?.StartDate
          ? new Date(String(parameters.IssuedOn.StartDate)).getTime()
          : null;

        const selected = [...invoices.values()]
          .filter((invoice) => visibleTo(invoice, account.idno))
          .filter((invoice) => (buyer ? invoice.buyerIdno === buyer : true))
          .filter((invoice) => (supplier ? invoice.supplierIdno === supplier : true))
          .filter((invoice) => (startDate ? invoice.postedAt >= startDate : true))
          .filter((invoice) => (wantedStatus >= 0 ? currentStatus(invoice) === wantedStatus : true));

        return send(
          200,
          envelope(operation, `${base(requestId)}<a:Results>${invoiceList(selected)}</a:Results>`),
        );
      }

      case 'GetArchivedInvoices':
      case 'GetAcceptedInvoices':
      case 'GetRejectedInvoices': {
        const page = Number(payload.Page ?? 1);
        const wantedStatus =
          operation === 'GetAcceptedInvoices' ? 3 : operation === 'GetRejectedInvoices' ? 2 : null;

        const all = [...invoices.values()]
          .filter((invoice) => visibleTo(invoice, account.idno))
          .filter((invoice) => (wantedStatus === null ? true : currentStatus(invoice) === wantedStatus));

        // Paging exists so the first poll of a long-lived company does not try
        // to pull years of documents in one call.
        const pageSize = 50;
        const selected = operation === 'GetArchivedInvoices'
          ? all.slice((page - 1) * pageSize, page * pageSize)
          : all;

        return send(
          200,
          envelope(operation, `${base(requestId)}<a:Results>${invoiceList(selected)}</a:Results>`),
        );
      }

      case 'GetInvoicesBySeriaNumber':
      case 'GetInvoicesForSigning': {
        const wanted = asArray(payload.SeriaAndNumbers?.InvoiceIndentificator);
        const selected = wanted
          .map((id: any) => invoices.get(`${id.Seria}/${id.Number}`))
          .filter((value): value is StoredInvoice => Boolean(value))
          .filter((invoice) => visibleTo(invoice, account.idno));

        const results = selected
          .map(
            (invoice) =>
              `<a:XmlInvoice>` +
              element('a:Number', invoice.number) +
              element('a:Seria', invoice.seria) +
              element('a:Status', 2) +
              element('a:TimeStamp', new Date().toISOString()) +
              element('a:InvoiceStatus', currentStatus(invoice)) +
              `<a:Xml>${escapeXml(invoice.xml)}</a:Xml>` +
              `</a:XmlInvoice>`,
          )
          .join('');

        return send(200, envelope(operation, `${base(requestId)}<a:Results>${results}</a:Results>`));
      }

      case 'GetInvoicesQRcodes': {
        const wanted = asArray(payload.SeriaAndNumbers?.InvoiceIndentificator);
        const results = wanted
          .map((id: any) => {
            const key = `${id.Seria}/${id.Number}`;
            return (
              `<a:InvoiceQRCode>` +
              element('a:Number', String(id.Number)) +
              element('a:Seria', String(id.Seria)) +
              element('a:Status', invoices.has(key) ? 2 : 3) +
              element('a:TimeStamp', new Date().toISOString()) +
              element('a:QRCode', Buffer.from(`QR:${key}`).toString('base64')) +
              element('a:QRCodeText', `https://efactura.sfs.md/EFactura.aspx?id=${encodeURIComponent(key)}`) +
              `</a:InvoiceQRCode>`
            );
          })
          .join('');
        return send(200, envelope('GetInvoicesQRcodes', `${base(requestId)}<a:Results>${results}</a:Results>`));
      }

      case 'GetInvoicesContentForPrint': {
        const first = asArray(payload.SeriaAndNumbers?.InvoiceIndentificator)[0] as any;
        const key = first ? `${first.Seria}/${first.Number}` : '';
        const found = invoices.get(key);
        return send(
          200,
          envelope(
            'GetInvoicesContentForPrint',
            base(requestId) +
              `<a:Result>` +
              element('a:Number', first?.Number ?? '') +
              element('a:Seria', first?.Seria ?? '') +
              element('a:Status', found ? 2 : 3) +
              element('a:TimeStamp', new Date().toISOString()) +
              element('a:Content', Buffer.from(`%PDF-1.4 mock invoice ${key}`).toString('base64')) +
              element('a:Format', 'pdf') +
              `</a:Result>`,
          ),
        );
      }

      case 'GetBankAccountInfo':
        return send(
          200,
          envelope(
            'GetBankAccountInfo',
            base(requestId) +
              `<a:Results><a:BankAccount>` +
              element('a:AccountNumber', String(payload.AccountNumber ?? '')) +
              element('a:BranchCode', 'MOBBMD22') +
              element('a:BranchTitle', 'BC Moldova Agroindbank SA') +
              element('a:IsRegistered', 'true') +
              `</a:BankAccount></a:Results>`,
          ),
        );

      case 'PostAcceptedInvoices':
      case 'PostRejectedInvoices':
      case 'PostCanceledInvoices': {
        const targets =
          operation === 'PostAcceptedInvoices'
            ? asArray(payload.SeriaAndNumbers?.InvoiceIndentificator)
            : asArray(payload.InvoicesComments?.InvoiceComment);

        const newStatus =
          operation === 'PostAcceptedInvoices' ? 3 : operation === 'PostRejectedInvoices' ? 2 : 5;

        const results = targets
          .map((target: any) => {
            const invoice = invoices.get(`${target.Seria}/${target.Number}`);
            const allowed = invoice && visibleTo(invoice, account.idno);
            if (allowed) {
              // The decision sticks: a pinned status stops the ageing clock,
              // which is what makes the status observable in a test.
              invoice!.pinnedStatus = newStatus;
              if (target.Comment) invoice!.rejectComment = String(target.Comment);
            }
            return (
              `<a:InvoiceResult>` +
              element('a:Number', String(target.Number ?? '')) +
              element('a:Seria', String(target.Seria ?? '')) +
              element('a:Status', allowed ? 2 : 3) +
              (allowed ? '' : element('a:Message', 'invoice not found for this taxpayer')) +
              element('a:TimeStamp', new Date().toISOString()) +
              `</a:InvoiceResult>`
            );
          })
          .join('');

        return send(200, envelope(operation, `${base(requestId)}<a:Results>${results}</a:Results>`));
      }

      case 'GetLogs':
        return send(200, envelope('GetLogs', `${base(requestId)}<a:Results></a:Results>`));

      default:
        return send(500, fault(`operation ${operation} is not implemented by the mock`));
    }
  });
});

export function startMock(port = PORT): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: actual,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

export function resetMock(): void {
  invoices.clear();
  issued.clear();
  sequence = 5000;
}

/** Everything the mock currently holds - for assertions in tests. */
export function mockInvoices(): StoredInvoice[] {
  return [...invoices.values()];
}

/**
 * Pins a document's status. The ageing clock is convenient for watching a
 * lifecycle unfold, but a test that needs a specific status has to say so
 * rather than sleep.
 */
export function setMockStatus(seria: string, number: string, status: number): void {
  const invoice = invoices.get(`${seria}/${number}`);
  if (invoice) invoice.pinnedStatus = status;
}

if (process.argv[1]?.endsWith('sfs-mock.ts')) {
  void startMock().then(({ port }) => {
    process.stdout.write(`e-Factura mock listening on http://127.0.0.1:${port}/Service.svc\n`);
  });
}
