import { describe, it, expect } from 'vitest';
import { CURRENT_STANDARDS } from '@/lib/data/pt';
import {
  assessBodyFat,
  averageWaist,
  chartFor,
  combineTime,
  floorHalf,
  formatTime,
  formatInches,
  parseTime,
  roundMeasurement,
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

  // The tape boxes are deliberately left blank.
  //
  // The PDF is no longer the authority for the Tier 2 assessment: it rounds the
  // abdomen, waist and buttocks to the half inch where AFMAN 36-2905
  // Attachment 8 says quarter, and it passes a result equal to the standard
  // where Table 3.2 says "< 26%" / "< 36%". Those are corrected against the
  // manual and covered by the AFMAN-sourced tests below, so feeding the oracle
  // tape values here would only assert that we still reproduce its errors.
  //
  // It remains the oracle for everything on page 1 -- the scoring tables, the
  // ladders, proration, ratings -- which the manual does not contradict. With
  // the tape blank neither engine can reach a body fat result, so the composite
  // comparison stays a like-for-like test of that.
  fields.BF_Neck = '';
  fields.BF_2 = '';
  fields.BF_3 = '';

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

  // Tier 2 tape cases. These need a ratio over .55 AND a score that is not
  // met, or the assessment never comes into play -- so the performances are
  // deliberately poor and the waists deliberately large. The tape values then
  // span passing, failing, partly entered, and not entered at all, because
  // each one takes a different branch through the composite.
  const tapes: Array<Record<string, number | null> | undefined> = [
    undefined,
    { neck: 15.5, abdomen: 34.25, waist: 30.5, buttocks: 39.5 },
    { neck: 16.0, abdomen: 46.75, waist: 44.0, buttocks: 50.25 },
    { neck: 15.75, abdomen: null, waist: 33.0, buttocks: null },
    { neck: 17.3, abdomen: 38.9, waist: 35.4, buttocks: 42.1 },
    // A neck bigger than the abdomen: the circumference value goes non-positive.
    { neck: 40.0, abdomen: 33.0, waist: 30.0, buttocks: 31.0 },
  ];
  for (const age of [22, 34, 47, 62]) {
    for (const sex of ['male', 'female'] as const) {
      for (const [height, waistIn] of [
        [66, 38],   // 0.57 -- over the trigger
        [70, 40],   // 0.57
        [68, 34],   // 0.50 -- under it, so no assessment is required
        [64, 40],   // 0.62 -- high risk and zero points
      ] as const) {
        for (const tape of tapes) {
          cases.push({
            age,
            sex,
            trackId: 'standard',
            entries: {
              body: body(height, waistIn),
              strength: entry('pushup', 20),
              core: entry('situp', 20),
              cardio: entry('run', 1500),
            },
            bodyFat: tape,
          });
          // The same tape against a comfortably passing assessment, where a
          // required assessment must NOT be triggered however large the waist.
          cases.push({
            age,
            sex,
            trackId: 'standard',
            entries: {
              body: body(height, waistIn),
              strength: entry('pushup', 70),
              core: entry('situp', 70),
              cardio: entry('run', 700),
            },
            bodyFat: tape,
          });
        }
      }
    }
  }
  return cases;
}

const CASES = buildCases();

describe('differential against the PDF calculator', () => {
  it('covers every event combination on both tracks', () => {
    expect(CASES.length).toBeGreaterThan(500);
  });

  /**
   * A guard on the guard. The Tier 2 comparisons below are only worth anything
   * if the cases actually reach the branches, and it is easy to change a waist
   * or a performance here and quietly stop triggering an assessment at all.
   */
  it('exercises every branch of the Tier 2 assessment', () => {
    const outcomes = CASES.map((state) => score(standards, state).bfa);
    const required = outcomes.filter((b) => b.required);
    expect(required.length).toBeGreaterThan(50);
    expect(required.filter((b) => b.assessment.result === 'pass').length).toBeGreaterThan(10);
    expect(required.filter((b) => b.assessment.result === 'fail').length).toBeGreaterThan(10);
    expect(required.filter((b) => b.assessment.result === null).length).toBeGreaterThan(10);
    // And plenty that do not require one, so the locked path is compared too.
    expect(outcomes.filter((b) => !b.required).length).toBeGreaterThan(50);
  });

  it('matches the PDF on every case', () => {
    const mismatches: string[] = [];

    for (const withTape of CASES) {
      // Both engines run with the tape empty, for the reason set out in
      // toReferenceInputs: the manual, not the PDF, governs the tape now.
      const state: PtInput = { ...withTape, bodyFat: undefined };
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

      // The Tier 2 tape worksheet: the circumference value, the percent, the
      // pass/fail, and -- the part that moves the score -- whether the PDF
      // decided an assessment was required at all.
      // BF_Lock is the PDF's own word for "a Tier 2 assessment is required".
      // The gate itself is unchanged from the PDF and is what para 3.1.2.1.1
      // states, so it is still compared.
      const pdfRequired = theirs.BF_Lock === 'UNLOCKED';
      if (pdfRequired !== mine.bfa.required) {
        mismatches.push(
          `${where}\n  bfa required: pdf=${pdfRequired} ours=${mine.bfa.required}`,
        );
      }
    }

    expect(mismatches.slice(0, 10).join('\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 body fat assessment
// ---------------------------------------------------------------------------

/** The tape sites, keyed the way the data names them. */
function tape(over: Record<string, number | null>): Record<string, number | null> {
  return { neck: 15.5, abdomen: 34.25, waist: 30.5, buttocks: 39.5, ...over };
}

/** A case that requires an assessment: ratio over .55 and a score not met. */
function requiring(sex: 'male' | 'female', bodyFat?: Record<string, number | null>): PtInput {
  return {
    age: 34,
    sex,
    trackId: 'standard',
    entries: {
      body: body(66, 38),
      strength: entry('pushup', 20),
      core: entry('situp', 20),
      cardio: entry('run', 1500),
    },
    bodyFat,
  };
}

describe('tape measurement rounding', () => {
  it('rounds the neck up and every other site down', () => {
    // The directions are asymmetric on purpose: rounding never flatters the
    // circumference value, so it never flatters the body fat estimate.
    expect(roundMeasurement(15.3, 'upQuarter')).toBe(15.5);
    expect(roundMeasurement(15.25, 'upQuarter')).toBe(15.25);
    expect(roundMeasurement(15.26, 'upQuarter')).toBe(15.5);
    expect(roundMeasurement(34.9, 'downHalf')).toBe(34.5);
    expect(roundMeasurement(34.5, 'downHalf')).toBe(34.5);
    expect(roundMeasurement(69.4, 'nearestHalf')).toBe(69.5);
    expect(roundMeasurement(69.2, 'nearestHalf')).toBe(69);
  });

  it('is idempotent', () => {
    for (const mode of ['upQuarter', 'downHalf', 'nearestHalf'] as const) {
      const once = roundMeasurement(37.37, mode);
      expect(roundMeasurement(once, mode)).toBe(once);
    }
  });
});

describe('body fat assessment', () => {
  it('sums the sites with their signs and applies the equation', () => {
    const male = assessBodyFat(standards, 'male', 66, tape({}));
    // Neck 15.5 up to 15.5, abdomen 34.25 down to 34.25 (quarter inch, per
    // Attachment 8), so 34.25 - 15.5.
    expect(male.circumference).toBe(18.75);
    expect(male.percent).toBe(19);
    expect(male.result).toBe('pass');

    const female = assessBodyFat(standards, 'female', 66, tape({}));
    // Natural waist 30.5 plus buttocks 39.5 minus neck 15.5.
    expect(female.circumference).toBe(54.5);
    expect(female.percent).toBe(27);
    expect(female.result).toBe('pass');
  });

  it('fails a percent over the standard for that sex', () => {
    const male = assessBodyFat(standards, 'male', 66, tape({ abdomen: 46.0 }));
    expect(male.percent).toBe(37);
    expect(male.result).toBe('fail');
  });

  it('says which sites are still missing rather than guessing', () => {
    const partial = assessBodyFat(standards, 'male', 66, tape({ abdomen: null }));
    expect(partial.circumference).toBeNull();
    expect(partial.percent).toBeNull();
    expect(partial.result).toBeNull();
    expect(partial.need).toContain('abdomen');
  });

  it('refuses a circumference value that is not positive', () => {
    const impossible = assessBodyFat(standards, 'male', 66, tape({ neck: 40, abdomen: 33 }));
    expect(impossible.circumference).toBeNull();
    expect(impossible.need).toContain('not positive');
  });

  it('needs a height before it can produce a percent', () => {
    const noHeight = assessBodyFat(standards, 'male', null, tape({}));
    expect(noHeight.circumference).toBe(18.75);
    expect(noHeight.percent).toBeNull();
    expect(noHeight.need).toContain('height');
  });
});

describe('when a Tier 2 assessment is required', () => {
  it('is not required while the assessment is met', () => {
    const passing = score(standards, {
      ...requiring('male'),
      entries: {
        body: body(66, 38),
        strength: entry('pushup', 60),
        core: entry('situp', 55),
        cardio: entry('run', 700),
      },
    });
    expect(passing.rating).toBe('satisfactory');
    expect(passing.bfa.required).toBe(false);
    expect(passing.bfa.requirement).toContain('high risk');
  });

  it('is not required when the ratio is not over the threshold', () => {
    const lowRatio = score(standards, { ...requiring('male'), entries: {
      body: body(70, 34),
      strength: entry('pushup', 20),
      core: entry('situp', 20),
      cardio: entry('run', 1500),
    } });
    // Not met, one way or the other -- it is the ratio that keeps a Tier 2
    // assessment off the table here, not the score.
    expect(['unsatisfactory', 'component-fail']).toContain(lowRatio.rating);
    expect(lowRatio.bfa.required).toBe(false);
    expect(lowRatio.bfa.requirement).toContain('not over');
  });

  it('is required when the ratio is over the threshold and the score is not met', () => {
    const needed = score(standards, requiring('male'));
    expect(needed.bfa.required).toBe(true);
    expect(needed.bfa.effect).toContain('required');
    expect(needed.notes.join(' ')).toContain('Tier 2 body fat assessment required');
  });

  it('opens the worksheet for anyone who did not meet the assessment', () => {
    // Ratio under the threshold, so no Tier 2 is required -- but the member did
    // not meet the assessment, and taping them is the useful thing to do next.
    const failedLowRatio = score(standards, {
      ...requiring('male', tape({})),
      entries: {
        body: body(70, 34),
        strength: entry('pushup', 20),
        core: entry('situp', 20),
        cardio: entry('run', 1500),
      },
    });
    expect(failedLowRatio.bfa.required).toBe(false);
    expect(failedLowRatio.bfa.available).toBe(true);
    // Height 70 here, not the 66 the required-case tests use.
    expect(failedLowRatio.bfa.assessment.percent).toBe(17);
    expect(failedLowRatio.bfa.effect).toContain('does not change the score');
  });

  it('counts for nothing when it was not required', () => {
    const withTape = score(standards, {
      ...requiring('male', tape({})),
      entries: {
        body: body(70, 34),
        strength: entry('pushup', 20),
        core: entry('situp', 20),
        cardio: entry('run', 1500),
      },
    });
    const withoutTape = score(standards, {
      ...requiring('male'),
      entries: {
        body: body(70, 34),
        strength: entry('pushup', 20),
        core: entry('situp', 20),
        cardio: entry('run', 1500),
      },
    });
    // Same score, same rating, same points on the table: reference only.
    expect(withTape.percent).toBe(withoutTape.percent);
    expect(withTape.rating).toBe(withoutTape.rating);
    expect(withTape.possible).toBe(withoutTape.possible);
  });

  it('stays shut for somebody who met the assessment', () => {
    const passing = score(standards, {
      ...requiring('male', tape({})),
      entries: {
        body: body(66, 38),
        strength: entry('pushup', 60),
        core: entry('situp', 55),
        cardio: entry('run', 700),
      },
    });
    expect(passing.bfa.available).toBe(false);
    expect(passing.bfa.assessment.percent).toBeNull();
  });
});

describe('what a Tier 2 assessment does to the composite', () => {
  it('drops body composition from both sides of the division when it passes', () => {
    const before = score(standards, requiring('male'));
    const after = score(standards, requiring('male', tape({})));

    expect(after.bfa.assessment.result).toBe('pass');
    expect(after.possible).toBe(before.possible - 20);
    // The points still stand and are still shown; they just no longer count.
    const bodyBefore = before.components.find((c) => c.componentId === 'body')!;
    const bodyAfter = after.components.find((c) => c.componentId === 'body')!;
    expect(bodyAfter.points).toBe(bodyBefore.points);
    expect(bodyAfter.possible).toBe(0);
    expect(bodyAfter.droppedByBfa).toBe(true);
    expect(after.earned).toBe(before.earned - (bodyBefore.points ?? 0));
    expect(after.percent).not.toBe(before.percent);
  });

  it('makes the assessment unsatisfactory when it fails, whatever the points', () => {
    const failed = score(standards, requiring('male', tape({ abdomen: 46.0 })));
    expect(failed.bfa.assessment.result).toBe('fail');
    expect(failed.rating).toBe('component-fail');
    expect(failed.bfa.effect).toContain('not met');
  });

  it('leaves the score alone while the worksheet is still empty', () => {
    const pending = score(standards, requiring('male'));
    const bodyPoints = pending.components.find((c) => c.componentId === 'body')!.points ?? 0;
    expect(pending.bfa.required).toBe(true);
    expect(pending.bfa.assessment.result).toBeNull();
    expect(pending.possible).toBe(100);
    expect(pending.earned).toBeGreaterThanOrEqual(bodyPoints);
  });
});

// ---------------------------------------------------------------------------
// AFMAN 36-2905, 24 March 2026 -- read from the manual, not from the PDF
// ---------------------------------------------------------------------------

/**
 * The maintainer's PDF is the oracle for the scoring tables, but it is not the
 * authority. Where the manual and the PDF disagree, these are the cases that
 * say so, each one citing the paragraph it comes from.
 */
describe('AFMAN 36-2905 conformance', () => {
  it('averages the three closest when a fourth waist is taken (para 3.15.4.5)', () => {
    // "If any of the measurements differ by more than one inch, an additional
    // measurement must be taken. The three closest measurements will be added
    // together, divided by three, and rounded down to the nearest half inch."
    const outlier = averageWaist([38, 38.5, 41, 38.25]);
    // 41 is the odd one out, so 38 + 38.5 + 38.25 = 114.75 / 3 = 38.25 -> 38.0.
    expect(outlier.waist).toBe(38);
    // ...and with the fourth taken, it stops asking for one.
    expect(outlier.notes.join(' ')).not.toContain('take another');

    // Three that disagree by more than an inch still score, and still say so.
    const three = averageWaist([38, 38.5, 41]);
    expect(three.notes.join(' ')).toContain('take another');
    expect(three.waist).toBe(39);
  });

  it('rounds every taped site to the quarter inch (Attachment 8)', () => {
    // Neck UP, everything else DOWN, all to the nearest quarter. The PDF used
    // the half inch for abdomen, waist and buttocks, which shrinks the
    // circumference value by up to a quarter inch and flatters the result.
    expect(roundMeasurement(15.30, 'upQuarter')).toBe(15.5);
    expect(roundMeasurement(34.40, 'downQuarter')).toBe(34.25);
    expect(roundMeasurement(34.40, 'downHalf')).toBe(34.0); // what it used to do

    const male = assessBodyFat(standards, 'male', 66, { neck: 15.5, abdomen: 34.4 });
    expect(male.circumference).toBe(18.75);
  });

  it('fails a result equal to the standard (Table 3.2)', () => {
    // Table 3.2 reads "< 26%" and "< 36%". The manual uses "\u2264" where it means
    // it -- para 3.10.3 is "\u2264 74.9" -- so "<" here is deliberate.
    const male = standards.bodyFat!.bySex.male;
    const female = standards.bodyFat!.bySex.female;
    expect(male.maxPercent).toBe(26);
    expect(female.maxPercent).toBe(36);

    // Find a circumference that lands exactly on 26% at a given height, and
    // check it fails rather than passes.
    const height = 70;
    let atStandard: number | null = null;
    for (let circ = 20; circ < 60; circ += 0.25) {
      const a = assessBodyFat(standards, 'male', height, { neck: 0.25, abdomen: circ + 0.25 });
      if (a.percent === 26) { atStandard = circ; break; }
    }
    expect(atStandard).not.toBeNull();
    const exact = assessBodyFat(standards, 'male', height, {
      neck: 0.25,
      abdomen: atStandard! + 0.25,
    });
    expect(exact.percent).toBe(26);
    expect(exact.result).toBe('fail');
  });

  it('scores a met assessment as an exempt component without a PFRA hold (paras 3.7.2, 3.9)', () => {
    // 3.7.2: "If the member meets standards, the body composition assessment
    // will be scored as an exempt component." 3.9: a PFRA hold follows an
    // AF Form 469 exemption -- which this is not. The PDF counts it as one and
    // warns about a hold that does not apply.
    const met = score(standards, requiring('male', { neck: 15.5, abdomen: 34.25 }));
    expect(met.bfa.assessment.result).toBe('pass');
    expect(met.possible).toBe(80);
    expect(met.notes.join(' ')).not.toContain('PFRA hold');
  });

  it('makes an unmet assessment unsatisfactory (para 3.7.2)', () => {
    // "If the member does not meet BFA standards, the member will receive an
    // unsatisfactory score on the PFRA."
    const unmet = score(standards, requiring('male', { neck: 15.5, abdomen: 46 }));
    expect(unmet.bfa.assessment.result).toBe('fail');
    expect(unmet.rating).toBe('component-fail');
  });

  it('requires a Tier 2 only above the ratio AND below standard (para 3.1.2.1.1)', () => {
    // "Members that are identified with a WHtR > .55 and not meeting standards
    // on the composite PFRA must complete a Tier 2 BFA." Both conditions.
    expect(standards.rating.tier2BfaRatioOver).toBe(0.55);
    // Exactly .55 is not "> .55".
    const at = score(standards, {
      age: 30, sex: 'male', trackId: 'standard',
      entries: {
        body: body(100, 55),
        strength: entry('pushup', 20),
        core: entry('situp', 20),
        cardio: entry('run', 1500),
      },
    });
    expect(at.whtr).toBe(0.55);
    expect(at.bfa.required).toBe(false);
  });

  it('truncates the ratio to two decimals (para 3.15.4.2)', () => {
    // The manual's own worked example: height 72, waist 39.5, 39.5/72 = 0.5486,
    // truncated to 0.54 -- which is a scoring row lower than rounding would give.
    expect(waistToHeightRatio(39.5, 72)).toBe(0.54);
  });

  it('uses the walk maxima in Table 3.1', () => {
    // Male <30 16:16, 30-39 16:18, 40-49 16:23, 50-59 16:40, 60+ 16:58.
    const walk = standards.components
      .find((c) => c.id === 'cardio')!
      .events.find((e) => e.id === 'walk')!;
    const male = [[25, '16:16'], [35, '16:18'], [45, '16:23'], [55, '16:40'], [65, '16:58']] as const;
    for (const [age, expected] of male) {
      expect(formatTime(walkMaxSeconds(standards, walk, age, 'male')!)).toBe(expected);
    }
    // Female <30 17:22, 30-39 17:28, 40-49 17:49, 50-59 18:11, 60+ 18:53.
    const female = [[25, '17:22'], [35, '17:28'], [45, '17:49'], [55, '18:11'], [65, '18:53']] as const;
    for (const [age, expected] of female) {
      expect(formatTime(walkMaxSeconds(standards, walk, age, 'female')!)).toBe(expected);
    }
  });

  it('splits the composite 50/20/15/15 (para 3.7.1)', () => {
    const points = Object.fromEntries(
      standards.components.map((c) => [c.id, c.maxPoints]),
    );
    expect(points).toEqual({ cardio: 50, body: 20, strength: 15, core: 15 });
    // "Body Composition (does not have a minimum requirement)".
    expect(standards.components.find((c) => c.id === 'body')!.hasMinimum).toBe(false);
  });

  it('awards the walk no points and no Excellent (para 3.7.3)', () => {
    const walked = score(standards, {
      age: 30, sex: 'male', trackId: 'standard',
      entries: {
        body: body(70, 30),
        strength: entry('pushup', 60),
        core: entry('situp', 58),
        cardio: entry('walk', 900),
      },
    });
    const cardio = walked.components.find((c) => c.componentId === 'cardio')!;
    expect(cardio.status).toBe('pass');
    expect(cardio.possible).toBe(0);
    expect(walked.rating).toBe('satisfactory');
    // ...and not a PFRA hold: "Members that assess on the 2 kilometer walk will
    // not be placed in PFRA Hold."
    expect(walked.notes.join(' ')).not.toContain('PFRA hold');
  });
});
