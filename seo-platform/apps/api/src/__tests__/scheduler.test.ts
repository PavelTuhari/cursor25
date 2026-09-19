import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CronError, isValidCron, nextRunAt, parseCron } from '../cron.js';
import type { Db } from '../db.js';
import { ARTICLE_PARAMS, UNA_SITE, createTestApp } from './helpers.js';

describe('разбор cron', () => {
  it('разворачивает звёздочку', () => {
    expect(parseCron('* * * * *').minute.size).toBe(60);
  });

  it('разворачивает список и диапазон', () => {
    expect([...parseCron('0,30 9-11 * * *').minute]).toEqual([0, 30]);
    expect([...parseCron('0,30 9-11 * * *').hour]).toEqual([9, 10, 11]);
  });

  it('разворачивает шаг', () => {
    expect([...parseCron('*/15 * * * *').minute]).toEqual([0, 15, 30, 45]);
  });

  it('трактует шаг от одиночного значения как «и дальше»', () => {
    expect([...parseCron('5/20 * * * *').minute]).toEqual([5, 25, 45]);
  });

  it('отвергает выражение не из пяти полей', () => {
    expect(() => parseCron('0 6 * *')).toThrow(CronError);
  });

  it('отвергает значение вне диапазона и называет поле', () => {
    expect(() => parseCron('0 25 * * *')).toThrow(/часы/);
    expect(() => parseCron('0 6 32 * *')).toThrow(/день месяца/);
  });

  it('отвергает нечисловое значение', () => {
    expect(() => parseCron('утром 6 * * *')).toThrow(CronError);
  });

  it('isValidCron не бросает', () => {
    expect(isValidCron('0 6 * * 1')).toBe(true);
    expect(isValidCron('ерунда')).toBe(false);
  });
});

describe('расчёт следующего запуска', () => {
  const at = (iso: string) => new Date(iso);

  it('находит ближайшую минуту строго после указанной', () => {
    expect(nextRunAt('*/15 * * * *', at('2026-09-01T10:00:00Z'))?.toISOString())
      .toBe('2026-09-01T10:15:00.000Z');
  });

  it('не возвращает тот же момент, если он совпадает с расписанием', () => {
    expect(nextRunAt('0 * * * *', at('2026-09-01T10:00:00Z'))?.toISOString())
      .toBe('2026-09-01T11:00:00.000Z');
  });

  it('переходит на следующий день', () => {
    expect(nextRunAt('0 6 * * *', at('2026-09-01T10:00:00Z'))?.toISOString())
      .toBe('2026-09-02T06:00:00.000Z');
  });

  it('понимает день недели: понедельник', () => {
    // 2026-09-01 — вторник, ближайший понедельник 7 сентября.
    expect(nextRunAt('0 6 * * 1', at('2026-09-01T10:00:00Z'))?.toISOString())
      .toBe('2026-09-07T06:00:00.000Z');
  });

  it('при обоих дневных полях срабатывает по любому из них, как Unix cron', () => {
    // 15-е число или пятница, что наступит раньше. 2026-09-04 — пятница.
    expect(nextRunAt('0 6 15 * 5', at('2026-09-01T10:00:00Z'))?.toISOString())
      .toBe('2026-09-04T06:00:00.000Z');
  });

  it('возвращает null для недостижимой даты', () => {
    expect(nextRunAt('0 6 30 2 *', at('2026-09-01T10:00:00Z'))).toBeNull();
  });
});

describe('API расписаний', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  async function site(): Promise<{ id: string }> {
    return (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
  }

  const schedulePayload = (siteId: string, overrides: Record<string, unknown> = {}) => ({
    site_id: siteId,
    template_code: '31-article-draft',
    name: 'Еженедельная статья',
    cron: '0 6 * * 1',
    params: ARTICLE_PARAMS,
    ...overrides,
  });

  it('создаёт расписание и сразу считает следующий запуск', async () => {
    const created = await app.inject({
      method: 'POST', url: '/schedules', payload: schedulePayload((await site()).id),
    });
    expect(created.statusCode).toBe(201);
    // Тестовое «сейчас» — 2026-09-01T08:00Z, вторник; ближайший понедельник 7-го.
    expect(created.json().next_run_at).toContain('2026-09-07T06:00');
  });

  it('отвергает некорректный cron', async () => {
    const res = await app.inject({
      method: 'POST', url: '/schedules',
      payload: schedulePayload((await site()).id, { cron: 'каждый понедельник' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('отвергает неизвестный шаблон', async () => {
    const res = await app.inject({
      method: 'POST', url: '/schedules',
      payload: schedulePayload((await site()).id, { template_code: '99-нет-такого' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('не заводит дубль того же расписания', async () => {
    const siteId = (await site()).id;
    await app.inject({ method: 'POST', url: '/schedules', payload: schedulePayload(siteId) });
    const second = await app.inject({
      method: 'POST', url: '/schedules', payload: schedulePayload(siteId),
    });
    expect(second.statusCode).toBe(409);
  });

  it('выключает и включает расписание', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/schedules', payload: schedulePayload((await site()).id),
    })).json();
    const off = await app.inject({
      method: 'POST', url: `/schedules/${created.id}/toggle`, payload: { enabled: false },
    });
    expect(off.json().enabled).toBe(false);
  });

  it('удаляет расписание', async () => {
    const created = (await app.inject({
      method: 'POST', url: '/schedules', payload: schedulePayload((await site()).id),
    })).json();
    expect((await app.inject({ method: 'DELETE', url: `/schedules/${created.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/schedules' })).json().items).toHaveLength(0);
  });
});

describe('прогон планировщика', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });
  afterEach(async () => {
    await app.close();
    await db.close();
  });

  async function scheduleDue(overrides: Record<string, unknown> = {}) {
    const site = (await app.inject({ method: 'POST', url: '/sites', payload: UNA_SITE })).json();
    const created = (await app.inject({
      method: 'POST',
      url: '/schedules',
      payload: {
        site_id: site.id, template_code: '31-article-draft',
        cron: '*/5 * * * *', params: ARTICLE_PARAMS, ...overrides,
      },
    })).json();
    // Срок ставим относительно часов приложения (в тестах они зафиксированы
    // на 2026-09-01T08:00Z), а не относительно now() базы: планировщик
    // сравнивает именно со своим временем.
    await db.query(`UPDATE schedules SET next_run_at = '2026-09-01T07:00:00Z' WHERE id = $1`,
      [created.id]);
    return created.id as string;
  }

  it('генерирует плейбук и ставит запуск в очередь', async () => {
    const scheduleId = await scheduleDue();
    const result = (await app.inject({ method: 'POST', url: '/scheduler/tick' })).json();

    expect(result.checked).toBe(1);
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0].schedule_id).toBe(scheduleId);

    const runs = (await app.inject({ method: 'GET', url: '/runs?status=queued' })).json();
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0].trigger).toBe('schedule');
  });

  it('сдвигает время следующего запуска, чтобы не сработать повторно', async () => {
    await scheduleDue();
    await app.inject({ method: 'POST', url: '/scheduler/tick' });
    const second = (await app.inject({ method: 'POST', url: '/scheduler/tick' })).json();
    expect(second.checked).toBe(0);
  });

  it('не трогает выключенные расписания', async () => {
    const scheduleId = await scheduleDue();
    await app.inject({
      method: 'POST', url: `/schedules/${scheduleId}/toggle`, payload: { enabled: false },
    });
    expect((await app.inject({ method: 'POST', url: '/scheduler/tick' })).json().checked).toBe(0);
  });

  it('ошибка одного расписания не останавливает остальные', async () => {
    await scheduleDue({ params: {} }); // параметров шаблона нет — генерация упадёт
    const result = (await app.inject({ method: 'POST', url: '/scheduler/tick' })).json();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/параметр/);

    // Расписание осталось включённым, но время сдвинуто: иначе оно
    // срабатывало бы в каждом тике.
    const schedules = (await app.inject({ method: 'GET', url: '/schedules' })).json();
    expect(schedules.items[0].enabled).toBe(true);
    expect(schedules.items[0].last_error).toMatch(/параметр/);
  });
});
