#!/usr/bin/env node
/**
 * Diagnostic: types a series of search terms into the running app and reports
 * which ones return results. Kept because it is what pinned down that the web
 * preview's WebAssembly SQLite mishandles non-ASCII LIKE parameters.
 *
 *   CHROMIUM_PATH=... node tools/probes/search-probe.mjs
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-MD' })).newPage();
await page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded', timeout: 240000 });
await page.waitForTimeout(28000);
const el = page.getByText('Поиск товаров, брендов…', { exact: true }).filter({ visible: true }).first();
await el.waitFor({ state: 'visible', timeout: 20000 });
const box = await el.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);
const input = page.getByPlaceholder('Поиск товаров, брендов…').filter({ visible: true }).first();
const terms = ['la', 'lapte', 'lavazza', 'franzeluta', 'оло', 'твор', 'творо', 'творог', 'молок'];
for (const term of terms) {
  await input.fill(term);
  await page.waitForTimeout(2800);
  const body = await page.innerText('body');
  console.log(`[${term}] len=${term.length} ${body.includes('Ничего не найдено') ? 'NOT FOUND' : 'FOUND'}`);
}
await browser.close();
