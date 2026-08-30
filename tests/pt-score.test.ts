import { describe, it, expect } from 'vitest';
import { CURRENT_STANDARDS } from '@/lib/data/pt';
import {
  averageWaist,
  chartFor,
  combineTime,
  floorHalf,
  formatTime,
  parseTime,
  score,
  waistToHeightRatio,
  walkMaxSeconds,
  type ComponentEntry,
  type PtInput,
} from '@/lib/pt/score';
import { runReference } from './fixtures/pdf-calculator.js';

const standards = CURRENT_STANDARDS.data;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe('units', () => {
  it('formats and parses times symmetrically', () => {
    expect(formatTime(690)).toBe('11:30');
    expect(formatTime(59)).toBe('0:59');
    expect(parseTime('11:30')).toBe(690);
    expect(parseTime('690')).toBe(690);
    expect(parseTime('')).toBeNull();
    expect(combineTime('11', '30')).toBe(690);
    expect(combineTime('', '')).toBeNull();
    // A blank half is zero, not a refusal: "9:" while still typing is 9:00.
    expect(combineTime('9', '')).toBe(540);
  });

  it('floors the waist to the half inch rather than rounding', () => {
    expect(floorHalf(34.4)).toBe(34);
    expect(floorHalf(34.5)).toBe(34.5);
    expect(floorHalf(34.9)).toBe(34.5);
    expect(floorHalf(35)).toBe(35);
  });

  it('truncates the waist-to-height ratio rather than rounding it up', () => {
    // 0.5999 must score on the 0.59 row, not be rounded onto the 0.60 row.
    expect(waistToHeightRatio(41.5, 69.25)).toBeCloseTo(0.59, 10);
    expect(waistToHeightRatio(35, 70)).toBeCloseTo(0.5, 10);
  });

  it('averages three waists and flags a spread over an inch', () => {
    expect(averageWaist([34, 34, 34]).waist).toBe(34);
    expect(averageWaist([34, 34.5, 35]).waist).toBe(34.5);
    expect(averageWaist([]).waist).toBeNull();
    expect(averageWaist([34, 36, 34]).notes.join(' ')).toContain('more than 1 in');
    expect(averageWaist([34, 34]).notes.join(' ')).toContain('three waist measurements');
  });
});

// ---------------------------------------------------------------------------
// Building inputs
// ---------------------------------------------------------------------------

function entry(eventId: string, value: number | null): ComponentEntry {
  return { eventId, exempt: false, value };
}

function body(heightIn: number | null, waist: number | null): ComponentEntry {
  return {
    eventId: 'whtr',
    exempt: false,
    value: null,
    heightIn,
    waists: waist === null ? [] : [waist, waist, waist],
  };
}

const EXEMPT = (eventId: string): ComponentEntry => ({ eventId, exempt: true, value: null });

function input(over: Partial<PtInput> & { entries?: Partial<PtInput['entries']> } = {}): PtInput {
  return {
    age: 30,
    sex: 'male',
    trackId: 'standard',
    ...over,
    entries: {
      body: body(70, 34),
      strength: entry('pushup', 50),
      core: entry('situp', 50),
      cardio: entry('run', 690),
      ...(over.entries ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

describe('scoring', () => {
  it('scores a complete assessment', () => {
    const result = score(standards, input());
    expect(result.incomplete).toBe(false);
    expect(result.possible).toBe(100);
    expect(result.percent).toBeCloseTo(94, 10);
    expect(result.rating).toBe('excellent');
    expect(result.whtr).toBeCloseTo(0.48, 10);
    expect(result.riskLabel).toBe('Low risk');
  });

  it('withholds a composite until every box is filled', () => {
    const result = score(standards, input({ entries: { strength: entry('pushup', null) } }));
    expect(result.incomplete).toBe(true);
    expect(result.percent).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.notes.join(' ')).toContain('Fill every box');
  });

  it('fails the whole assessment on a single component minimum', () => {
    const result = score(standards, input({ entries: { strength: entry('pushup', 1) } }));
    const strength = result.components.find((c) => c.componentId === 'strength')!;
    expect(strength.status).toBe('below-minimum');
    expect(strength.points).toBe(0);
    expect(result.rating).toBe('component-fail');
    // Still counts toward possible: a zero is scored, not dropped.
    expect(result.possible).toBe(100);
  });

  /**
   * Proration is the rule most easily got wrong. An exempt component leaves
   * both sides of the fraction, so it neither helps nor hurts.
   */
  it('prorates the composite over the components actually assessed', () => {
    const result = score(standards, input({ entries: { core: EXEMPT('situp') } }));
    expect(result.possible).toBe(85);
    expect(result.percent).toBeCloseTo((result.earned / 85) * 100, 10);
    expect(result.notes.join(' ')).toContain('85 of 100 possible points');
  });

  it('reports no score when every component is exempt', () => {
    const result = score(
      standards,
      input({
        entries: {
          body: { eventId: 'whtr', exempt: true, value: null },
          strength: EXEMPT('pushup'),
          core: EXEMPT('situp'),
          cardio: EXEMPT('run'),
        },
      }),
    );
    expect(result.rating).toBe('no-score');
    expect(result.possible).toBe(0);
    expect(result.notes.join(' ')).toContain('Every component is exempt');
  });

  it('caps a passed walk below Excellent', () => {
    const max = walkMaxSeconds(
      standards,
      standards.components.find((c) => c.id === 'cardio')!.events.find((e) => e.id === 'walk')!,
      20,
      'male',
    )!;
    // Everything else maxed, so the only thing keeping this off Excellent is
    // the walk itself.
    const result = score(
      standards,
      input({
        age: 20,
        entries: {
          body: body(70, 30),
          strength: entry('pushup', 99),
          core: entry('situp', 99),
          cardio: entry('walk', max - 60),
        },
      }),
    );
    const cardio = result.components.find((c) => c.componentId === 'cardio')!;
    expect(cardio.status).toBe('pass');
    expect(cardio.possible).toBe(0);
    expect(result.percent).toBe(100);
    expect(result.rating).toBe('satisfactory');
    expect(result.notes.join(' ')).toContain('Excellent is unavailable');
  });

  it('fails a walk over the maximum', () => {
    const max = walkMaxSeconds(
      standards,
      standards.components.find((c) => c.id === 'cardio')!.events.find((e) => e.id === 'walk')!,
      30,
      'male',
    )!;
    const result = score(standards, input({ entries: { cardio: entry('walk', max + 1) } }));
    expect(result.components.find((c) => c.componentId === 'cardio')!.status).toBe('fail');
    expect(result.rating).toBe('component-fail');
  });

  it('flags a Tier 2 body fat assessment only when the score is unsatisfactory', () => {
    const highWaist = body(70, 40); // ratio 0.57, over the .55 trigger
    const passing = score(standards, input({ entries: { body: highWaist } }));
    expect(passing.whtr).toBeCloseTo(0.57, 10);
    expect(passing.notes.join(' ')).not.toContain('Tier 2');

    const failing = score(
      standards,
      input({ entries: { body: highWaist, cardio: entry('run', 3000) } }),
    );
    expect(failing.notes.join(' ')).toContain('Tier 2');
  });

  it('asks for an age before scoring on the standard track', () => {
    const result = score(standards, input({ age: null }));
    expect(result.incomplete).toBe(true);
    expect(result.components).toEqual([]);
    expect(result.notes.join(' ')).toContain('Enter your age');
  });

  /**
   * The neutral track reads one age- and sex-neutral column, so unlike the
   * PDF it can score the table events before an age is entered. Only the walk
   * maximum, which is bracketed on age regardless of track, has to wait.
   */
  it('scores the neutral track off a single column', () => {
    const withAge = score(standards, input({ trackId: 'afspecwar', age: 25 }));
    const otherAge = score(standards, input({ trackId: 'afspecwar', age: 55 }));
    expect(withAge.column).toBeNull();
    expect(withAge.neutral).toBe(true);
    const points = (r: typeof withAge, id: string) =>
      r.components.find((c) => c.componentId === id)!.points;
    for (const id of ['strength', 'core', 'cardio']) {
      expect(points(withAge, id)).toBe(points(otherAge, id));
    }
    // ...and the neutral standards are not the same as any age group's.
    expect(points(withAge, 'strength')).not.toBe(
      score(standards, input({ age: 25 })).components.find((c) => c.componentId === 'strength')!
        .points,
    );
  });

  it('is deterministic', () => {
    const once = score(standards, input());
    const twice = score(standards, input());
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

describe('the chart', () => {
  it('runs best row first and marks the minimum', () => {
    const cardio = standards.components.find((c) => c.id === 'cardio')!;
    const run = cardio.events.find((e) => e.id === 'run')!;
    const rows = chartFor(standards, cardio, run, 0);
    expect(rows[0]!.value.startsWith('≤')).toBe(true);
    expect(rows[0]!.points).toBe('50.0');
    expect(rows.at(-1)!.isMinimum).toBe(true);
    expect(rows.filter((r) => r.isMinimum).length).toBe(1);
  });

  it('puts the scored row where the chart says it is', () => {
    const strength = standards.components.find((c) => c.id === 'strength')!;
    const pushup = strength.events.find((e) => e.id === 'pushup')!;
    const rows = chartFor(standards, strength, pushup, 0);
    const result = score(standards, input({ age: 20, entries: { strength: entry('pushup', 50) } }));
    const scored = result.components.find((c) => c.componentId === 'strength')!;
    expect(rows[scored.rowIndex!]!.points).toBe(scored.display);
  });
});

// ---------------------------------------------------------------------------
// Differential test against the PDF
// ---------------------------------------------------------------------------

/**
 * The port is checked against the PDF's own script, run verbatim.
 *
 * Reimplementing a scoring engine is exactly the kind of change that produces
 * a plausible wrong number, so correctness here is not argued from reading the
 * code: every combination below is scored twice and the answers compared.
 */

/**
 * The PDF's own dropdown values, decrypted out of its /Opt arrays.
 *
 * These have to be exact. Its script dispatches on substrings -- it looks for
 * "Crunch", "Plank", "HAMR", "Walk", "Hand" -- so a near-miss like
 * "Cross-leg reverse crunch" silently falls through to the sit-up table and
 * the oracle stops being an oracle.
 */
const REF_EVENT: Record<string, Record<string, string>> = {
  strength: { pushup: 'Push-up', hrpu: 'Hand Release Push-up' },
  core: { situp: 'Sit-up', crunch: 'Cross-Leg Reverse Crunch', plank: 'Forearm Plank' },
  cardio: { run: '2 Mile Run', hamr: '20 Meter HAMR', walk: '2.0 KM Walk' },
};

const REF_RATING: Record<string, string> = {
  'EXCELLENT (READY)': 'excellent',
  'SATISFACTORY (READY)': 'satisfactory',
  'UNSATISFACTORY (NOT READY)': 'unsatisfactory',
  'UNSAT — COMPONENT (NOT READY)': 'component-fail',
  'NO SCORE — PFRA HOLD': 'no-score',
};

/** Splits seconds the way the PDF's paired minutes/seconds boxes hold them. */
function split(seconds: number): [string, string] {
  return [String(Math.floor(seconds / 60)), String(seconds % 60)];
}

function toReferenceInputs(state: PtInput): Record<string, string> {
  const e = state.entries;
  const fields: Record<string, string> = {
    Age: state.age === null ? '' : String(state.age),
    Sex: state.sex === 'female' ? 'Female' : 'Male',
    Track: state.trackId === 'afspecwar' ? 'AFSPECWAR / EOD' : 'Standard PFRA',
    BodyEvent: e.body!.exempt ? 'EXEMPT' : 'Measured',
    StrEvent: e.strength!.exempt ? 'EXEMPT' : REF_EVENT.strength![e.strength!.eventId]!,
    CoreEvent: e.core!.exempt ? 'EXEMPT' : REF_EVENT.core![e.core!.eventId]!,
    CardioEvent: e.cardio!.exempt ? 'EXEMPT' : REF_EVENT.cardio![e.cardio!.eventId]!,
    Height: e.body!.heightIn === null ? '' : String(e.body!.heightIn),
    StrRaw: e.strength!.value === null ? '' : String(e.strength!.value),
  };

  (e.body!.waists ?? []).forEach((w, i) => {
    fields[`W${i + 1}`] = w === null ? '' : String(w);
  });

  const core = e.core!;
  if (core.value === null) {
    fields.CoreA = '';
    fields.CoreB = '';
  } else if (core.eventId === 'plank') {
    [fields.CoreA, fields.CoreB] = split(core.value);
  } else {
    fields.CoreA = String(core.value);
  }

  const cardio = e.cardio!;
  if (cardio.value === null) {
    fields.CardioA = '';
    fields.CardioB = '';
  } else if (cardio.eventId === 'hamr') {
    fields.CardioA = String(cardio.value);
  } else {
    [fields.CardioA, fields.CardioB] = split(cardio.value);
  }
  return fields;
}

/** Which chart row the PDF highlighted for a component, or null. */
function referenceRow(highlighted: string[], prefix: string): number | null {
  const hit = highlighted.find((name) => name.startsWith(`CH_${prefix}_`));
  return hit === undefined ? null : Number.parseInt(hit.slice(`CH_${prefix}_`.length), 10);
}

const REF_ROW_PREFIX: Record<string, string> = {
  pushup: 'PU',
  hrpu: 'HR',
  situp: 'SU',
  crunch: 'CR',
  plank: 'PL',
  run: 'RUN',
  hamr: 'HAMR',
};

/** Deterministic pseudo-random source, so a failure is always reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildCases(): PtInput[] {
  const rand = lcg(20260830);
  const cases: PtInput[] = [];
  const ages = [17, 24, 25, 29, 30, 39, 40, 44, 49, 50, 55, 59, 60, 61, 75];
  const strengthEvents = ['pushup', 'hrpu'];
  const coreEvents = ['situp', 'crunch', 'plank'];
  const cardioEvents = ['run', 'hamr', 'walk'];

  for (const age of ages) {
    for (const sex of ['male', 'female'] as const) {
      for (const trackId of ['standard', 'afspecwar']) {
        for (const se of strengthEvents) {
          for (const ce of coreEvents) {
            for (const ke of cardioEvents) {
              // Values span comfortably passing, marginal, and short of the
              // minimum, so every branch of the row search gets exercised.
              const strengthValue = Math.floor(rand() * 80);
              const coreValue = ce === 'plank' ? Math.floor(rand() * 260) : Math.floor(rand() * 70);
              const cardioValue =
                ke === 'hamr' ? Math.floor(rand() * 100) : 500 + Math.floor(rand() * 1400);
              cases.push({
                age,
                sex,
                trackId,
                entries: {
                  body: body(60 + Math.floor(rand() * 18), 28 + Math.floor(rand() * 20)),
                  strength: entry(se, strengthValue),
                  core: entry(ce, coreValue),
                  cardio: entry(ke, cardioValue),
                },
              });
            }
          }
        }
      }
    }
  }

  // Exemptions, in every single-component combination plus all-exempt.
  const baseline = cases[0]!;
  for (const id of ['body', 'strength', 'core', 'cardio']) {
    cases.push({
      ...baseline,
      entries: {
        ...baseline.entries,
        [id]: { ...baseline.entries[id]!, exempt: true, value: null },
      },
    });
  }
  cases.push({
    ...baseline,
    entries: Object.fromEntries(
      Object.entries(baseline.entries).map(([id, e]) => [id, { ...e, exempt: true, value: null }]),
    ),
  });
  return cases;
}

const CASES = buildCases();

describe('differential against the PDF calculator', () => {
  it('covers every event combination on both tracks', () => {
    expect(CASES.length).toBeGreaterThan(500);
  });

  it('matches the PDF on every case', () => {
    const mismatches: string[] = [];

    for (const state of CASES) {
      const mine = score(standards, state);
      const theirs = runReference(toReferenceInputs(state));
      const where = `age=${state.age} sex=${state.sex} track=${state.trackId} ` +
        Object.entries(state.entries)
          .map(([id, e]) => `${id}=${e.exempt ? 'EXEMPT' : `${e.eventId}:${e.value}`}`)
          .join(' ');

      // The PDF prints an em dash where there is no composite to show at all,
      // and leaves the box blank while inputs are still missing.
      const expectedComposite =
        mine.rating === 'no-score' ? '\u2014' : mine.percent === null ? '' : mine.percent.toFixed(1);
      if (theirs.Composite !== expectedComposite) {
        mismatches.push(`${where}\n  composite: pdf=${theirs.Composite} ours=${expectedComposite}`);
      }

      const expectedRating = mine.rating === null ? '' : REF_RATING[theirs.Rating] ?? theirs.Rating;
      if (mine.rating !== null && REF_RATING[theirs.Rating] !== mine.rating) {
        mismatches.push(`${where}\n  rating: pdf=${theirs.Rating} ours=${mine.rating}`);
      } else if (mine.rating === null && theirs.Rating !== '') {
        mismatches.push(`${where}\n  rating: pdf=${theirs.Rating} ours=(none)`);
      }
      void expectedRating;

      // Per-component points, including PASS/FAIL/EXEMPT spellings.
      const fieldFor: Record<string, string> = {
        body: 'WHtRPts',
        strength: 'StrPts',
        core: 'CorePts',
        cardio: 'CardioPts',
      };
      for (const component of mine.components) {
        const pdfValue = theirs[fieldFor[component.componentId]!] ?? '';
        const ourValue =
          component.status === 'exempt'
            ? 'EXEMPT'
            : component.status === 'pass'
              ? 'PASS'
              : component.status === 'fail'
                ? 'FAIL'
                : component.display;
        if (pdfValue !== ourValue) {
          mismatches.push(
            `${where}\n  ${component.componentId}: pdf=${pdfValue} ours=${ourValue}`,
          );
        }

        // And the chart row each one landed on.
        const prefix = REF_ROW_PREFIX[component.event.id];
        if (prefix && component.status !== 'exempt') {
          const pdfRow = referenceRow(theirs.__highlighted, prefix);
          if (pdfRow !== component.rowIndex) {
            mismatches.push(
              `${where}\n  ${component.componentId} row: pdf=${pdfRow} ours=${component.rowIndex}`,
            );
          }
        }
      }

      // Waist-to-height ratio, which the PDF renders to two places.
      const pdfRatio = theirs.WHtR ?? '';
      const ourRatio =
        mine.components.find((c) => c.componentId === 'body')!.status === 'exempt'
          ? 'EXEMPT'
          : mine.whtr === null
            ? ''
            : mine.whtr.toFixed(2);
      if (pdfRatio !== ourRatio) {
        mismatches.push(`${where}\n  whtr: pdf=${pdfRatio} ours=${ourRatio}`);
      }
    }

    expect(mismatches.slice(0, 10).join('\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });
});
