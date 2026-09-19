#!/usr/bin/env node
/**
 * Walks the running app as a shopper would and records a screenshot per step.
 *
 *   node tools/mock-server.mjs --port 4000     # data
 *   npx expo start --web --port 8081          # the app (expo.extra.apiBaseUrl → the mock)
 *   SHOTS_DIR=./shots node tools/screenshot-tour.mjs
 *
 * The result feeds tools/build-test-report.mjs, which turns the shots and the
 * Jest report into the HTML acceptance report in docs/testing/.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.SHOTS_DIR ?? 'shots';
const APP_URL = process.env.APP_URL ?? 'http://localhost:8081';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  // Set CHROMIUM_PATH when Playwright's own download is not the browser to use.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'ru-MD',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0].slice(0, 200)));

const log = [];
const shots = [];
let index = 0;

async function shot(name) {
  index += 1;
  const file = `${String(index).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push(file);
  log.push(`OK   shot ${file}`);
}

async function alive() {
  const text = await page.innerText('body').catch(() => '');
  if (text.trim().length > 0) return;
  log.push('WARN blank page, reloading');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(12000);
}

async function tap(text, { exact = true, last = false, wait = 1500 } = {}) {
  // Tab screens stay mounted when hidden, so the same label can exist several
  // times in the DOM; only the one on screen is worth tapping.
  const base = page.getByText(text, { exact }).filter({ visible: true });
  const locator = last ? base.last() : base.first();
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);

  // React Native Web nests labels inside pressables whose parents opt out of
  // pointer events, which trips Playwright's actionability checks; a plain
  // mouse click on the label's centre is what a finger does anyway.
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for "${text}"`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.waitForTimeout(wait);
  log.push(`OK   tap "${text}"`);
}

/**
 * Steps start from the tab bar. A stack screen (a coupon list, an order) hides
 * it, and the header arrow is unreliable in the web renderer, so the tour
 * returns the cheap way: back in history, and a reload if that did not land.
 */
async function ensureTabs() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tab = page.getByText('Профиль', { exact: true }).filter({ visible: true }).last();
    if (await tab.isVisible().catch(() => false)) return;
    if (attempt === 0) {
      await page.goBack({ timeout: 10000 }).catch(() => undefined);
    } else {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => undefined);
      await page.waitForTimeout(12000);
    }
    await page.waitForTimeout(1500);
  }
}

async function step(name, fn) {
  try {
    await alive();
    await ensureTabs();
    await fn();
  } catch (error) {
    log.push(`FAIL ${name}: ${String(error).split('\n')[0].slice(0, 140)}`);
    await page.screenshot({ path: `${OUT}/failed-${name}.png` }).catch(() => undefined);
  }
}

await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForTimeout(22000); // boot, migrations, first sync

await step('home', async () => {
  await shot('home');
});

await step('login', async () => {
  await goTab('Профиль');
  await shot('profile-anonymous');
  await tap('Войти');
  await shot('login-phone');
  await page.getByPlaceholder('+373 60 123 456').filter({ visible: true }).first().fill('060123456');
  await tap('Получить код');
  await shot('login-code');
  await page.getByPlaceholder('••••').filter({ visible: true }).first().fill('1234');
  await page.waitForTimeout(400);
  await tap('Подтвердить', { wait: 8000 });
  await shot('profile-signed-in');
});

await step('loyalty', async () => {
  await goTab('Карта');
  await page.waitForTimeout(2000);
  await shot('loyalty-card');
});

await step('coupons', async () => {
  await goTab('Профиль');
  await tap('Мои купоны');
  await page.waitForTimeout(2000);
  await shot('coupons');
  await tap('Активировать', { wait: 2500 });
  await shot('coupon-activated');
});

await step('receipts', async () => {
  await goTab('Профиль');
  await tap('История покупок');
  await page.waitForTimeout(2000);
  await shot('receipts');
  await page.locator('text=/\\d{2}\\.\\d{2}\\.\\d{4}/').filter({ visible: true }).first().click({ timeout: 15000, force: true });
  await page.waitForTimeout(2000);
  await shot('receipt-detail');
});

await step('catalog', async () => {
  await goTab('Каталог');
  await shot('catalog');
  await tap('Молочные продукты');
  await page.waitForTimeout(1500);
  await shot('category');
});

await step('product', async () => {
  await page.locator('text=/Молоко 2,5%/').filter({ visible: true }).first().click({ timeout: 15000, force: true });
  await page.waitForTimeout(2000);
  await shot('product');
  await tap('В корзину', { wait: 2000 });
  await shot('product-added');
});

await step('search', async () => {
  await goTab('Главная');
  await tap('Поиск товаров, брендов…', { wait: 1200 });
  await page.getByPlaceholder('Поиск товаров, брендов…').filter({ visible: true }).first().fill('кофе');
  await page.waitForTimeout(3000);
  await shot('search');
});

await step('cart', async () => {
  await goTab('Корзина');
  await shot('cart-below-minimum');
  for (let i = 0; i < 9; i += 1) {
    await page.getByLabel('+').filter({ visible: true }).first().click({ timeout: 8000, force: true });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1200);
  await shot('cart-ready');
});

await step('checkout', async () => {
  await tap('Оформить заказ', { wait: 2500 });
  await shot('checkout');
  await tap('UNA Market Центр', { wait: 800 });
  await shot('checkout-filled');
  await tap('Отправить заказ', { wait: 9000 });
  await shot('order');
});

await step('orders', async () => {
  await goTab('Профиль');
  await tap('Мои заказы', { wait: 2500 });
  await shot('orders');
});

await step('list', async () => {
  await goTab('Профиль');
  await tap('Список покупок', { wait: 2000 });
  await shot('shopping-list');
});

await step('promos', async () => {
  await goTab('Профиль');
  await tap('Каталоги акций', { wait: 2500 });
  await shot('promos');
});

await step('stores', async () => {
  await goTab('Профиль');
  await tap('Магазины', { wait: 2500 });
  await shot('stores');
});

await step('settings', async () => {
  await goTab('Профиль');
  await tap('Настройки', { wait: 2000 });
  await shot('settings');
});

await step('dark', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(1000);
  await goTab('Главная');
  await page.waitForTimeout(2000);
  await shot('home-dark');
});

const summary = {
  shots,
  log,
  errors: [...new Set(errors)],
  finishedAt: new Date().toISOString(),
};
writeFileSync(`${OUT}/tour.json`, JSON.stringify(summary, null, 2));
console.log(log.join('\n'));
console.log('--- ERRORS ---\n' + summary.errors.slice(0, 8).join('\n'));
await browser.close();
