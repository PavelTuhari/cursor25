/** Date helpers shared by promo validity labels and the sync status block. */

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isStale(lastSyncAt: string | null | undefined, staleAfterMinutes: number, now = new Date()): boolean {
  if (!lastSyncAt) return true;
  const last = new Date(lastSyncAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > staleAfterMinutes * 60_000;
}

export function shouldAutoSync(
  lastSyncAt: string | null | undefined,
  intervalMinutes: number,
  now = new Date(),
): boolean {
  if (!lastSyncAt) return true;
  const last = new Date(lastSyncAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalMinutes * 60_000;
}
