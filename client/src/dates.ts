// Dates are handled as plain strings: 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM'.
// All math is done in UTC so the browser's timezone/DST never shifts a day.

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(d: string, n: number): string {
  const dt = toDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

export function addMonths(d: string, n: number): string {
  const dt = toDate(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fromDate(dt);
}

export function dayOfWeek(d: string): number {
  return toDate(d).getUTCDay();
}

/** Monday of the week containing d. */
export function startOfWeek(d: string): string {
  return addDays(d, -((dayOfWeek(d) + 6) % 7));
}

export function startOfMonth(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: string): string {
  return addDays(addMonths(startOfMonth(d), 1), -1);
}

export function range(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** Visible range for a view. Month view shows whole weeks (Mon–Sun). */
export function viewRange(view: 'day' | 'week' | 'month', anchor: string): [string, string] {
  if (view === 'day') return [anchor, anchor];
  if (view === 'week') return [startOfWeek(anchor), addDays(startOfWeek(anchor), 6)];
  const s = startOfWeek(startOfMonth(anchor));
  const e = addDays(startOfWeek(endOfMonth(anchor)), 6);
  return [s, e];
}

export function shiftAnchor(view: 'day' | 'week' | 'month', anchor: string, dir: number): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  toDate(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

export const fmtLong = (d: string) => fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const fmtShort = (d: string) => fmt(d, { month: 'short', day: 'numeric' });
export const fmtWeekday = (d: string) => fmt(d, { weekday: 'short' });
export const fmtMonth = (d: string) => fmt(d, { month: 'long', year: 'numeric' });
export const fmtDayShort = (d: string) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' });

export function viewTitle(view: 'day' | 'week' | 'month', anchor: string): string {
  if (view === 'day') return fmtLong(anchor);
  if (view === 'month') return fmtMonth(anchor);
  const [s, e] = viewRange('week', anchor);
  const year = e.slice(0, 4);
  return s.slice(0, 7) === e.slice(0, 7)
    ? `${fmt(s, { month: 'long', day: 'numeric' })} – ${Number(e.slice(8))}, ${year}`
    : `${fmtShort(s)} – ${fmtShort(e)}, ${year}`;
}

// ---- times -----------------------------------------------------------------

export function minutesOf(dt: string): number {
  return Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
}

export function hm(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function at(date: string, mins: number): string {
  const extraDays = Math.floor(mins / 1440);
  return `${addDays(date, extraDays)}T${hm(mins)}`;
}

/** Add minutes to a 'YYYY-MM-DDTHH:MM'. */
export function addMinutes(dt: string, mins: number): string {
  return at(dt.slice(0, 10), minutesOf(dt) + mins);
}

export function diffMinutes(a: string, b: string): number {
  return daysBetween(a.slice(0, 10), b.slice(0, 10)) * 1440 + minutesOf(b) - minutesOf(a);
}

/** 13:30 -> "1:30p" */
export function fmtTime(dt: string | number): string {
  const mins = typeof dt === 'number' ? dt : minutesOf(dt);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
}

export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
