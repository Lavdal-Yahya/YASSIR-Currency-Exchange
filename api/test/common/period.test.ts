import { afterEach, describe, expect, it } from 'vitest';
import {
  dayOfPeriod,
  endOfPeriod,
  getBusinessTimezone,
  setBusinessTimezoneForTest,
  startOfPeriod,
} from '../../src/common/period.js';

afterEach(() => setBusinessTimezoneForTest(undefined));

describe('startOfPeriod', () => {
  it('month boundary in Nouakchott is 00:00 local on the 1st', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    // Nouakchott is UTC+0 year-round.
    const mid = new Date('2026-03-15T13:00:00Z');
    const start = startOfPeriod(mid, 'month');
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('month boundary in Europe/Paris shifts by the offset (UTC+1 in winter)', () => {
    setBusinessTimezoneForTest('Europe/Paris');
    // A UTC 23:30 on Feb 28 is Mar 1 00:30 in Paris → still in March
    // for the local period.
    const late = new Date('2026-02-28T23:30:00Z');
    const start = startOfPeriod(late, 'month');
    // 00:00 Paris on Mar 1 == 23:00 UTC on Feb 28
    expect(start.toISOString()).toBe('2026-02-28T23:00:00.000Z');
  });

  it('day boundary is midnight local', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    const t = new Date('2026-03-15T13:00:00Z');
    expect(startOfPeriod(t, 'day').toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('week boundary is Monday 00:00 local', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    // 2026-03-15 is a Sunday. Monday of that week is 2026-03-09.
    const sun = new Date('2026-03-15T13:00:00Z');
    expect(startOfPeriod(sun, 'week').toISOString()).toBe('2026-03-09T00:00:00.000Z');
  });

  it('year boundary is Jan 1 00:00 local', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    const t = new Date('2026-07-04T13:00:00Z');
    expect(startOfPeriod(t, 'year').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('endOfPeriod', () => {
  it('month end is the next month’s 1st', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    const t = new Date('2026-03-15T13:00:00Z');
    expect(endOfPeriod(t, 'month').toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
  it('year end is next Jan 1', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    const t = new Date('2026-07-04T13:00:00Z');
    expect(endOfPeriod(t, 'year').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('dayOfPeriod', () => {
  it('returns the day of the month in the business timezone', () => {
    setBusinessTimezoneForTest('Africa/Nouakchott');
    expect(dayOfPeriod(new Date('2026-03-15T13:00:00Z'))).toBe(15);
  });
});

describe('getBusinessTimezone', () => {
  it('reads the env fallback when nothing is overridden', () => {
    setBusinessTimezoneForTest(undefined);
    // BUSINESS_TZ is set in .env / CI env; either way one of these two is true.
    const tz = getBusinessTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
  it('honours the override for tests', () => {
    setBusinessTimezoneForTest('Europe/Paris');
    expect(getBusinessTimezone()).toBe('Europe/Paris');
  });
});
