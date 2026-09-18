import { describe, it, expect } from 'vitest';
import { CURRENT_PAY } from '@/lib/data/pay';
import {
  columnIndex,
  difference,
  formatSigned,
  formatUsd,
  lookup,
  nextGrade,
  serviceYears,
} from '@/lib/pay/basic';

const table = CURRENT_PAY.data;

describe('columnIndex', () => {
  const steps = table.steps;

  it('applies a column only once service is over its bound', () => {
    expect(columnIndex(0, steps)).toBe(0);
    expect(columnIndex(1.9, steps)).toBe(0);
    // Two years exactly is still "2 or less".
    expect(columnIndex(2, steps)).toBe(0);
    expect(columnIndex(2.01, steps)).toBe(1);
    expect(columnIndex(6, steps)).toBe(3); // over 4
    expect(columnIndex(6 + 1 / 12, steps)).toBe(4); // over 6
    expect(columnIndex(40, steps)).toBe(20); // over 38
    expect(columnIndex(45, steps)).toBe(21); // over 40
  });
});

describe('serviceYears', () => {
  it('turns years and months into a fraction, clamping nonsense', () => {
    expect(serviceYears(6, 0)).toBe(6);
    expect(serviceYears(6, 6)).toBe(6.5);
    expect(serviceYears(-3, 20)).toBe(11 / 12);
    expect(serviceYears(Number.NaN, Number.NaN)).toBe(0);
  });
});

describe('lookup', () => {
  it('reads the rate, the annual figure and the payday half', () => {
    const r = lookup(table, 'E-5', serviceYears(6, 3))!;
    expect(r.column).toBe('Over 6');
    expect(r.monthly).toBe(4110.0);
    expect(r.annual).toBe(49320.0);
    expect(r.semiMonthly).toBe(2055.0);
  });

  it('names the next longevity raise and its size', () => {
    const r = lookup(table, 'E-5', serviceYears(6, 3))!;
    expect(r.nextStep).toEqual({ column: 'Over 8', atYears: 8, monthly: 4299.9, delta: 189.9 });
  });

  it('skips flat columns to find the next real raise', () => {
    // E-9 over 26 and over 28 are the same; the raise is at over 30.
    const r = lookup(table, 'E-9', 27)!;
    expect(r.monthly).toBe(9267.9);
    expect(r.nextStep!.column).toBe('Over 30');
  });

  it('says when the grade is at the top of its scale', () => {
    expect(lookup(table, 'E-5', 20)!.nextStep).toBeNull();
    expect(lookup(table, 'E-1', 0)!.nextStep).toBeNull();
  });

  it('returns no rate where DFAS prints none', () => {
    const r = lookup(table, 'E-9', 4)!;
    expect(r.monthly).toBeNull();
    expect(r.annual).toBeNull();
    expect(r.nextStep).toBeNull();
  });

  it('returns null for an unknown grade', () => {
    expect(lookup(table, 'E-10', 4)).toBeNull();
  });

  it('pays the E-1 under-4-months rate regardless of column', () => {
    expect(lookup(table, 'E-1 under 4 months', 0)!.monthly).toBe(2225.7);
    expect(lookup(table, 'E-1', 0)!.monthly).toBe(2407.2);
  });
});

describe('difference and nextGrade', () => {
  it('measures the second against the first', () => {
    const a = lookup(table, 'E-5', 6.5)!;
    const b = lookup(table, 'E-6', 6.5)!;
    expect(difference(a, b)).toEqual({ monthly: 125.7, annual: 1508.4, percent: 3.1 });
    expect(difference(b, a)!.monthly).toBe(-125.7);
  });

  it('is null when either side has no rate', () => {
    expect(difference(lookup(table, 'E-5', 4)!, lookup(table, 'E-9', 4)!)).toBeNull();
  });

  it('steps to the next grade within the same group', () => {
    expect(nextGrade(table, 'E-5')!.id).toBe('E-6');
    expect(nextGrade(table, 'E-1 under 4 months')!.id).toBe('E-1');
    expect(nextGrade(table, 'E-9')).toBeNull();
    expect(nextGrade(table, 'O-3E')).toBeNull();
    expect(nextGrade(table, 'W-5')).toBeNull();
  });
});

describe('formatting', () => {
  it('prints dollars and a real minus sign', () => {
    expect(formatUsd(4110)).toBe('$4,110.00');
    expect(formatSigned(189.9)).toBe('+$189.90');
    expect(formatSigned(-502.8)).toBe('−$502.80');
  });
});
