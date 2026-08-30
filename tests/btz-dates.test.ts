import { describe, it, expect } from 'vitest';
import {
  addMonths,
  compare,
  daysInMonth,
  describeGap,
  earliest,
  formatDate,
  formatMonth,
  isLeapYear,
  isValid,
  latest,
  monthsBetween,
  parseIso,
  toDayNumber,
  toIso,
  type CivilDate,
} from '@/lib/promotion/dates';

/**
 * Date arithmetic, which is where a promotion calculator goes quietly wrong.
 *
 * Every case here is one that produces a plausible answer when it breaks: off
 * by a day at a month end, off by a year at a December boundary, off by a
 * timezone. None of them would crash.
 */

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });

describe('calendar basics', () => {
  it('knows leap years, including the century rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('gives February the right length in both cases', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2027, 4)).toBe(30);
    expect(daysInMonth(2027, 12)).toBe(31);
  });

  it('rejects impossible dates', () => {
    expect(isValid(d(2027, 2, 29))).toBe(false);
    expect(isValid(d(2028, 2, 29))).toBe(true);
    expect(isValid(d(2027, 13, 1))).toBe(false);
    expect(isValid(d(2027, 4, 31))).toBe(false);
    expect(isValid(d(2027, 0, 10))).toBe(false);
  });
});

describe('day numbering', () => {
  it('anchors on the epoch', () => {
    expect(toDayNumber(d(1970, 1, 1))).toBe(0);
    expect(toDayNumber(d(1970, 1, 2))).toBe(1);
    expect(toDayNumber(d(1969, 12, 31))).toBe(-1);
  });

  it('counts a leap year as 366 days', () => {
    expect(toDayNumber(d(2029, 1, 1)) - toDayNumber(d(2028, 1, 1))).toBe(366);
    expect(toDayNumber(d(2028, 1, 1)) - toDayNumber(d(2027, 1, 1))).toBe(365);
  });

  /**
   * The reason nothing in this module touches `Date`. A UTC-parsed date
   * rendered in a west-of-Greenwich timezone shows the previous day, which is
   * how a promotion date silently loses 24 hours.
   */
  it('is independent of the host timezone', () => {
    const original = process.env.TZ;
    const readings: number[] = [];
    for (const zone of ['UTC', 'Pacific/Honolulu', 'Pacific/Guam', 'America/New_York']) {
      process.env.TZ = zone;
      readings.push(toDayNumber(d(2028, 2, 15)));
    }
    process.env.TZ = original;
    expect(new Set(readings).size).toBe(1);
  });
});

describe('adding months', () => {
  it('keeps the day of the month when it exists', () => {
    expect(addMonths(d(2025, 8, 15), 36)).toEqual(d(2028, 8, 15));
    expect(addMonths(d(2026, 6, 15), 20)).toEqual(d(2028, 2, 15));
    expect(addMonths(d(2026, 6, 15), 28)).toEqual(d(2028, 10, 15));
  });

  it('crosses the year boundary in both directions', () => {
    expect(addMonths(d(2026, 12, 1), 1)).toEqual(d(2027, 1, 1));
    expect(addMonths(d(2027, 1, 31), -1)).toEqual(d(2026, 12, 31));
    expect(addMonths(d(2026, 3, 10), -6)).toEqual(d(2025, 9, 10));
  });

  // 31 AUG plus six months is the end of February, not the 3rd of March.
  it('clamps to the length of the target month', () => {
    expect(addMonths(d(2027, 8, 31), 6)).toEqual(d(2028, 2, 29));
    expect(addMonths(d(2026, 8, 31), 6)).toEqual(d(2027, 2, 28));
    expect(addMonths(d(2027, 1, 31), 1)).toEqual(d(2027, 2, 28));
    expect(addMonths(d(2027, 3, 31), -1)).toEqual(d(2027, 2, 28));
  });

  it('is a no-op at zero', () => {
    expect(addMonths(d(2027, 2, 28), 0)).toEqual(d(2027, 2, 28));
  });

  /**
   * Documents the one asymmetry, so nobody "simplifies" the engine into
   * deriving the fully qualified date by adding six months back onto the BTZ
   * date. It does not round-trip at month ends.
   */
  it('does not round-trip through a short month', () => {
    expect(addMonths(addMonths(d(2027, 8, 31), 6), -6)).toEqual(d(2027, 8, 29));
  });
});

describe('comparison', () => {
  it('orders dates', () => {
    expect(compare(d(2028, 2, 15), d(2028, 8, 15))).toBeLessThan(0);
    expect(compare(d(2028, 8, 15), d(2028, 2, 15))).toBeGreaterThan(0);
    expect(compare(d(2028, 2, 15), d(2028, 2, 15))).toBe(0);
  });

  it('picks the earliest and the latest', () => {
    const dates = [d(2028, 10, 15), d(2028, 8, 15), d(2028, 2, 15)];
    expect(earliest(dates)).toEqual(d(2028, 2, 15));
    expect(latest(dates)).toEqual(d(2028, 10, 15));
    expect(earliest([])).toBeNull();
    expect(latest([])).toBeNull();
  });

  it('counts whole months only', () => {
    expect(monthsBetween(d(2026, 6, 15), d(2028, 2, 15))).toBe(20);
    expect(monthsBetween(d(2026, 6, 15), d(2028, 2, 14))).toBe(19);
    expect(monthsBetween(d(2026, 6, 15), d(2026, 6, 15))).toBe(0);
  });
});

describe('parsing and formatting', () => {
  it('round-trips an ISO date', () => {
    expect(parseIso('2028-02-15')).toEqual(d(2028, 2, 15));
    expect(toIso(d(2028, 2, 15))).toBe('2028-02-15');
    expect(toIso(d(2028, 12, 1))).toBe('2028-12-01');
  });

  it('refuses anything it cannot read exactly', () => {
    for (const bad of ['', '2028-2-15', '15 FEB 2028', '2028-02-30', '2028-13-01', 'today']) {
      expect(parseIso(bad), bad).toBeNull();
    }
  });

  it('prints dates the way a form does', () => {
    expect(formatDate(d(2028, 2, 15))).toBe('15 FEB 2028');
    expect(formatDate(d(2028, 8, 5))).toBe('05 AUG 2028');
    expect(formatMonth(2027, 12)).toBe('DEC 2027');
  });

  it('describes a gap in the units someone would use out loud', () => {
    expect(describeGap(d(2026, 8, 30), d(2026, 8, 30))).toBe('today');
    expect(describeGap(d(2026, 8, 30), d(2026, 9, 30))).toBe('1 month');
    expect(describeGap(d(2026, 8, 30), d(2028, 2, 15))).toBe('17 months');
    expect(describeGap(d(2026, 8, 30), d(2029, 2, 28))).toBe('2 years 5 months');
    expect(describeGap(d(2026, 8, 30), d(2026, 8, 20))).toBe('1 week ago');
  });
});
