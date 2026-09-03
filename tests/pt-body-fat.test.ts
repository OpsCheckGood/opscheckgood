import { describe, it, expect } from 'vitest';
import { BODY_FAT_TABLES, CURRENT_STANDARDS } from '@/lib/data/pt';
import { assessBodyFat, lookupBodyFat } from '@/lib/pt/score';
import type { BodyFatTable, Sex } from '@/lib/data/types';

/**
 * The published body fat percent tables, AFMAN 36-2905 Attachments 9 and 10.
 *
 * The manual tells the assessor to read a table, not to evaluate a formula, so
 * that is what the tool does. The DoDI 1308.3 circumference equation is kept
 * for measurements off the end of the published range, and is used here as an
 * independent check: the tables are generated from it, so every cell should
 * sit within a point of it. Anything further apart is a transcription error,
 * which is the whole reason this file exists.
 */

const standards = CURRENT_STANDARDS.data;
const tables = BODY_FAT_TABLES.data;

const EQUATION: Record<Sex, (c: number, h: number) => number> = {
  male: (c, h) => 86.01 * Math.log10(c) - 70.041 * Math.log10(h) + 36.76,
  female: (c, h) => 163.205 * Math.log10(c) - 97.684 * Math.log10(h) - 78.387,
};

function axisValues(axis: BodyFatTable['circumference']): number[] {
  return Array.from({ length: axis.count }, (_, i) => axis.start + i * axis.step);
}

describe('the published body fat tables', () => {
  it('is a verified source with a real URL and date', () => {
    expect(BODY_FAT_TABLES.isStub).toBe(false);
    expect(BODY_FAT_TABLES.meta.sourceUrl).toMatch(/^https:\/\//);
    expect(BODY_FAT_TABLES.meta.source).toContain('Attachments 9 and 10');
    expect(Number.isNaN(Date.parse(BODY_FAT_TABLES.meta.verifiedDate))).toBe(false);
  });

  it('covers the ranges the attachments print', () => {
    // Attachment 9 (male): circumference 11.00-35.25, height 60-74.5.
    expect(tables.male.circumference).toEqual({ start: 11, step: 0.25, count: 98 });
    expect(tables.male.height).toEqual({ start: 60, step: 0.5, count: 30 });
    // Attachment 10 (female): circumference 34.50-75.75, height 58-77.5.
    expect(tables.female.circumference).toEqual({ start: 34.5, step: 0.25, count: 166 });
    expect(tables.female.height).toEqual({ start: 58, step: 0.5, count: 40 });

    const cells = (['male', 'female'] as const).reduce(
      (n, sex) => n + tables[sex].circumference.count * tables[sex].height.count,
      0,
    );
    expect(cells).toBe(9580);
  });

  it('never says more circumference is less fat, or more height is more', () => {
    // The loader enforces both; asserting them here means a change to the
    // loader cannot quietly stop enforcing them.
    for (const sex of ['male', 'female'] as const) {
      const { rows, height } = tables[sex];
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = 0; j < height.count; j += 1) {
          if (i > 0) expect(rows[i]![j]!).toBeGreaterThanOrEqual(rows[i - 1]![j]!);
          if (j > 0) expect(rows[i]![j]!).toBeLessThanOrEqual(rows[i]![j - 1]!);
        }
      }
    }
  });

  it('sits within a point of the equation it was generated from, everywhere', () => {
    for (const sex of ['male', 'female'] as const) {
      const table = tables[sex];
      const circs = axisValues(table.circumference);
      const heights = axisValues(table.height);
      let worst = 0;
      let where = '';
      for (let i = 0; i < circs.length; i += 1) {
        for (let j = 0; j < heights.length; j += 1) {
          const expected = Math.max(0, Math.round(EQUATION[sex](circs[i]!, heights[j]!)));
          const gap = Math.abs(table.rows[i]![j]! - expected);
          if (gap > worst) {
            worst = gap;
            where = `${sex} circumference ${circs[i]} height ${heights[j]}: table ${table.rows[i]![j]}, equation ${expected}`;
          }
        }
      }
      expect(`${sex}: ${worst}${worst > 1 ? ` at ${where}` : ''}`).toBe(`${sex}: 1`);
    }
  });

  it('holds the three repaired cells at the values their neighbours force', () => {
    // The text extraction of the source corrupted a digit in two male rows.
    // Each replacement is reproducible from the cells around it; see the meta
    // block in the data file. Recorded here so a silent change is visible.
    expect(lookupBodyFat(tables.male, 19.5, 70)).toBe(18);
    expect(lookupBodyFat(tables.male, 26, 60)).toBe(34);
    expect(lookupBodyFat(tables.male, 26, 63.5)).toBe(32);
  });
});

describe('reading a value out of the tables', () => {
  it('returns the published cell', () => {
    // Attachment 9, first row: circumference 11.00 against height 60 is 3%.
    expect(lookupBodyFat(tables.male, 11, 60)).toBe(3);
    expect(lookupBodyFat(tables.male, 11, 63.5)).toBe(0);
    // Attachment 10, first row: circumference 34.50 against height 58.
    expect(lookupBodyFat(tables.female, 34.5, 58)).toBe(tables.female.rows[0]![0]);
  });

  it('refuses a measurement between steps rather than snapping to one', () => {
    // A tenth of an inch is not a row. Guessing which row to use is exactly
    // how a tool ends up quietly scoring somebody off the wrong line.
    expect(lookupBodyFat(tables.male, 20.1, 70)).toBeNull();
    expect(lookupBodyFat(tables.male, 20, 70.2)).toBeNull();
  });

  it('refuses a measurement off the end of the table', () => {
    expect(lookupBodyFat(tables.male, 10.75, 70)).toBeNull();
    expect(lookupBodyFat(tables.male, 35.5, 70)).toBeNull();
    expect(lookupBodyFat(tables.male, 20, 59.5)).toBeNull();
    expect(lookupBodyFat(tables.male, 20, 75)).toBeNull();
  });
});

describe('the assessment reads the table', () => {
  it('takes the percent from the attachment, not the equation', () => {
    const a = assessBodyFat(standards, 'male', 66, { neck: 15.5, abdomen: 34.25 });
    expect(a.circumference).toBe(18.75);
    expect(a.fromTable).toBe(true);
    expect(a.percent).toBe(lookupBodyFat(tables.male, 18.75, 66));
    expect(a.crossCheck).toContain('Attachment 9');
  });

  it('falls back to the equation off the end, and says so', () => {
    // A circumference below the smallest row the attachment prints.
    const tiny = assessBodyFat(standards, 'male', 66, { neck: 15.5, abdomen: 25.5 });
    expect(tiny.circumference).toBe(10);
    expect(tiny.fromTable).toBe(false);
    expect(tiny.percent).not.toBeNull();
    expect(tiny.crossCheck).toContain('falls outside');
    expect(tiny.crossCheck).toContain('not a published one');
  });

  it('agrees with the table for every taped combination it can reach', () => {
    // Walk real measurement combinations rather than trusting one spot check.
    let checked = 0;
    for (let neck = 13; neck <= 18; neck += 0.25) {
      for (let abdomen = 30; abdomen <= 44; abdomen += 0.25) {
        for (const height of [64, 66.5, 70, 74.5]) {
          const a = assessBodyFat(standards, 'male', height, { neck, abdomen });
          if (!a.fromTable || a.circumference === null) continue;
          checked += 1;
          expect(a.percent).toBe(lookupBodyFat(tables.male, a.circumference, height));
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
