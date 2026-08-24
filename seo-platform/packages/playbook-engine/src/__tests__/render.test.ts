import { describe, expect, it } from 'vitest';
import { renderTemplate, resolvePath, TemplateError } from '../render.js';

describe('resolvePath', () => {
  it('достаёт вложенное значение', () => {
    expect(resolvePath({ site: { domain: 'una.md' } }, 'site.domain')).toBe('una.md');
  });

  it('возвращает undefined на обрыве пути вместо исключения', () => {
    expect(resolvePath({ site: {} }, 'site.a.b.c')).toBeUndefined();
  });
});

describe('renderTemplate', () => {
  it('подставляет простые переменные', () => {
    expect(renderTemplate('Сайт {{site.domain}}', { site: { domain: 'una.md' } })).toBe('Сайт una.md');
  });

  it('склеивает массив через запятую', () => {
    expect(renderTemplate('{{locales}}', { locales: ['ru-MD', 'ro-MD'] })).toBe('ru-MD, ro-MD');
  });

  it('разворачивает each с доступом к полям элемента', () => {
    const out = renderTemplate('{{#each rows}}|{{this.a}}{{/each}}', { rows: [{ a: 1 }, { a: 2 }] });
    expect(out).toBe('|1|2');
  });

  it('нумерует элементы через @index', () => {
    expect(renderTemplate('{{#each xs}}{{@index}}.{{this}} {{/each}}', { xs: ['a', 'b'] })).toBe('1.a 2.b ');
  });

  it('пропускает if с пустым массивом', () => {
    expect(renderTemplate('a{{#if xs}}b{{/if}}c', { xs: [] })).toBe('ac');
  });

  it('поддерживает вложенные блоки', () => {
    const tpl = '{{#each groups}}{{#if this.items}}[{{#each this.items}}{{this}}{{/each}}]{{/if}}{{/each}}';
    const out = renderTemplate(tpl, { groups: [{ items: ['x', 'y'] }, { items: [] }] });
    expect(out).toBe('[xy]');
  });

  it('падает на незаполненной переменной в strict-режиме', () => {
    expect(() => renderTemplate('{{missing}}', {})).toThrow(TemplateError);
  });

  it('в нестрогом режиме подставляет пустую строку', () => {
    expect(renderTemplate('[{{missing}}]', {}, { strict: false })).toBe('[]');
  });

  it('перечисляет все незаполненные переменные разом', () => {
    expect(() => renderTemplate('{{a}} {{b}}', {})).toThrow(/a, b/);
  });

  it('не трактует each над не-массивом как пустой список', () => {
    expect(() => renderTemplate('{{#each x}}y{{/each}}', { x: 'строка' })).toThrow(TemplateError);
  });
});
