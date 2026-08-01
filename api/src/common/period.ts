// Timezone-aware period boundaries.
//
// The business runs in `Africa/Nouakchott` (D-012). "This month" on the
// dashboard means the 1st at 00:00 local — not UTC. The offset shifts
// by an hour twice a year in some zones (Nouakchott is UTC+0 year-round
// but the code has to work for anyone who redeploys elsewhere), so
// naive UTC math breaks reports at the DST boundary.
//
// In P1 the timezone is read from the env (BUSINESS_TZ). From P2-02 the
// settings row wins; this file reads via a getter that lets us swap the
// source without touching every call site.
//
// Uses `Intl.DateTimeFormat` for tz conversion — zero deps, correct
// modern-Chrome semantics.

export type Granularity = 'day' | 'week' | 'month' | 'year';

interface Parts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1 (Mon) - 7 (Sun), ISO week
}

const WEEKDAY_INDEX: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

let overrideTz: string | undefined;

// getBusinessTimezone — resolution order:
//   1. explicit override (set by tests via setBusinessTimezoneForTest)
//   2. settings row (P2-02 will hook in here)
//   3. BUSINESS_TZ env var
//   4. 'Africa/Nouakchott' hard-coded fallback
export function getBusinessTimezone(): string {
  return overrideTz ?? process.env.BUSINESS_TZ ?? 'Africa/Nouakchott';
}

export function setBusinessTimezoneForTest(tz: string | undefined): void {
  overrideTz = tz;
}

function partsInZone(instant: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(instant)) bag[type] = value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: bag.hour === '24' ? 0 : Number(bag.hour), // some ICU builds emit 24
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: WEEKDAY_INDEX[bag.weekday ?? 'Monday'] ?? 1,
  };
}

// Given local-clock parts (y, m, d, h, mn, s) in `tz`, return the UTC
// instant that matches. Uses the same Intl trick in reverse: pick an
// arbitrary UTC guess and iterate at most twice to correct the offset.
function utcFromZoned(
  tz: string,
  y: number,
  m: number,
  d: number,
  h = 0,
  mn = 0,
  s = 0,
): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, h, mn, s));
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, tz);
    const drift =
      (p.year - y) * 365 * 24 * 3600 +
      (p.month - m) * 30 * 24 * 3600 +
      (p.day - d) * 24 * 3600 +
      (p.hour - h) * 3600 +
      (p.minute - mn) * 60 +
      (p.second - s);
    if (drift === 0) return guess;
    guess = new Date(guess.getTime() - drift * 1000);
  }
  return guess;
}

export function startOfPeriod(
  instant: Date,
  granularity: Granularity,
  tz: string = getBusinessTimezone(),
): Date {
  const p = partsInZone(instant, tz);
  switch (granularity) {
    case 'day':
      return utcFromZoned(tz, p.year, p.month, p.day);
    case 'week': {
      // ISO week: Monday is the first day. Roll back (weekday - 1) days.
      const monday = utcFromZoned(tz, p.year, p.month, p.day);
      return new Date(monday.getTime() - (p.weekday - 1) * 86_400_000);
    }
    case 'month':
      return utcFromZoned(tz, p.year, p.month, 1);
    case 'year':
      return utcFromZoned(tz, p.year, 1, 1);
  }
}

export function endOfPeriod(
  instant: Date,
  granularity: Granularity,
  tz: string = getBusinessTimezone(),
): Date {
  const start = startOfPeriod(instant, granularity, tz);
  const p = partsInZone(start, tz);
  switch (granularity) {
    case 'day':
      return utcFromZoned(tz, p.year, p.month, p.day + 1);
    case 'week':
      return new Date(start.getTime() + 7 * 86_400_000);
    case 'month': {
      const nextMonth = p.month === 12 ? 1 : p.month + 1;
      const nextYear = p.month === 12 ? p.year + 1 : p.year;
      return utcFromZoned(tz, nextYear, nextMonth, 1);
    }
    case 'year':
      return utcFromZoned(tz, p.year + 1, 1, 1);
  }
}

// Which day of the period the instant falls on. Handy for age buckets
// and for the debt-ageing filter chips in P5.
export function dayOfPeriod(instant: Date, tz: string = getBusinessTimezone()): number {
  return partsInZone(instant, tz).day;
}
