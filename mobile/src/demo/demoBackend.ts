/**
 * The demo build's transport: the app's real API client, sync engine and
 * database talk to the mock backend inside the app instead of the network.
 *
 * It is the same `tools/mock-backend.cjs` that the development server and the
 * end-to-end tests run, fed the same fixtures, so the demo shows exactly what
 * the tests check - a full catalogue, promotions, stores, sign-in by code 1234,
 * receipts, coupons and orders - on a phone with no backend at all. Data the
 * user creates lives for the session; what the app stored in SQLite stays.
 */
import type { FetchLike } from '../api/client';
import appConfigJson from '../../config/app.config.json';
import banners from '../../tools/fixtures/banners.json';
import categories from '../../tools/fixtures/categories.json';
import company from '../../tools/fixtures/company.json';
import connections from '../../tools/fixtures/connections.json';
import coupons from '../../tools/fixtures/coupons.json';
import fiscalInvoices from '../../tools/fixtures/fiscal_invoices.json';
import loyaltyAccount from '../../tools/fixtures/loyalty_account.json';
import orders from '../../tools/fixtures/orders.json';
import payments from '../../tools/fixtures/payments.json';
import products from '../../tools/fixtures/products.json';
import profile from '../../tools/fixtures/profile.json';
import promotions from '../../tools/fixtures/promotions.json';
import receipts from '../../tools/fixtures/receipts.json';
import stores from '../../tools/fixtures/stores.json';
import { CDN_PREFIX, createMockBackend, imageLabel, labelHash } from '../../tools/mock-backend.cjs';

/** Never resolved: the demo transport strips the origin before routing. */
export const DEMO_BASE_URL = 'https://demo.una.invalid';

/**
 * The fixtures' CDN images do not exist anywhere, and React Native cannot draw
 * the SVG placeholders the development server serves. Each image becomes a
 * one-pixel PNG in a pale brand colour, chosen by the file name, so cards stay
 * coloured and distinguishable, offline, with nothing to download.
 */
const PASTEL_IMAGES = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4dfkqAAVtAqMVUFJYAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4+OwOAAUfApRF7ywsAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4fv8VAAUxAqGL/HuzAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP49OAyAAVtAqbnaHp4AAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4euMHAAVbArafgugaAAAAAElFTkSuQmCC',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO48uw1AAU3AqZEG4FSAAAAAElFTkSuQmCC',
] as const;

function pastelImage(cdnUrl: string): string {
  const label = imageLabel(cdnUrl.slice(CDN_PREFIX.length));
  return PASTEL_IMAGES[labelHash(label) % PASTEL_IMAGES.length]!;
}

function headerValue(headers: RequestInit['headers'], name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? record[key]! : null;
}

/** A fresh in-app backend, and a `fetch` that answers from it. */
export function createDemoFetch(): FetchLike {
  const backend = createMockBackend({
    fixtures: {
      banners,
      categories,
      company,
      connections,
      coupons,
      fiscal_invoices: fiscalInvoices,
      loyalty_account: loyaltyAccount,
      orders,
      payments,
      products,
      profile,
      promotions,
      receipts,
      stores,
    } as Record<string, unknown[]>,
    appConfig: appConfigJson,
    baseUrl: DEMO_BASE_URL,
    rewriteImage: pastelImage,
    placeholderImage: PASTEL_IMAGES[0],
  });

  return async (input, init) => {
    const body = typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined;
    const reply = backend.handle({
      method: init?.method ?? 'GET',
      url: input,
      authorization: headerValue(init?.headers, 'Authorization'),
      body,
    });

    // Only what the API client reads from a response; building a full
    // `Response` would tie the demo to one runtime's fetch polyfill.
    const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    const response = {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? reply.contentType : null) },
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
    return response as unknown as Response;
  };
}
