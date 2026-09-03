import { describe, it, expect } from 'vitest';
import { CURRENT_STANDARDS } from '@/lib/data/pt';
import { formatTime } from '@/lib/pt/score';
import charts from './fixtures/pfra-scoring-charts.json';

/**
 * The scoring tables, against the official charts.
 *
 * `tests/fixtures/pfra-scoring-charts.json` is the USAF PFRA Scoring Charts
 * read out of the published PDF by script -- the chart itself, not our copy of
 * it. Every cell of every table is compared here, so a typo in the data file,
 * or a well-meant "correction" to a number that looks wrong, fails the build.
 *
 * This is what constraint 5 asks for: the numbers are not defended by reading
 * them, they are defended by comparison against the source.
 */

const standards = CURRENT_STANDARDS.data;

/** Row index into a table equals index into its component's point ladder. */
function ladderFor(key: string): number[] {
  const cardio = key === 'RUN' || key === 'HAMR';
  return standards.pointLadders[cardio ? 'cardio' : 'strength']!;
}

const TABLES = Object.keys(charts.tables) as Array<keyof typeof charts.tables>;

describe('scoring tables match the published charts', () => {
  it('covers every table the standards define', () => {
    expect(TABLES.sort()).toEqual(Object.keys(standards.tables).sort());
  });

  for (const key of TABLES) {
    const chart = charts.tables[key];

    it(`${key}: every age group and sex`, () => {
      const table = standards.tables[key]!;
      const ladder = ladderFor(key);

      // The chart prints its own points column; ours is the ladder. They have
      // to agree row for row or the rows are not the rows we think they are.
      expect(chart.points).toEqual(ladder);
      expect(table.rows).toHaveLength(chart.rows.length);

      for (let row = 0; row < chart.rows.length; row += 1) {
        const want = chart.rows[row]!;
        const got = table.rows[row]!;
        expect(got).toHaveLength(18);
        // Compared as a whole row so a failure names the row, not one cell.
        expect({ points: ladder[row], row: got }).toEqual({
          points: chart.points[row],
          row: want,
        });
      }
    });

    it(`${key}: the AFSPECWAR/EOD neutral column`, () => {
      const neutral = charts.neutral[key];
      expect(neutral.points).toEqual(ladderFor(key));
      expect(standards.tables[key]!.neutral).toEqual(neutral.values);
    });
  }

  it('the waist-to-height ladder', () => {
    const body = standards.components.find((c) => c.kind === 'ratio')!;
    const rows = body.ladderRows!;
    expect(rows).toHaveLength(charts.ratioLadder.length);
    charts.ratioLadder.forEach((want, i) => {
      expect({ points: rows[i]!.points, label: rows[i]!.label }).toEqual({
        points: want.points,
        label: want.label,
      });
    });
  });

  it('keeps the component minimum on the row the chart stars', () => {
    // The chart marks the last row of each table with an asterisk: the
    // component minimum, which the engine reads as the final row.
    for (const key of TABLES) {
      const chart = charts.tables[key];
      const last = chart.rows.length - 1;
      expect(standards.tables[key]!.rows[last]).toEqual(chart.rows[last]);
    }
  });

  it('orders time tables the right way round', () => {
    // The run is scored fastest-first, the plank longest-first. Getting this
    // backwards would still "work" and would score everybody wrongly.
    const run = standards.tables.RUN!.rows;
    expect(run[0]![0]).toBeLessThan(run[run.length - 1]![0]);
    expect(formatTime(run[0]![0]!)).toBe('13:25');

    const plank = standards.tables.PLANK!.rows;
    expect(plank[0]![0]).toBeGreaterThan(plank[plank.length - 1]![0]);
    expect(formatTime(plank[0]![0]!)).toBe('3:40');
  });
});
