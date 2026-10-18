// Where is a technician working on a given day?
//
// A tech works on their home island unless a 'travel' entry covers the day, in
// which case they work on the travel entry's island. A 'time_off' entry covering
// the day marks them unavailable (they still "belong" to whichever island they
// would otherwise be on, so the dispatcher there sees them greyed out).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * @param {{home_island_id:number}} tech
 * @param {string} date YYYY-MM-DD
 * @param {Array<{kind:string, island_id:number|null, start_date:string, end_date:string, id:number}>} entries
 *   travel/time_off entries for this tech
 */
export function locationOn(tech, date, entries) {
  let islandId = tech.home_island_id;
  let travelId = null;
  let offId = null;
  for (const e of entries) {
    if (e.start_date > date || e.end_date < date) continue;
    if (e.kind === 'travel') {
      islandId = e.island_id;
      travelId = e.id;
    } else {
      offId = e.id;
    }
  }
  const status = offId ? 'off' : travelId ? 'travel' : 'home';
  return { islandId, status, travelId, offId };
}

/** Map of date -> location for each date in the range. */
export function locationsForRange(tech, dates, entries) {
  const out = {};
  for (const d of dates) out[d] = locationOn(tech, d, entries);
  return out;
}

/** Two inclusive date ranges overlap. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}
