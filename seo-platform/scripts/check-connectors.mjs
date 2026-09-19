#!/usr/bin/env node
/**
 * Живая проверка подключений к соцсетям.
 *
 * Обращается к настоящим API платформ и показывает, что именно они ответили.
 * Ничего не публикует: вызываются только методы чтения.
 *
 * Запуск с учётными данными тестовых приложений:
 *   TEST_FB_PAGE_ID=... TEST_FB_TOKEN=... node scripts/check-connectors.mjs
 *
 * Без учётных данных скрипт всё равно полезен: он проверяет, что платформы
 * достижимы, а разбор их ошибок работает на реальных ответах.
 */
import { socialConnectors } from '../apps/api/dist/runner/connectors/social/index.js';

const connectors = socialConnectors();

const TARGETS = [
  {
    channel: 'facebook',
    label: 'Facebook Page',
    external_id: process.env.TEST_FB_PAGE_ID,
    credential: process.env.TEST_FB_TOKEN,
    docs: 'Тестовое приложение и тестовая страница: developers.facebook.com → App → Roles → Test Users',
  },
  {
    channel: 'instagram',
    label: 'Instagram Business',
    external_id: process.env.TEST_IG_USER_ID,
    credential: process.env.TEST_IG_TOKEN,
    docs: 'Instagram Business аккаунт, связанный с тестовой страницей Facebook',
  },
  {
    channel: 'linkedin',
    label: 'LinkedIn',
    external_id: process.env.TEST_LI_URN,
    credential: process.env.TEST_LI_TOKEN,
    docs: 'Developer-приложение LinkedIn, продукт Share on LinkedIn / Community Management',
  },
  {
    channel: 'telegram',
    label: 'Telegram',
    external_id: process.env.TEST_TG_CHAT,
    credential: process.env.TEST_TG_TOKEN,
    sandbox: process.env.TEST_TG_SANDBOX !== 'false',
    docs: 'Бот от @BotFather; тестовая среда включается sandbox = true',
  },
];

// Заведомо неверные значения: проверяем, что живой API отвечает и что его
// ошибка разбирается, когда настоящих учётных данных ещё нет.
const PROBE = { external_id: 'probe', credential: 'invalid-token-for-contract-check' };

const results = [];

for (const target of TARGETS) {
  const connector = connectors.get(target.channel);
  const configured = Boolean(target.external_id && target.credential);
  const account = {
    external_id: target.external_id ?? PROBE.external_id,
    credential: target.credential ?? PROBE.credential,
    sandbox: target.sandbox ?? true,
    config: {},
  };

  process.stderr.write(`Проверяю ${target.label}…\n`);
  let outcome;
  try {
    outcome = await connector.verify(account);
  } catch (error) {
    outcome = { ok: false, error: `не удалось обратиться к платформе: ${error.message}` };
  }

  results.push({ ...target, configured, outcome });
}

console.log('\n=== Подключения ===\n');
for (const row of results) {
  const mark = row.outcome.ok ? '  OK  ' : row.configured ? 'ОШИБКА' : ' проба';
  console.log(`[${mark}] ${row.label}`);
  if (row.outcome.ok) {
    console.log(`         аккаунт: ${row.outcome.account_name}`);
  } else {
    console.log(`         ответ платформы: ${row.outcome.error ?? '—'}`);
    if (row.outcome.hint) console.log(`         что делать: ${row.outcome.hint}`);
    if (!row.configured) console.log(`         не настроено. ${row.docs}`);
  }
  console.log();
}

const configured = results.filter((r) => r.configured);
const failed = configured.filter((r) => !r.outcome.ok);
if (configured.length === 0) {
  console.log('Настроенных подключений нет: проверялась только достижимость платформ ' +
    'и разбор их ошибок. Обе проверки пройдены, если выше видны ответы платформ.');
} else {
  console.log(`Настроено: ${configured.length}, с ошибкой: ${failed.length}`);
}
process.exit(failed.length > 0 ? 1 : 0);
