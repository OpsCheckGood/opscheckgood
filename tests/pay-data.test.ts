import { describe, it, expect } from 'vitest';
import { CURRENT_PAY, PAY_TABLES, getGrade } from '@/lib/data/pay';

/**
 * Structural checks on the basic pay table, plus a spread of cells pinned to
 * the DFAS page so an edit to any of them fails the build.
 */

const table = CURRENT_PAY.data;

describe('basic pay table', () => {
  it('loads and is verified against DFAS', () => {
    expect(PAY_TABLES.length).toBeGreaterThan(0);
    expect(CURRENT_PAY.isStub).toBe(false);
    expect(CURRENT_PAY.meta.source).toContain('DFAS');
    expect(CURRENT_PAY.meta.sourceUrl).toMatch(/^https:\/\/www\.dfas\.mil\//);
    expect(table.effective).toBe('2026-01-01');
  });

  it('has the 22 DFAS columns in order', () => {
    expect(table.columns.length).toBe(22);
    expect(table.columns[0]).toBe('2 or less');
    expect(table.columns.at(-1)).toBe('Over 40');
    expect(table.steps).toEqual([0, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40]);
  });

  it('carries every grade DFAS prints', () => {
    const ids = table.grades.map((g) => g.id);
    for (const g of ['E-1', 'E-9', 'W-1', 'W-5', 'O-1', 'O-10', 'O-1E', 'O-3E']) {
      expect(ids).toContain(g);
    }
    expect(ids).toContain('E-1 under 4 months');
    expect(table.grades.length).toBe(28);
  });

  // Loader enforces this; the test says so in plain words.
  it('never pays less for longer service within a grade', () => {
    for (const grade of table.grades) {
      let last = 0;
      for (const rate of grade.monthly) {
        if (rate === null) continue;
        expect(rate, grade.id).toBeGreaterThanOrEqual(last);
        last = rate;
      }
    }
  });

  it('pays a higher grade at least as much at the same length of service', () => {
    const groups = ['enlisted', 'officer', 'warrant'] as const;
    for (const group of groups) {
      const grades = table.grades.filter((g) => g.group === group && !g.id.includes(' '));
      for (let i = 1; i < grades.length; i++) {
        for (let c = 0; c < table.columns.length; c++) {
          const lower = grades[i - 1]!.monthly[c];
          const higher = grades[i]!.monthly[c];
          if (lower === null || higher === null) continue;
          expect(higher, `${grades[i]!.id} vs ${grades[i - 1]!.id} at ${table.columns[c]}`).toBeGreaterThanOrEqual(lower);
        }
      }
    }
  });

  it('applies the officer pay caps', () => {
    expect(table.caps.levelII!.monthly).toBe(18999.9);
    expect(table.caps.levelV!.monthly).toBe(15408.3);
    for (const grade of table.grades) {
      if (grade.group !== 'officer') continue;
      const cap = ['O-7', 'O-8', 'O-9', 'O-10'].includes(grade.id) ? 18999.9 : 15408.3;
      for (const rate of grade.monthly) if (rate !== null) expect(rate).toBeLessThanOrEqual(cap);
    }
    expect(getGrade(table, 'O-6')!.monthly.at(-1)).toBe(15408.3);
    expect(getGrade(table, 'O-10')!.monthly.at(-1)).toBe(18999.9);
  });

  // A spread of cells as printed on the DFAS pages, effective 1 January 2026.
  it.each([
    ['E-1 under 4 months', 0, 2225.7],
    ['E-1', 0, 2407.2],
    ['E-2', 5, 2697.9],
    ['E-3', 2, 3198.0],
    ['E-4', 3, 3658.5],
    ['E-5', 0, 3342.9],
    ['E-5', 4, 4110.0],
    ['E-5', 7, 4421.7],
    ['E-6', 4, 4235.7],
    ['E-6', 7, 5043.3],
    ['E-7', 0, 3932.1],
    ['E-7', 8, 5835.0],
    ['E-7', 14, 7067.4],
    ['E-8', 5, 5656.5],
    ['E-8', 11, 6995.4],
    ['E-9', 6, 6910.2],
    ['E-9', 14, 9267.9],
    ['E-9', 21, 10729.2],
    ['W-1', 0, 4056.6],
    ['W-2', 5, 6051.0],
    ['W-3', 10, 8150.4],
    ['W-4', 16, 10653.6],
    ['W-5', 11, 10169.7],
    ['W-5', 21, 13308.3],
    ['O-1', 0, 4150.2],
    ['O-1', 2, 5222.4],
    ['O-2', 3, 6484.5],
    ['O-3', 4, 7737.0],
    ['O-3', 8, 9004.2],
    ['O-4', 6, 9420.0],
    ['O-5', 9, 11391.3],
    ['O-6', 13, 14479.2],
    ['O-7', 10, 16817.7],
    ['O-8', 10, 17911.8],
    ['O-8', 11, 18598.2],
    ['O-9', 11, 18999.9],
    ['O-1E', 3, 5222.4],
    ['O-2E', 6, 7183.8],
    ['O-3E', 8, 9137.1],
    ['O-3E', 10, 9609.6],
  ])('%s column %i is %d', (id, column, rate) => {
    expect(getGrade(table, id)!.monthly[column]).toBe(rate);
  });

  it('leaves the cells DFAS leaves blank', () => {
    expect(getGrade(table, 'E-9')!.monthly.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(getGrade(table, 'E-8')!.monthly.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(getGrade(table, 'O-10')!.monthly.slice(0, 11).every((v) => v === null)).toBe(true);
    expect(getGrade(table, 'W-5')!.monthly.slice(0, 11).every((v) => v === null)).toBe(true);
    expect(getGrade(table, 'O-3E')!.monthly.slice(0, 3)).toEqual([null, null, null]);
  });
});
