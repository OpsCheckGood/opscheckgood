import { describe, it, expect } from 'vitest';
import {
  CURRENT_PROMOTIONS,
  PROMOTION_STANDARDS,
  btzPromotions,
  getGrade,
  normalizeStandards,
} from '@/lib/data/promotion';
import { DataFileError } from '@/lib/data/types';

/**
 * Structural checks on the promotion rules, and proof that the loader enforces
 * its invariants rather than trusting the file.
 *
 * Same stance as the abbreviation loader's re-sort test: an invariant nothing
 * exercises is a comment. Each case below feeds `normalizeStandards` a file
 * that is broken in one specific way and expects it to refuse.
 */

const dataset = CURRENT_PROMOTIONS;
const standards = dataset.data;

describe('standards load', () => {
  it('loads every edition without error', () => {
    expect(PROMOTION_STANDARDS.length).toBeGreaterThan(0);
    expect(standards.id).toBe('afi36-2502');
    expect(standards.component).toBe('Regular Air Force');
  });

  /**
   * Transcribed from AFI 36-2502, 2 July 2026, read directly from the
   * e-publishing PDF. Verified carries obligations -- a real source URL and no
   * placeholders -- which the repo-wide data-integrity tests enforce; this one
   * pins the edition so a silent swap to a different instruction goes red.
   */
  it('is verified against a named edition of the instruction', () => {
    expect(dataset.isStub).toBe(false);
    expect(dataset.meta.status).toBe('verified');
    expect(dataset.meta.source).toContain('36-2502');
    expect(dataset.meta.version).toBe('2 July 2026');
    expect(dataset.meta.sourceUrl).toMatch(/^https:\/\/.*afi36-2502\.pdf$/);
  });

  it('offers exactly one BTZ programme, on the SrA promotion', () => {
    const rules = btzPromotions(standards);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('sra');
    expect(rules[0]!.btz!.monthsEarly).toBe(6);
  });

  /**
   * Para 2.2.1, verbatim: "36 months time-in-service and 20 months
   * time-in-grade or 28 months time-in-grade whichever occurs first."
   */
  it('carries the SrA phase point exactly as para 2.2.1 states it', () => {
    const paths = btzPromotions(standards)[0]!.paths;
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ tisMonths: 36, tigMonths: 20 });
    expect(paths[1]).toMatchObject({ tisMonths: null, tigMonths: 28 });
  });

  /** Para 2.1.1: AB to Amn at six months TIG, Amn to A1C at ten. */
  it('carries the phase points on the way up to A1C', () => {
    const amn = standards.promotions.find((p) => p.id === 'amn')!;
    const a1c = standards.promotions.find((p) => p.id === 'a1c')!;
    expect(amn.paths[0]).toMatchObject({ tisMonths: null, tigMonths: 6 });
    expect(a1c.paths[0]).toMatchObject({ tisMonths: null, tigMonths: 10 });
    // Neither carries a BTZ programme; only the SrA promotion does.
    expect(amn.btz).toBeUndefined();
    expect(a1c.btz).toBeUndefined();
  });

  it('resolves every grade a promotion names', () => {
    for (const rule of standards.promotions) {
      expect(getGrade(standards, rule.fromGrade), rule.fromGrade).toBeDefined();
      expect(getGrade(standards, rule.toGrade), rule.toGrade).toBeDefined();
      // You are promoted upward.
      expect(getGrade(standards, rule.toGrade)!.order).toBeGreaterThan(
        getGrade(standards, rule.fromGrade)!.order,
      );
    }
  });

  it('gives every route at least one bound', () => {
    for (const rule of standards.promotions) {
      expect(rule.paths.length).toBeGreaterThan(0);
      for (const path of rule.paths) {
        expect(path.tisMonths !== null || path.tigMonths !== null, path.id).toBe(true);
      }
    }
  });
});

describe('the cycle calendar', () => {
  const cycles = btzPromotions(standards)[0]!.btz!.cycles;

  // The direct analogue of the PT age-bracket tiling test: every month belongs
  // to exactly one cycle, so a projected date always finds one board.
  it('tiles the calendar year exactly once', () => {
    const owners = new Map<number, string[]>();
    for (const cycle of cycles) {
      for (const month of cycle.promotionMonths) {
        owners.set(month, [...(owners.get(month) ?? []), cycle.id]);
      }
    }
    for (let month = 1; month <= 12; month++) {
      expect(owners.get(month), `month ${month}`).toHaveLength(1);
    }
  });

  it('derives the year offset from the board month', () => {
    for (const cycle of cycles) {
      const wraps = cycle.selectionMonth >= cycle.promotionMonths[0]!;
      expect(cycle.leadYearOffset).toBe(wraps ? -1 : 0);
    }
    // The Oct/Nov cycle is the one whose promotions run into the next year.
    expect(cycles.filter((c) => c.leadYearOffset === -1)).toHaveLength(1);
  });

  it('runs processing, then the board, then the promotions', () => {
    for (const cycle of cycles) {
      const lastProcessing = cycle.processingMonths[cycle.processingMonths.length - 1]!;
      expect(cycle.selectionMonth).toBe(lastProcessing + 1);
    }
  });
});

describe('standing notes', () => {
  it('cites the paragraph behind every note', () => {
    const notes = btzPromotions(standards)[0]!.btz!.notes;
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note, note).toMatch(/\((para|Table)[^)]*\)/);
    }
  });
});

describe('checks', () => {
  const checks = btzPromotions(standards)[0]!.btz!.checks;

  it('gives every check a message for each state it can reach', () => {
    for (const check of checks) {
      expect(check.pass, check.id).not.toBe('');
      expect(check.fail, check.id).not.toBe('');
      if (check.kind === 'attested') {
        expect(check.question, check.id).toBeTruthy();
        expect(typeof check.desired, check.id).toBe('boolean');
        // An attested check can sit unanswered, so it needs that wording too.
        expect(check.unanswered, check.id).toBeTruthy();
      } else {
        expect(['grade', 'window']).toContain(check.check);
      }
    }
  });

  it('asks about every category the instruction rules out', () => {
    const ids = checks.map((c) => c.id);
    for (const id of [
      'skill-level',            // Table 2.1, paras 2.2.1 / 2.3.1
      'previous-consideration', // paras 2.3.1 / 2.3.4, grade status reason 5Q
      'adjusted-dor',           // paras 2.3.4.4.2 / 4.1.8.3
      'rotc-usafa',             // para 2.3.4.4.2
      'tdsp',                   // para 4.1.7
      'six-year',               // para 2.1.2
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  /**
   * The instruction says "will not be eligible" of these, flatly. Reading any
   * of them as a soft advisory would put a supervisor to work on a package that
   * cannot be submitted, which is the opposite of what this tool is for.
   */
  it('treats the flat ineligibility categories as requirements, not advisories', () => {
    for (const id of ['adjusted-dor', 'rotc-usafa', 'tdsp', 'previous-consideration']) {
      expect(checks.find((c) => c.id === id)!.mode, id).toBe('require');
    }
    // The six-year enlistment moves the date of rank; it does not disqualify.
    expect(checks.find((c) => c.id === 'six-year')!.mode).toBe('advise');
  });

  it('cites the paragraph behind every check', () => {
    for (const check of checks) {
      expect(check.authority, check.id).toBeTruthy();
      expect(check.authority, check.id).toMatch(/para|Table/);
    }
  });
});

// ---------------------------------------------------------------------------
// The loader refuses broken files
// ---------------------------------------------------------------------------

/** A minimal file that loads cleanly, for one field at a time to be broken. */
function goodFile() {
  return {
    id: 'test',
    label: 'Test',
    component: 'Regular Air Force',
    grades: [
      { id: 'a1c', abbr: 'A1C', label: 'Airman First Class', order: 3 },
      { id: 'sra', abbr: 'SrA', label: 'Senior Airman', order: 4 },
    ],
    promotions: [
      {
        id: 'sra',
        label: 'Senior Airman',
        fromGrade: 'a1c',
        toGrade: 'sra',
        paths: [
          {
            id: 'tig',
            label: '28 months TIG',
            // Widened so a case below can swap either bound for the other kind.
            tisMonths: null as number | null,
            tigMonths: 28 as number | null,
          },
        ],
        btz: {
          label: 'Below-the-Zone',
          monthsEarly: 6,
          cycles: [
            { id: 'q1', processingMonths: [1, 2], selectionMonth: 3, promotionMonths: [4, 5, 6] },
            { id: 'q2', processingMonths: [4, 5], selectionMonth: 6, promotionMonths: [7, 8, 9] },
            { id: 'q3', processingMonths: [7, 8], selectionMonth: 9, promotionMonths: [10, 11, 12] },
            { id: 'q4', processingMonths: [10, 11], selectionMonth: 12, promotionMonths: [1, 2, 3] },
          ],
          checks: [
            { id: 'grade', kind: 'computed', check: 'grade', mode: 'require', label: 'Grade', pass: 'y', fail: 'n' },
          ],
          notes: [],
        },
      },
    ],
  };
}

/** Applies one mutation to an otherwise valid file. */
function broken(mutate: (file: ReturnType<typeof goodFile>) => void) {
  const file = goodFile();
  mutate(file);
  return () => normalizeStandards(file, {}, 'test.json');
}

describe('the loader enforces its invariants', () => {
  it('accepts the baseline file', () => {
    expect(() => normalizeStandards(goodFile(), {}, 'test.json')).not.toThrow();
  });

  it('refuses a calendar with a month no cycle promotes in', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.cycles[3]!.promotionMonths = [1, 2];
    })).toThrow(/no cycle promotes in month 3/);
  });

  it('refuses a month two cycles both claim', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.cycles[0]!.promotionMonths = [1, 2, 3];
    })).toThrow(/promotion month for both/);
  });

  it('refuses a promotion quarter with a gap in it', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.cycles[0]!.promotionMonths = [4, 6];
    })).toThrow(/must be consecutive/);
  });

  it('refuses a board that does not follow its processing window', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.cycles[0]!.selectionMonth = 8;
    })).toThrow(/board month must follow/);
  });

  it('refuses a route that bounds nothing', () => {
    expect(broken((f) => {
      f.promotions[0]!.paths[0]!.tigMonths = null;
    })).toThrow(/must set tisMonths, tigMonths, or both/);
  });

  it('refuses a negative or fractional month count', () => {
    expect(broken((f) => {
      f.promotions[0]!.paths[0]!.tigMonths = -28;
    })).toThrow(/positive whole number of months/);
    expect(broken((f) => {
      f.promotions[0]!.paths[0]!.tigMonths = 28.5;
    })).toThrow(/positive whole number of months/);
  });

  it('refuses a BTZ advance of zero', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.monthsEarly = 0;
    })).toThrow(/monthsEarly must be a positive/);
  });

  it('refuses grades listed out of seniority order', () => {
    expect(broken((f) => {
      f.grades = [f.grades[1]!, f.grades[0]!];
    })).toThrow(/ascending order/);
  });

  it('refuses two grades sharing an id', () => {
    expect(broken((f) => {
      f.grades[1]!.id = 'a1c';
    })).toThrow(/duplicate id/);
  });

  it('refuses a promotion naming a grade that does not exist', () => {
    expect(broken((f) => {
      f.promotions[0]!.fromGrade = 'ssgt';
    })).toThrow(/names unknown grade/);
  });

  /**
   * The important one. A computed check names a predicate the engine
   * implements; anything else would render a check that silently never passes,
   * which reads on screen as a real failed requirement.
   */
  it('refuses a computed check the engine has no predicate for', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.checks[0]!.check = 'has-a-pulse';
    })).toThrow(/must be one the engine implements/);
  });

  it('refuses an attested check with no question or no desired answer', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.checks[0] = {
        id: 'x', kind: 'attested', mode: 'require', label: 'X', pass: 'y', fail: 'n',
      } as never;
    })).toThrow(/must carry a question/);
  });

  it('refuses two checks sharing an id', () => {
    expect(broken((f) => {
      f.promotions[0]!.btz.checks.push({ ...f.promotions[0]!.btz.checks[0]! });
    })).toThrow(/duplicate id/);
  });

  it('names the file in every failure', () => {
    try {
      broken((f) => {
        f.promotions[0]!.btz.monthsEarly = 0;
      })();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DataFileError);
      expect((error as DataFileError).message).toContain('test.json');
    }
  });
});
