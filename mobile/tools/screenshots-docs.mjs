#!/usr/bin/env node
/**
 * Takes the screenshots the documentation uses, in the language asked for.
 *
 *   node tools/mock-server.mjs --port 4000
 *   EXPO_PUBLIC_API_BASE_URL=http://localhost:4000 npx expo start --web --port 8081
 *   SHOTS_DIR=../docs/ro/img LANG_CODE=ro node tools/screenshots-docs.mjs
 *
 * Labels come from config/l10n, so the walk survives a change of wording. The
 * clock is pinned to the week of the fixtures: offers, coupons and the invoice
 * window are then in date, whenever this runs.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LANG = process.env.LANG_CODE ?? 'ro';
const OUT = process.env.SHOTS_DIR ?? 'shots';
const APP_URL = process.env.APP_URL ?? 'http://localhost:8081';
const CLOCK = process.env.CLOCK ?? '2026-08-25T10:00:00+03:00';

const words = JSON.parse(readFileSync(join(here, '..', 'config', 'l10n', `${LANG}.json`), 'utf8'));
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
const t = (key) => words[key] ?? key;
const category = fixture('categories').find((item) => item.parent_id === null);
const categoryName = category.name[LANG];
const product = fixture('products').find((item) => item.category_id === category.id).name[LANG];
const store = fixture('stores')[0].name[LANG];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: `${LANG}-MD`,
  timezoneId: 'Europe/Chisinau',
});
const page = await context.newPage();
await page.clock.setFixedTime(new Date(CLOCK));
const errors = new Set();
page.on('pageerror', (e) => errors.add(String(e).split('\n')[0].slice(0, 200)));

const failed = [];
const taken = [];
const visible = (text, exact = true) => page.getByText(text, { exact }).filter({ visible: true });

async function shot(name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  taken.push(name);
}

async function press(locator, wait = 1500) {
  await locator.waitFor({ state: 'visible', timeout: 12000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(wait);
}
const tap = (text, { exact = true, last = false, wait } = {}) =>
  press(last ? visible(text, exact).last() : visible(text, exact).first(), wait);
const tab = (key) => tap(t(key), { last: true, wait: 1800 });

async function home() {
  for (let i = 0; i < 3; i += 1) {
    if (await visible(t('tab.profile')).last().isVisible().catch(() => false)) return;
    if (i === 0) await page.goBack().catch(() => undefined);
    else {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(9000);
    }
    await page.waitForTimeout(1200);
  }
}

async function step(name, fn) {
  try {
    await home();
    await fn();
  } catch (error) {
    failed.push(`${name}: ${String(error).split('\n')[0].slice(0, 160)}`);
    await page.screenshot({ path: `${OUT}/failed-${name}.png` }).catch(() => undefined);
  }
}

await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 300000 });
await visible(t('tab.profile')).last().waitFor({ state: 'visible', timeout: 180000 });
await page.waitForTimeout(8000);

await step('home', () => shot('home'));

await step('login', async () => {
  await tab('tab.profile');
  await shot('profile-guest');
  await tap(t('profile.login'));
  await page.getByPlaceholder('+373 60 123 456').filter({ visible: true }).first().fill('060123456');
  await shot('login-phone');
  await tap(t('auth.send_code'));
  await page.getByPlaceholder('••••').filter({ visible: true }).first().fill('1234');
  await shot('login-code');
  await tap(t('auth.confirm'), { wait: 7000 });
  await shot('profile');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 700);
  await shot('profile-menu');
});

await step('loyalty', async () => {
  await tab('tab.loyalty');
  await shot('loyalty');
});

const menu = async (key, name, after) => {
  await tab('tab.profile');
  await tap(t(key), { last: true, wait: 2500 });
  await shot(name);
  if (after) await after();
};

await step('coupons', () =>
  menu('menu.coupons', 'coupons', async () => {
    await tap(t('coupons.activate'), { wait: 2000 });
    await shot('coupon-active');
  }));

await step('receipts', () =>
  menu('menu.receipts', 'receipts', async () => {
    await press(page.locator('text=/^\\d{2}\\.\\d{2}, \\d{2}:\\d{2}$/').filter({ visible: true }).first(), 2000);
    await shot('receipt');
    await page.mouse.move(195, 500);
    await page.mouse.wheel(0, 1200);
    await shot('receipt-bottom');
    page.once('dialog', (dialog) => void dialog.accept());
    await tap(t('corporate.request_invoice'), { last: true, wait: 2500 });
    await shot('receipt-requested');
  }));

await step('catalog', async () => {
  await tab('tab.catalog');
  await shot('catalog');
  await tap(categoryName, { last: true, wait: 2000 });
  await shot('category');
});

await step('product', async () => {
  await tab('tab.catalog');
  await tap(categoryName, { last: true, wait: 2000 });
  await tap(product, { last: true, wait: 2000 });
  await shot('product');
  await tap(t('cart.to_cart'), { wait: 1500 });
});

await step('search', async () => {
  await tab('tab.home');
  await tap(t('search.placeholder'), { wait: 1200 });
  await page.getByPlaceholder(t('search.placeholder')).filter({ visible: true }).first().fill('cafea');
  await page.waitForTimeout(2500);
  await shot('search');
});

await step('cart', async () => {
  await tab('tab.cart');
  await shot('cart-minimum');
  for (let i = 0; i < 12; i += 1) {
    await page.getByLabel('+').filter({ visible: true }).first().click({ timeout: 6000, force: true });
    await page.waitForTimeout(250);
  }
  await shot('cart');
  await tap(t('cart.checkout'), { wait: 2500 });
  await tap(store, { wait: 800 });
  await shot('checkout');
  await tap(t('checkout.place_order'), { wait: 8000 });
  await shot('order');
});

await step('orders', () => menu('menu.orders', 'orders'));
await step('list', () => menu('menu.list', 'list'));
await step('promos', () => menu('menu.promos', 'promos'));
await step('stores', () => menu('menu.stores', 'stores'));
await step('settings', () => menu('menu.settings', 'settings'));
await step('account', () => menu('menu.account', 'account'));

await step('corporate', () =>
  menu('menu.corporate', 'corporate', async () => {
    await tap(t('corporate.edit_company'), { last: true, wait: 1800 });
    await shot('company-edit');
  }));

await step('corporate-invoices', async () => {
  await tab('tab.profile');
  await tap(t('menu.corporate'), { last: true, wait: 2500 });
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 900);
  await shot('corporate-invoices');
});

await step('wallet', () =>
  menu('menu.wallet', 'wallet', async () => {
    await page.mouse.move(195, 500);
    await page.mouse.wheel(0, 500);
    await shot('wallet-documents');
    await tap('BETA DEMO SRL', { exact: false, wait: 2000 });
    await shot('invoice');
  }));

await step('connections', async () => {
  await tab('tab.profile');
  await tap(t('menu.wallet'), { wait: 2500 });
  await tap(t('wallet.connections'), { last: true, wait: 2000 }).catch(() => tap(t('wallet.connect'), { wait: 2000 }));
  await shot('connections');
  await tap(t('wallet.connect'), { last: true, wait: 2000 });
  await shot('connect-company');
});

await step('dark', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await tab('tab.home');
  await shot('home-dark');
});

console.log(`taken ${taken.length}: ${taken.join(' ')}`);
console.log(`failed ${failed.length}\n${failed.join('\n')}`);
console.log(`page errors: ${[...errors].join(' | ') || 'none'}`);
await browser.close();
