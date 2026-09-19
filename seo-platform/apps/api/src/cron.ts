/**
 * Минимальный разбор cron-выражений (5 полей, UTC).
 *
 * Поддерживается то, что нужно расписаниям SEO: `*`, числа, списки `1,15`,
 * диапазоны `1-5`, шаги `*​/15` и `0-30/10`. Секунд нет — минимальная гранулярность
 * расписания одна минута, чаще запускать SEO-задачи бессмысленно.
 *
 * Своя реализация вместо библиотеки: нужен предсказуемый разбор с понятными
 * ошибками и расчёт следующего запуска от произвольного момента для тестов.
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronError';
  }
}

interface FieldSpec {
  min: number;
  max: number;
  name: string;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59, name: 'минуты' },
  { min: 0, max: 23, name: 'часы' },
  { min: 1, max: 31, name: 'день месяца' },
  { min: 1, max: 12, name: 'месяц' },
  { min: 0, max: 6, name: 'день недели' },
];

/** Разворачивает одно поле в множество допустимых значений. */
export function parseField(raw: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronError(`${spec.name}: некорректный шаг "${stepPart}"`);
    }

    let from: number;
    let to: number;
    if (rangePart === '*' || rangePart === undefined) {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number);
      from = a as number;
      to = b as number;
    } else {
      from = Number(rangePart);
      to = from;
      // Одиночное значение с шагом означает «от него и дальше»: 5/10 = 5,15,25...
      if (stepPart !== undefined) to = spec.max;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new CronError(`${spec.name}: нечисловое значение "${rangePart}"`);
    }
    if (from < spec.min || to > spec.max || from > to) {
      throw new CronError(
        `${spec.name}: значение "${part}" вне диапазона ${spec.min}-${spec.max}`,
      );
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Заданы ли оба дневных поля — тогда срабатывает любое из них, как в Unix cron. */
  bothDayFields: boolean;
}

export function parseCron(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      `Ожидалось 5 полей (минуты часы день месяц день_недели), получено ${parts.length}`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minute, FIELDS[0]!),
    hour: parseField(hour, FIELDS[1]!),
    dayOfMonth: parseField(dayOfMonth, FIELDS[2]!),
    month: parseField(month, FIELDS[3]!),
    dayOfWeek: parseField(dayOfWeek, FIELDS[4]!),
    bothDayFields: dayOfMonth !== '*' && dayOfWeek !== '*',
  };
}

function matches(schedule: CronSchedule, date: Date): boolean {
  const dayByMonth = schedule.dayOfMonth.has(date.getUTCDate());
  const dayByWeek = schedule.dayOfWeek.has(date.getUTCDay());
  const dayMatches = schedule.bothDayFields ? dayByMonth || dayByWeek : dayByMonth && dayByWeek;
  return (
    schedule.minute.has(date.getUTCMinutes()) &&
    schedule.hour.has(date.getUTCHours()) &&
    schedule.month.has(date.getUTCMonth() + 1) &&
    dayMatches
  );
}

/**
 * Ближайший момент срабатывания строго после `after`.
 * Возвращает null, если за четыре года совпадения нет (например 30 февраля).
 */
export function nextRunAt(expression: string, after: Date): Date | null {
  const schedule = parseCron(expression);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = 60 * 24 * 366 * 4;
  for (let i = 0; i < limit; i += 1) {
    if (matches(schedule, cursor)) return cursor;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

/** Валидна ли строка расписания. Используется при создании расписания. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
