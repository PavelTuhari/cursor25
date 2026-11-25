/** Store opening hours and distances. */

export interface WorkingHours {
  /** `mon`..`sun` → `"08:00-22:00"`, or null when closed that day. */
  [day: string]: string | null;
}

export interface StoreLike {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  working_hours?: WorkingHours | null;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface OpenState {
  open: boolean;
  /** Closing time when open, next opening time when closed; null if unknown. */
  until: string | null;
}

function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isOpenAt(hours: WorkingHours | null | undefined, at: Date): OpenState {
  if (!hours) return { open: false, until: null };
  const today = hours[DAYS[at.getDay()] as string];
  if (!today) {
    return { open: false, until: nextOpening(hours, at) };
  }
  const [fromText, toText] = today.split('-');
  const from = fromText ? parseMinutes(fromText) : null;
  const to = toText ? parseMinutes(toText) : null;
  if (from === null || to === null) return { open: false, until: null };

  const minutes = at.getHours() * 60 + at.getMinutes();
  // A range that wraps past midnight (22:00-02:00) is open on both sides of it.
  const open = to > from ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  if (open) return { open: true, until: toText ?? null };
  if (minutes < from) return { open: false, until: fromText ?? null };
  return { open: false, until: nextOpening(hours, at) };
}

function nextOpening(hours: WorkingHours, at: Date): string | null {
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = DAYS[(at.getDay() + offset) % 7] as string;
    const value = hours[day];
    if (value) {
      const [from] = value.split('-');
      return from ?? null;
    }
  }
  return null;
}

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude?: number | null; longitude?: number | null },
): number | null {
  if (to.latitude === null || to.latitude === undefined || to.longitude === null || to.longitude === undefined) {
    return null;
  }
  const earthRadius = 6371;
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

export function sortByDistance<T extends StoreLike>(
  stores: T[],
  from: { latitude: number; longitude: number } | null,
): Array<T & { distanceKm: number | null }> {
  const withDistance = stores.map((store) => ({
    ...store,
    distanceKm: from ? distanceKm(from, store) : null,
  }));
  if (!from) return withDistance;
  return withDistance.sort((a, b) => {
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}
