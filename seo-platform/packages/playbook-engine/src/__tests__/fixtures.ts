import type { SiteProfile } from '../types.js';

export const UNA_MD: SiteProfile = {
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
};

export const OFFICEPLUS: SiteProfile = {
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
};
