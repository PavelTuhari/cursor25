#!/usr/bin/env node
/**
 * Заполняет платформу тремя пилотными сайтами для локального прогона.
 * Только демо-данные: никаких реальных доступов и никаких документов UNA.
 *
 *   API_URL=http://localhost:3000 node scripts/seed-demo.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000';

const SITES = [
  {
    domain: 'una.md',
    name: 'UNA.md',
    locales: ['ru-MD', 'ro-MD'],
    geo: ['MD', 'RO'],
    niche: 'ERP и бухгалтерский учёт для НКО и малого бизнеса',
    description: 'молдавская учётная система для НКО и бизнеса',
    audience: 'главные бухгалтеры НКО и малого бизнеса РМ',
    tone_of_voice: 'экспертный, без маркетингового шума, с примерами из практики РМ',
    banned_claims: ['полностью бесплатно', 'гарантии по срокам налоговых проверок'],
    competitors: ['1c.md', 'sirius.md'],
    una_div: 'UNA',
  },
  {
    domain: 'unisim-soft.com',
    name: 'UNISIM-SOFT',
    locales: ['ru-MD', 'ro-MD', 'en'],
    geo: ['MD', 'EU'],
    niche: 'разработка ПО и интеграции',
    description: 'молдавская IT-компания: заказная разработка, интеграции, ERP',
    audience: 'технические директора и владельцы бизнеса в РМ и ЕС',
    tone_of_voice: 'инженерный, с кейсами и цифрами',
    banned_claims: ['гарантированный срок запуска без оценки'],
    competitors: [],
    una_div: 'USIM',
  },
  {
    domain: 'officeplus.md',
    name: 'OfficePlus',
    locales: ['ru-MD', 'ro-MD'],
    geo: ['MD'],
    niche: 'офисные товары и оборудование',
    description: 'интернет-магазин офисных товаров в Кишинёве',
    audience: 'офис-менеджеры и закупщики',
    tone_of_voice: 'практичный, с конкретикой по ценам в MDL и доставке',
    banned_claims: ['самые низкие цены в Молдове'],
    competitors: ['999.md'],
    una_div: 'OFFP',
  },
];

async function post(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

for (const site of SITES) {
  const result = await post('/sites', site);
  if (result.status === 201) console.log(`создан ${site.domain}`);
  else if (result.status === 409) console.log(`уже есть ${site.domain}`);
  else console.error(`ошибка ${site.domain}: ${result.status} ${JSON.stringify(result.body)}`);
}
