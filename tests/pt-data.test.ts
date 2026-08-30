import { describe, it, expect } from 'vitest';
import { PT_STANDARDS, CURRENT_STANDARDS, getComponent, getEvent } from '@/lib/data/pt';
import { bracketIndex, columnFor, standardsColumn } from '@/lib/pt/score';

/**
 * Structural checks on the scoring standards.
 *
 * The phase-2 note in CLAUDE.md asks specifically for two of these: age
 * brackets with no gaps or overlaps, and monotonic scores. Both are the kind
 * of error that produces a plausible wrong answer rather than a crash, which
 * is the failure mode this project cannot have.
 */

const standards = CURRENT_STANDARDS.data;

describe('standards load', () => {
  it('loads every edition without error', () => {
    expect(PT_STANDARDS.length).toBeGreaterThan(0);
    expect(standards.id).toBe('afman36-2905');
  });

  // Transcribed from the maintainer's PDF rather than from the AFMAN itself,
  // so the banner stays up until someone checks it against the real source.
  it('is still marked unverified', () => {
    expect(CURRENT_STANDARDS.isStub).toBe(true);
    expect(CURRENT_STANDARDS.meta.source).toContain('36-2905');
  });

  it('offers a standard and a neutral track', () => {
    expect(standards.tracks.some((t) => !t.neutral)).toBe(true);
    expect(standards.tracks.some((t) => t.neutral)).toBe(true);
  });
});

describe('age brackets', () => {
  it('tile the whole scoring range with no gaps and no overlaps', () => {
    for (const groups of [
      standards.ageGroups,
      ...Object.values(standards.limitTables).map((t) => t.ageGroups),
    ]) {
      const hits = new Map<number, number[]>();
      for (let age = standards.ageRange.min; age <= standards.ageRange.max; age++) {
        const matching = groups
          .map((g, i) => [g, i] as const)
          .filter(([g], i) => (g.maxAge === null ? true : age <= g.maxAge) && i >= 0)
          .map(([, i]) => i);
        // Exactly one bracket is the *first* match, and that is the one used.
        hits.set(age, matching);
        expect(matching.length, `age ${age} matches no bracket`).toBeGreaterThan(0);
        expect(bracketIndex(groups, age)).toBe(matching[0]);
      }
      // Every bracket has to be reachable, or it is dead data.
      const used = new Set(
        [...hits.keys()].map((age) => bracketIndex(groups, age)),
      );
      expect(used.size).toBe(groups.length);
    }
  });

  it('puts each age in the bracket its label names', () => {
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 24)]!.label).toBe('Under 25');
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 25)]!.label).toBe('25-29');
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 39)]!.label).toBe('35-39');
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 40)]!.label).toBe('40-44');
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 60)]!.label).toBe('60 and Over');
    expect(standards.ageGroups[bracketIndex(standards.ageGroups, 90)]!.label).toBe('60 and Over');
  });
});

/** Every column of a table, the neutral one last. */
function allColumns(key: string): number[][] {
  const columns: number[][] = [];
  const count = standards.ageGroups.length * standards.sexes.length;
  for (let col = 0; col < count; col++) columns.push(standardsColumn(standards, key, col));
  columns.push(standardsColumn(standards, key, null));
  return columns;
}

describe('scoring tables', () => {
  const tableKeys = Object.keys(standards.tables);

  it('covers every event that names a table', () => {
    for (const component of standards.components) {
      for (const event of component.events) {
        if (event.kind === 'table') expect(tableKeys).toContain(event.table);
      }
    }
  });

  it.each(tableKeys)('%s has one cell per age group and sex on every row', (key) => {
    const table = standards.tables[key]!;
    const expected = standards.ageGroups.length * standards.sexes.length;
    for (const row of table.rows) expect(row.length).toBe(expected);
    expect(table.neutral.length).toBe(table.rows.length);
  });

  // A table row maps one-for-one onto a point-ladder entry. If the two ever
  // drift, every score past the shorter of them is silently wrong.
  it.each(
    standards.components
      .filter((c) => c.kind === 'table')
      .flatMap((c) => c.events.filter((e) => e.kind === 'table').map((e) => [c.id, e.id, c, e] as const)),
  )('%s/%s has as many table rows as ladder entries', (_c, _e, component, event) => {
    const table = standards.tables[event.table!]!;
    const ladder = standards.pointLadders[component.ladder!]!;
    expect(table.rows.length).toBe(ladder.length);
  });

  /**
   * Monotonic in performance: reading down a column, thresholds never get
   * harder as the points go down. For a "lower is better" event like the run,
   * easier means a larger number, so the direction flips.
   *
   * Non-strict, because the data has one genuine flat spot -- pinned below.
   */
  it.each(
    standards.components
      .filter((c) => c.kind === 'table')
      .flatMap((c) => c.events.filter((e) => e.kind === 'table').map((e) => [c.id, e.id, c, e] as const)),
  )('%s/%s never reverses direction in any column', (_c, _e, component, event) => {
    for (const [index, values] of allColumns(event.table!).entries()) {
      for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1]!;
        const here = values[i]!;
        const where = `column ${index} row ${i} of ${event.id}`;
        if (event.better === 'lower') expect(here, where).toBeGreaterThanOrEqual(prev);
        else expect(here, where).toBeLessThanOrEqual(prev);
      }
    }
  });

  /**
   * Where two adjacent rows share a threshold, the lower-scoring one can never
   * be reached: the row search takes the first row you meet, so it awards the
   * higher points. That is not wrong, but it is a scoring row that does not
   * exist in practice, and it is much more likely to be a transcription slip
   * in the source than a deliberate standard.
   *
   * This pins the exact set. A new plateau, or this one disappearing, is a
   * question for the maintainer rather than something to quietly absorb.
   */
  it('has exactly one unreachable row, in male 30-34 push-ups', () => {
    const plateaus: string[] = [];
    for (const key of Object.keys(standards.tables)) {
      for (const [index, values] of allColumns(key).entries()) {
        for (let i = 1; i < values.length; i++) {
          if (values[i] === values[i - 1]) {
            plateaus.push(`${key} column ${index} rows ${i - 1}/${i} both ${values[i]}`);
          }
        }
      }
    }
    // Column 4 is age group index 2 (30-34), sex index 0 (male).
    expect(plateaus).toEqual(['PUSHUP column 4 rows 24/25 both 26']);
  });

  it.each(Object.keys(standards.pointLadders))(
    'the %s point ladder descends strictly',
    (key) => {
      const ladder = standards.pointLadders[key]!;
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]!).toBeLessThan(ladder[i - 1]!);
      }
      expect(ladder[0]!).toBeGreaterThan(0);
    },
  );
});

describe('components', () => {
  it('sum to 100 points when nothing is exempt', () => {
    const total = standards.components.reduce((sum, c) => sum + c.maxPoints, 0);
    expect(total).toBe(100);
  });

  it('offers the events the AFMAN allows, as data rather than code branches', () => {
    expect(getComponent(standards, 'strength')!.events.map((e) => e.id)).toEqual([
      'pushup',
      'hrpu',
    ]);
    expect(getComponent(standards, 'core')!.events.map((e) => e.id)).toEqual([
      'situp',
      'crunch',
      'plank',
    ]);
    expect(getComponent(standards, 'cardio')!.events.map((e) => e.id)).toEqual([
      'run',
      'hamr',
      'walk',
    ]);
  });

  it('marks only the walk as blocking an Excellent', () => {
    const blocking = standards.components.flatMap((c) =>
      c.events.filter((e) => e.excludesExcellent).map((e) => e.id),
    );
    expect(blocking).toEqual(['walk']);
  });

  it('gives body composition a ladder ending in an open-ended row', () => {
    const body = getComponent(standards, 'body')!;
    expect(body.hasMinimum).toBe(false);
    expect(body.ladderRows!.length).toBeGreaterThan(0);
    expect(body.ladderRows!.at(-1)!.ratioMax).toBeNull();
    expect(body.ladderRows!.at(-1)!.points).toBe(0);
    expect(body.ladderRows![0]!.points).toBe(body.maxPoints);
    for (let i = 1; i < body.ladderRows!.length; i++) {
      expect(body.ladderRows![i]!.points).toBeLessThan(body.ladderRows![i - 1]!.points);
    }
  });

  it('gives the walk a maximum for every age bracket and sex', () => {
    const walk = getEvent(getComponent(standards, 'cardio')!, 'walk')!;
    const limits = standards.limitTables[walk.limits!]!;
    for (const sex of ['male', 'female'] as const) {
      expect(limits.bySex[sex].length).toBe(limits.ageGroups.length);
      for (const seconds of limits.bySex[sex]) expect(seconds).toBeGreaterThan(0);
    }
  });
});

describe('column layout', () => {
  it('reads a distinct column per age group and sex', () => {
    const seen = new Set<number>();
    for (const group of standards.ageGroups) {
      const age = group.maxAge ?? standards.ageRange.max;
      for (const sex of ['male', 'female'] as const) {
        seen.add(columnFor(standards, age, sex));
      }
    }
    expect(seen.size).toBe(standards.ageGroups.length * standards.sexes.length);
  });

  /**
   * The neutral column is its own data, read only by the neutral track.
   *
   * In this edition it happens to equal the male under-25 column for every
   * event except the run, where AFSPECWAR/EOD is held to a harder standard.
   * That coincidence is asserted rather than glossed over, so that a future
   * edition changing it shows up here as a failure to look at rather than as
   * a quietly different score.
   */
  it('holds a neutral column the same length as the age-and-sex grid', () => {
    for (const key of Object.keys(standards.tables)) {
      expect(standardsColumn(standards, key, null).length).toBe(
        standardsColumn(standards, key, 0).length,
      );
    }
  });

  it('matches male under-25 on every event except the run', () => {
    for (const key of Object.keys(standards.tables)) {
      const neutral = standardsColumn(standards, key, null);
      const maleUnder25 = standardsColumn(standards, key, 0);
      if (key === 'RUN') expect(neutral).not.toEqual(maleUnder25);
      else expect(neutral).toEqual(maleUnder25);
    }
  });
});
