import { describe, it, expect } from 'vitest';
import { CURRENT_PROMOTIONS, btzPromotions } from '@/lib/data/promotion';
import { project, summarize, type BtzInput } from '@/lib/promotion/btz';
import { formatDate, type CivilDate } from '@/lib/promotion/dates';

/**
 * The projection engine.
 *
 * The anchor is the maintainer's own worked example, spelled out end to end:
 * entered active duty 15 AUG 2025, A1C date of rank 15 JUN 2026, giving a BTZ
 * promotion of 15 FEB 2028 against a fully qualified date of 15 AUG 2028, in
 * the cycle processed Oct/Nov 2027 and boarded Dec 2027. If any part of this
 * file goes red, the tool is telling somebody the wrong date about their
 * career.
 */

const standards = CURRENT_PROMOTIONS.data;
const rule = btzPromotions(standards)[0]!;

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const TODAY = d(2026, 8, 30);

function input(over: Partial<BtzInput> = {}): BtzInput {
  return {
    enteredActiveDuty: d(2025, 8, 15),
    gradeId: 'a1c',
    dateOfRank: d(2026, 6, 15),
    answers: {},
    today: TODAY,
    ...over,
  };
}

describe('the worked example', () => {
  const result = project(standards, rule, input());

  it('projects the BTZ promotion six months below the fully qualified date', () => {
    expect(result.status).toBe('projected');
    expect(formatDate(result.fullyQualifiedDate!)).toBe('15 AUG 2028');
    expect(formatDate(result.btzDate!)).toBe('15 FEB 2028');
    expect(result.monthsEarly).toBe(6);
  });

  it('puts it in the cycle processed Oct/Nov and boarded in December', () => {
    expect(result.cycle).not.toBeNull();
    expect(result.cycle!.processing).toEqual({ year: 2027, months: [10, 11] });
    expect(result.cycle!.selection).toEqual({ year: 2027, month: 12 });
    // The promotions themselves land in the following calendar year.
    expect(result.cycle!.window).toEqual({ year: 2028, months: [1, 2, 3] });
  });

  it('shows which route binds, and why', () => {
    const byId = new Map(result.paths.map((p) => [p.path.id, p]));

    // 36 months TIS from 15 AUG 2025, 20 months TIG from 15 JUN 2026: the time
    // in service half is the later one, so it is what sets the date.
    const tisTig = byId.get('tis-tig')!;
    expect(formatDate(tisTig.tisDate!)).toBe('15 AUG 2028');
    expect(formatDate(tisTig.tigDate!)).toBe('15 FEB 2028');
    expect(formatDate(tisTig.date!)).toBe('15 AUG 2028');
    expect(tisTig.binds).toBe('tis');
    expect(tisTig.governing).toBe(true);

    // 28 months TIG lands two months later, so it does not govern here.
    const tig = byId.get('tig')!;
    expect(tig.tisDate).toBeNull();
    expect(formatDate(tig.date!)).toBe('15 OCT 2028');
    expect(tig.governing).toBe(false);
  });

  it('lays the timeline out in order, with today on it', () => {
    expect(result.timeline.map((m) => m.id)).toEqual([
      'today',
      'processing',
      'selection',
      'window',
      'btz',
      'fully-qualified',
    ]);
    expect(result.timeline.find((m) => m.id === 'processing')!.display).toBe('OCT – NOV 2027');
    expect(result.timeline.find((m) => m.id === 'selection')!.display).toBe('DEC 2027');
    expect(result.timeline.find((m) => m.id === 'window')!.display).toBe('JAN – MAR 2028');
    expect(result.timeline.find((m) => m.id === 'btz')!.display).toBe('15 FEB 2028');
    expect(result.timeline.every((m) => !m.past)).toBe(true);
  });

  // The host wing sets its own nomination timeline and board procedures, so
  // anything derived from the cycle has to say so.
  it('marks the cycle-derived milestones as locally variable', () => {
    const local = result.timeline.filter((m) => m.local).map((m) => m.id);
    expect(local).toEqual(['processing', 'selection']);
  });
});

describe('the other route can govern', () => {
  /**
   * Someone who arrives at A1C on the day they enter active duty -- an advanced
   * enlistment -- hits 28 months TIG before 36 months TIS, so the second route
   * is the one that binds. This is exactly the case a calculator built on
   * "date joined plus 36 months" gets wrong.
   */
  it('takes 28 months TIG when it comes first', () => {
    const result = project(
      standards,
      rule,
      input({ enteredActiveDuty: d(2025, 8, 15), dateOfRank: d(2025, 8, 15) }),
    );
    expect(formatDate(result.fullyQualifiedDate!)).toBe('15 DEC 2027');
    expect(formatDate(result.btzDate!)).toBe('15 JUN 2027');
    expect(result.paths.find((p) => p.path.id === 'tig')!.governing).toBe(true);
    expect(result.paths.find((p) => p.path.id === 'tis-tig')!.governing).toBe(false);
  });

  it('never lands later than either route on its own', () => {
    // A sweep, because the whole rule is "earliest of", and an off-by-one in
    // the comparison would still look reasonable on any single case.
    for (let offset = 0; offset <= 36; offset++) {
      const dor = { year: 2025 + Math.floor(offset / 12), month: (offset % 12) + 1, day: 15 };
      const result = project(standards, rule, input({ dateOfRank: dor }));
      const dates = result.paths.map((p) => p.date!.year * 400 + p.date!.month * 31 + p.date!.day);
      const chosen =
        result.fullyQualifiedDate!.year * 400 +
        result.fullyQualifiedDate!.month * 31 +
        result.fullyQualifiedDate!.day;
      expect(chosen).toBe(Math.min(...dates));
    }
  });
});

describe('the month-end case', () => {
  /**
   * A date of rank of 31 AUG resolves 20 months on to 30 APR, and the BTZ date
   * six months below a 31 AUG fully qualified date is 29 FEB in a leap year.
   * Both are the clamp doing its job rather than rolling into the next month.
   */
  it('clamps rather than rolling over', () => {
    const result = project(
      standards,
      rule,
      input({ enteredActiveDuty: d(2025, 8, 31), dateOfRank: d(2026, 6, 30) }),
    );
    expect(formatDate(result.fullyQualifiedDate!)).toBe('31 AUG 2028');
    expect(formatDate(result.btzDate!)).toBe('29 FEB 2028');
  });
});

describe('determinism', () => {
  it('gives the same answer every run', () => {
    const once = summarize(project(standards, rule, input()), standards);
    for (let i = 0; i < 5; i++) {
      expect(summarize(project(standards, rule, input()), standards)).toBe(once);
    }
  });

  it('depends on the day it is run only through "today"', () => {
    const a = project(standards, rule, input({ today: d(2026, 1, 1) }));
    const b = project(standards, rule, input({ today: d(2027, 6, 6) }));
    expect(formatDate(a.btzDate!)).toBe(formatDate(b.btzDate!));
    expect(formatDate(a.fullyQualifiedDate!)).toBe(formatDate(b.fullyQualifiedDate!));
  });
});

describe('what it refuses to do', () => {
  it('will not project from a grade below the one BTZ is considered from', () => {
    for (const gradeId of ['ab', 'amn']) {
      const result = project(standards, rule, input({ gradeId }));
      expect(result.status).toBe('awaiting-grade');
      expect(result.btzDate).toBeNull();
      expect(result.fullyQualifiedDate).toBeNull();
      expect(result.timeline).toEqual([]);
      // And it says what it needs rather than going quiet.
      expect(result.notes.join(' ')).toContain('A1C');
      // Para 2.1.1's phase points are offered as context, never as a date.
      expect(result.notes.join(' ')).toContain('Phase point to A1C');
    }
  });

  it('says so when the member is already past the grade', () => {
    const result = project(standards, rule, input({ gradeId: 'sra' }));
    expect(result.status).toBe('not-applicable');
    expect(result.btzDate).toBeNull();
    expect(result.notes.join(' ')).toContain('Already SrA');
  });

  it('names exactly what is missing', () => {
    expect(project(standards, rule, input({ enteredActiveDuty: null })).missing).toEqual([
      'Date entered active duty',
    ]);
    expect(project(standards, rule, input({ dateOfRank: null })).missing).toEqual([
      'A1C date of rank',
    ]);
    const empty = project(
      standards,
      rule,
      input({ enteredActiveDuty: null, dateOfRank: null }),
    );
    expect(empty.status).toBe('incomplete');
    expect(empty.missing).toHaveLength(2);
  });

  /**
   * The 28-month route needs only a date of rank, so it resolves on its own.
   * The promotion date must still be withheld: the unresolved route could land
   * earlier, and printing the one date available would overstate it.
   */
  it('withholds a date while any route is unresolved', () => {
    const result = project(standards, rule, input({ enteredActiveDuty: null }));
    expect(result.paths.find((p) => p.path.id === 'tig')!.date).not.toBeNull();
    expect(result.fullyQualifiedDate).toBeNull();
    expect(result.btzDate).toBeNull();
  });

  it('never claims anyone is eligible', () => {
    const text = summarize(project(standards, rule, input()), standards).toLowerCase();
    expect(text).not.toContain('you are eligible');
    expect(text).not.toMatch(/\bis eligible\b/);
    expect(text).toContain('if selected');
    expect(text).toContain('not an eligibility determination');
  });
});

describe('checks', () => {
  it('leaves attested questions unanswered rather than assuming a pass', () => {
    const result = project(standards, rule, input());
    const attested = result.checks.filter((c) => c.check.kind === 'attested');
    expect(attested.length).toBeGreaterThan(0);
    expect(attested.every((c) => c.state === 'unanswered')).toBe(true);
    // Unanswered must not block: quick mode asks none of them.
    expect(result.status).toBe('projected');
  });

  it('passes the computed checks when the grade and the dates are there', () => {
    const computed = project(standards, rule, input()).checks.filter(
      (c) => c.check.kind === 'computed',
    );
    expect(computed.map((c) => c.state)).toEqual(['pass', 'pass']);
  });

  /**
   * Para 2.3.1 defines BTZ as six months prior to the phase point itself, not
   * as a separate pair of reduced month counts. Secondary sources paraphrase it
   * as "30 months TIS / 14 months TIG", which agrees in the ordinary case and
   * diverges at month ends -- so the rule is implemented as written.
   */
  it('takes six months off the phase point rather than off each bound', () => {
    // 31 AUG entry, 30 JUN date of rank. Off the resolved phase point:
    // max(31 AUG +36, 30 JUN +20) = 31 AUG, less six months = 29 FEB.
    // Off each bound instead: max(31 AUG +30, 30 JUN +14) would give 30 AUG.
    const result = project(
      standards,
      rule,
      input({ enteredActiveDuty: d(2025, 8, 31), dateOfRank: d(2026, 6, 30) }),
    );
    expect(formatDate(result.fullyQualifiedDate!)).toBe('31 AUG 2028');
    expect(formatDate(result.btzDate!)).toBe('29 FEB 2028');
  });

  it('fails the grade check off-grade and the window check with no dates', () => {
    const offGrade = project(standards, rule, input({ gradeId: 'sra' }));
    expect(offGrade.checks.find((c) => c.check.id === 'grade')!.state).toBe('fail');

    const noDates = project(standards, rule, input({ enteredActiveDuty: null, dateOfRank: null }));
    expect(noDates.checks.find((c) => c.check.id === 'window')!.state).toBe('fail');
  });

  it('blocks on a failed requirement but still shows the dates', () => {
    const result = project(
      standards,
      rule,
      input({ answers: { 'previous-consideration': true } }),
    );
    expect(result.status).toBe('blocked');
    expect(result.checks.find((c) => c.check.id === 'previous-consideration')!.state).toBe('fail');
    // The arithmetic is still correct and still shown; what changed is the verdict.
    expect(formatDate(result.btzDate!)).toBe('15 FEB 2028');
  });

  it('flags the six-year enlistment as an advisory without blocking', () => {
    const result = project(standards, rule, input({ answers: { 'six-year': true } }));
    expect(result.status).toBe('projected');
    const check = result.checks.find((c) => c.check.id === 'six-year')!;
    expect(check.state).toBe('fail');
    expect(check.check.mode).toBe('advise');
  });

  /**
   * Para 2.3.4.4.2 and para 4.1.8.3 both say "will not be eligible for SrA
   * below-the-zone" of these, without qualification. Each has to stop the
   * projection, not merely annotate it.
   */
  it.each(['adjusted-dor', 'rotc-usafa', 'tdsp'])(
    'blocks on %s, which the instruction rules out flatly',
    (id) => {
      const result = project(standards, rule, input({ answers: { [id]: true } }));
      expect(result.status).toBe('blocked');
      expect(result.checks.find((c) => c.check.id === id)!.state).toBe('fail');
    },
  );

  it('passes an attested check answered the desired way', () => {
    const result = project(
      standards,
      rule,
      input({ answers: { 'skill-level': true, 'previous-consideration': false } }),
    );
    expect(result.checks.find((c) => c.check.id === 'skill-level')!.state).toBe('pass');
    expect(result.status).toBe('projected');
  });

  it('blocks when the skill level requirement is answered no', () => {
    const result = project(standards, rule, input({ answers: { 'skill-level': false } }));
    expect(result.status).toBe('blocked');
  });
});

describe('advisories', () => {
  it('flags a date of rank earlier than entry to active duty', () => {
    const result = project(standards, rule, input({ dateOfRank: d(2024, 1, 1) }));
    expect(result.notes.join(' ')).toContain('earlier than the date entered active duty');
  });

  it('says plainly when the projection is already in the past', () => {
    const result = project(standards, rule, input({ today: d(2030, 1, 1) }));
    expect(result.notes.join(' ')).toContain('has passed');
    expect(result.timeline.filter((m) => m.past).length).toBeGreaterThan(0);
  });

  it('always carries the standing notes from the instruction', () => {
    const notes = project(standards, rule, input()).notes.join(' ');
    // The three a supervisor most needs before building a package: it happens
    // once, TDY and leave are not excuses to skip someone, and the local
    // timeline is the wing's to set.
    expect(notes).toContain('one-time promotion consideration');
    expect(notes).toContain('TDY, on leave');
    expect(notes).toContain('host wing or installation commander');
    // And each is traceable back to its paragraph.
    expect(notes).toContain('para 2.3.1');
    expect(notes).toContain('para 2.4.1');
  });
});

describe('every BTZ date lands in exactly one cycle', () => {
  /**
   * Sweeps three years of dates of rank. A month claimed by no cycle, or by
   * two, would put a real Airman's board in the wrong quarter -- and the loader
   * enforces the tiling precisely so this can never come back null.
   */
  it('resolves a cycle for every month of the year', () => {
    const seen = new Set<number>();
    for (let offset = 0; offset < 36; offset++) {
      const dor = { year: 2026 + Math.floor(offset / 12), month: (offset % 12) + 1, day: 15 };
      const result = project(standards, rule, input({ dateOfRank: dor }));
      expect(result.cycle, `no cycle for ${formatDate(result.btzDate!)}`).not.toBeNull();
      expect(result.cycle!.window.months).toContain(result.btzDate!.month);
      seen.add(result.btzDate!.month);
    }
    expect(seen.size).toBe(12);
  });

  it('puts processing and the board ahead of the promotion, always', () => {
    for (let offset = 0; offset < 24; offset++) {
      const dor = { year: 2026 + Math.floor(offset / 12), month: (offset % 12) + 1, day: 15 };
      const { cycle, btzDate } = project(standards, rule, input({ dateOfRank: dor }));
      const asMonths = (year: number, month: number) => year * 12 + month;
      const promotion = asMonths(btzDate!.year, btzDate!.month);
      expect(asMonths(cycle!.selection.year, cycle!.selection.month)).toBeLessThan(promotion + 1);
      expect(asMonths(cycle!.processing.year, cycle!.processing.months[0]!)).toBeLessThan(
        asMonths(cycle!.selection.year, cycle!.selection.month),
      );
    }
  });
});
