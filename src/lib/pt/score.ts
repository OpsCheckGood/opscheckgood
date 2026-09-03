import type {
  AgeGroup,
  BodyFatSite,
  BodyFatTable,
  BodyFatStandard,
  ComponentDefinition,
  EventDefinition,
  MeasurementRounding,
  PtStandards,
  Sex,
} from '../data/types';

/**
 * PT scoring. Pure, deterministic, and entirely driven by the standards data:
 * nothing in this file knows that push-ups exist, or that the cardio component
 * is worth 50 points. It reads tables, ladders, and brackets out of a
 * `PtStandards` and applies the same rules to whatever is there.
 *
 * That is what makes constraint 4 hold for phase 2. Adding hand-release
 * push-ups, or a new cardio event, or a whole new AFMAN edition, is a data
 * edit; this file does not change.
 *
 * Ported from the maintainer's fillable PDF calculator. Behaviour is matched
 * deliberately, including the places where the AFMAN truncates rather than
 * rounds -- see `waistToHeightRatio`.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Seconds to m:ss. Used for run, plank, and walk readouts. */
export function formatTime(totalSeconds: number): string {
  const whole = Math.round(totalSeconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Parses "9:12", "9 12", or a bare seconds count. Returns null if unusable. */
export function parseTime(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const parts = text.split(':');
  if (parts.length === 2) {
    const m = Number.parseInt(parts[0]!.replace(/[^0-9]/g, ''), 10);
    const s = Number.parseInt(parts[1]!.replace(/[^0-9]/g, ''), 10);
    if (Number.isNaN(m) && Number.isNaN(s)) return null;
    return (Number.isNaN(m) ? 0 : m) * 60 + (Number.isNaN(s) ? 0 : s);
  }
  const v = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isNaN(v) ? null : v;
}

/** Parses a plain number, ignoring stray units the user typed. */
export function parseNumber(raw: string): number | null {
  const text = raw.replace(/[^0-9.]/g, '');
  if (text === '') return null;
  const v = Number.parseFloat(text);
  return Number.isNaN(v) ? null : v;
}

/** Combines a minutes box and a seconds box into total seconds. */
export function combineTime(minutes: string, seconds: string): number | null {
  const m = parseNumber(minutes);
  const s = parseNumber(seconds);
  if (m === null && s === null) return null;
  return (m ?? 0) * 60 + (s ?? 0);
}

// ---------------------------------------------------------------------------
// Bracket and column lookup
// ---------------------------------------------------------------------------

/** Index of the bracket holding `age`. Brackets are validated as a tiling. */
export function bracketIndex(groups: ReadonlyArray<AgeGroup>, age: number): number {
  for (let i = 0; i < groups.length; i++) {
    const max = groups[i]!.maxAge;
    if (max === null || age <= max) return i;
  }
  return groups.length - 1;
}

/**
 * Column into a scoring table row.
 *
 * Rows are laid out age group by age group, and within each age group in the
 * declared sex order, so this has to agree with the loader's column-count check.
 */
export function columnFor(standards: PtStandards, age: number, sex: Sex): number {
  const ai = bracketIndex(standards.ageGroups, age);
  const si = standards.sexes.findIndex((s) => s.id === sex);
  return ai * standards.sexes.length + (si < 0 ? 0 : si);
}

/**
 * The one column of a table that applies to this person, best row first.
 *
 * A neutral track (AFSPECWAR/EOD) ignores age and sex entirely and reads the
 * table's single neutral column instead.
 */
export function standardsColumn(
  standards: PtStandards,
  tableKey: string,
  column: number | null,
): number[] {
  const table = standards.tables[tableKey];
  if (!table) return [];
  if (column === null) return table.neutral;
  return table.rows.map((row) => row[column]!);
}

/** Highest-first search: the first row whose threshold `value` reaches. */
function rowForHigherIsBetter(column: ReadonlyArray<number>, value: number): number {
  for (let i = 0; i < column.length; i++) {
    if (value >= column[i]!) return i;
  }
  return -1;
}

/** Lowest-first search: the first row whose time `value` comes in under. */
function rowForLowerIsBetter(column: ReadonlyArray<number>, value: number): number {
  for (let i = 0; i < column.length; i++) {
    if (value <= column[i]!) return i;
  }
  return -1;
}

/** Which row a raw performance lands on, or -1 for below the minimum. */
export function rowFor(
  column: ReadonlyArray<number>,
  value: number,
  better: 'higher' | 'lower',
): number {
  return better === 'lower'
    ? rowForLowerIsBetter(column, value)
    : rowForHigherIsBetter(column, value);
}

// ---------------------------------------------------------------------------
// Body composition
// ---------------------------------------------------------------------------

/** Rounds down to the nearest half inch, per AFMAN 36-2905 para 3.15.4.5. */
export function floorHalf(x: number): number {
  return Math.floor(x * 2 + 1e-9) / 2;
}

export interface WaistResult {
  /** The averaged, half-inch-floored waist, or null if nothing was entered. */
  waist: number | null;
  notes: string[];
}

/**
 * Averages the waist measurements and floors to the half inch.
 *
 * Para 3.15.4.5: three measurements, and if any two differ by more than an
 * inch an additional one is taken -- then "the three closest measurements will
 * be added together, divided by three". So with a fourth entered, the outlier
 * drops out rather than being averaged in.
 *
 * Shortfalls produce a note rather than a refusal to score: the number is still
 * the best available and the user needs to see it.
 */
export function averageWaist(raw: ReadonlyArray<number | null>): WaistResult {
  const values = raw.filter((v): v is number => v !== null && v > 0);
  const notes: string[] = [];
  if (values.length === 0) return { waist: null, notes };

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const spread = hi - lo > 1;

  // With more than three, keep the three that sit closest together: sort, then
  // take the window of three with the smallest range.
  let used = values;
  if (values.length > 3) {
    const sorted = [...values].sort((a, b) => a - b);
    let best = 0;
    for (let i = 1; i + 2 < sorted.length; i += 1) {
      if (sorted[i + 2]! - sorted[i]! < sorted[best + 2]! - sorted[best]!) best = i;
    }
    used = sorted.slice(best, best + 3);
  }

  if (spread && values.length < 4) {
    notes.push('Waist measurements differ by more than 1 in — take another (para 3.15.4.5).');
  }
  if (values.length < 3) {
    notes.push('Enter three waist measurements (para 3.15.4.5).');
  }
  const sum = used.reduce((a, b) => a + b, 0);
  return { waist: floorHalf(sum / used.length), notes };
}

/**
 * Waist divided by height, truncated to two decimals.
 *
 * Truncated, not rounded: the chart's rows are exact ratios, so 0.5999 scores
 * on the 0.59 row rather than being rounded up onto the 0.60 row.
 */
export function waistToHeightRatio(waistIn: number, heightIn: number): number {
  return Math.floor((waistIn / heightIn) * 100 + 1e-9) / 100;
}

/** The ladder row a ratio lands on. The final row is the catch-all. */
export function ratioRow(component: ComponentDefinition, ratio: number): number {
  const rows = component.ladderRows ?? [];
  for (let i = 0; i < rows.length; i++) {
    const max = rows[i]!.ratioMax;
    if (max === null || ratio <= max + 1e-9) return i;
  }
  return rows.length - 1;
}

function riskLabel(component: ComponentDefinition, ratio: number): string | null {
  for (const band of component.riskBands ?? []) {
    if (band.ratioMax === null || ratio <= band.ratioMax + 1e-9) return band.label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 2 body fat assessment
// ---------------------------------------------------------------------------

/**
 * Tape rounding, in the direction the source specifies for each site.
 *
 * The directions are not symmetric and that is deliberate: the neck rounds up
 * and every other site rounds down, so the circumference value -- and with it
 * the body fat estimate -- is never flattered by rounding.
 */
export function roundMeasurement(value: number, mode: MeasurementRounding): number {
  if (mode === 'upQuarter') return Math.ceil(value * 4 - 1e-9) / 4;
  if (mode === 'downQuarter') return Math.floor(value * 4 + 1e-9) / 4;
  if (mode === 'downHalf') return Math.floor(value * 2 + 1e-9) / 2;
  return Math.round(value * 2) / 2;
}

/**
 * Inches, the way the source prints them: two decimals with one trailing zero
 * trimmed, so 15.25 stays 15.25 and 15.50 shows as 15.5.
 */
export function formatInches(value: number | null): string {
  if (value === null) return '';
  return `${value.toFixed(2).replace(/0$/, '').replace(/\.$/, '')} in`;
}

/** One taped site, as entered and as it will actually be used. */
export interface BodyFatMeasurement {
  site: BodyFatSite;
  raw: number | null;
  rounded: number | null;
}

export interface BodyFatAssessment {
  standard: BodyFatStandard | null;
  /** Height from the body composition panel, rounded for this calculation. */
  heightIn: number | null;
  measurements: BodyFatMeasurement[];
  circumference: number | null;
  percent: number | null;
  /** True when the percent came from the published table, not the equation. */
  fromTable: boolean;
  result: 'pass' | 'fail' | null;
  /** What is still missing or wrong. Null once a percent came out. */
  need: string | null;
  /** Where to check this result against the published tables. */
  crossCheck: string | null;
}

/**
 * The tape assessment on its own, independent of whether it is required.
 *
 * Kept separate from `score` so the worksheet can be filled in and read back
 * at any time, exactly as the source does: the numbers are the same whether or
 * not they end up changing the composite.
 */
export function assessBodyFat(
  standards: PtStandards,
  sex: Sex,
  heightRaw: number | null,
  entered: Readonly<Record<string, number | null>>,
): BodyFatAssessment {
  const rules = standards.bodyFat;
  const standard = rules?.bySex[sex] ?? null;
  const empty: BodyFatAssessment = {
    standard,
    heightIn: null,
    measurements: [],
    circumference: null,
    percent: null,
    fromTable: false,
    result: null,
    need: null,
    crossCheck: null,
  };
  if (!rules || !standard) return empty;

  const heightIn =
    heightRaw === null || heightRaw <= 0
      ? null
      : roundMeasurement(heightRaw, rules.heightRounding);

  const measurements: BodyFatMeasurement[] = standard.sites.map((site) => {
    const raw = entered[site.id] ?? null;
    return {
      site,
      raw,
      rounded: raw === null ? null : roundMeasurement(raw, site.rounding),
    };
  });

  const missing = measurements.filter((m) => m.rounded === null).map((m) => m.site.label);
  let circumference: number | null = null;
  let need: string | null = null;

  if (missing.length > 0) {
    need = `Enter ${listOf(missing.map((label) => label.toLowerCase()))}.`;
  } else {
    circumference = measurements.reduce((sum, m) => sum + m.site.sign * m.rounded!, 0);
    if (circumference <= 0) {
      need = 'Check the measurements — the circumference value is not positive.';
      circumference = null;
    }
  }

  if (circumference === null || heightIn === null) {
    if (heightIn === null && need === null) {
      need = 'Enter your height with the body composition measurements.';
    } else if (heightIn === null) {
      need = `${need} Enter your height with the body composition measurements.`;
    }
    return { ...empty, heightIn, measurements, circumference, need };
  }

  // The manual points at the published table, not at the equation. Read the
  // table where it covers the measurement; the equation is only the fallback
  // off the end of it, and is what the table was generated from anyway.
  const table = rules.tables?.[sex];
  const looked = table ? lookupBodyFat(table, circumference, heightIn) : null;

  let percent: number;
  if (looked !== null) {
    percent = looked;
  } else {
    const { circumference: a, height: b, constant: c } = standard.equation;
    percent = Math.max(
      0,
      Math.round(a * Math.log10(circumference) + b * Math.log10(heightIn) + c),
    );
  }

  return {
    standard,
    heightIn,
    measurements,
    circumference,
    percent,
    fromTable: looked !== null,
    // Table 3.2 is "< 26%" / "< 36%": equal to the standard does not pass.
    result: percent < standard.maxPercent ? 'pass' : 'fail',
    need: null,
    crossCheck:
      looked !== null
        ? `${percent}% is ${standard.tableRef}: circumference ${formatInches(circumference)} against height ${formatInches(heightIn)}.`
        : `${formatInches(circumference)} at ${formatInches(heightIn)} falls outside ${standard.tableRef}. This figure is the DoD circumference equation the table is built from, not a published one — have it checked.`,
  };
}

/**
 * A cell of a published table, or null when the measurement falls outside it.
 *
 * Both axes are evenly spaced, so the index is arithmetic rather than a search.
 * The tolerance covers a measurement a hair off a step through floating point;
 * anything genuinely between steps is rejected rather than snapped, because a
 * silently shifted row is the failure this tool cannot have.
 */
export function lookupBodyFat(
  table: BodyFatTable,
  circumferenceIn: number,
  heightIn: number,
): number | null {
  const ci = Math.round((circumferenceIn - table.circumference.start) / table.circumference.step);
  const hi = Math.round((heightIn - table.height.start) / table.height.step);
  if (ci < 0 || ci >= table.circumference.count) return null;
  if (hi < 0 || hi >= table.height.count) return null;
  if (Math.abs(table.circumference.start + ci * table.circumference.step - circumferenceIn) > 1e-6) {
    return null;
  }
  if (Math.abs(table.height.start + hi * table.height.step - heightIn) > 1e-6) return null;
  return table.rows[ci]?.[hi] ?? null;
}

/** The worksheet as it reads before anything is entered into it. */
export function blankAssessment(standards: PtStandards, sex: Sex): BodyFatAssessment {
  const standard = standards.bodyFat?.bySex[sex] ?? null;
  return {
    standard,
    heightIn: null,
    measurements: (standard?.sites ?? []).map((site) => ({ site, raw: null, rounded: null })),
    circumference: null,
    percent: null,
    fromTable: false,
    result: null,
    need: null,
    crossCheck: null,
  };
}

/** "neck and abdomen", or "neck, natural waist and buttocks". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------

/** What the user entered for one component. */
export interface ComponentEntry {
  /** Which of the component's events they are being assessed on. */
  eventId: string;
  exempt: boolean;
  /** Reps, shuttles, or seconds, depending on the event. Null when blank. */
  value: number | null;
  /** Body composition only: height in inches. */
  heightIn?: number | null;
  /** Body composition only: the three waist measurements, in inches. */
  waists?: ReadonlyArray<number | null>;
}

export interface PtInput {
  age: number | null;
  sex: Sex;
  trackId: string;
  /** Keyed by component id. A missing key is treated as blank. */
  entries: Record<string, ComponentEntry>;
  /** Tier 2 tape measurements in inches, keyed by site id. */
  bodyFat?: Readonly<Record<string, number | null>>;
}

export type ComponentStatus =
  | 'empty'
  | 'exempt'
  | 'scored'
  | 'below-minimum'
  | 'pass'
  | 'fail';

export interface ComponentResult {
  componentId: string;
  label: string;
  event: EventDefinition;
  status: ComponentStatus;
  /** Points earned. Null unless status is 'scored' or 'below-minimum'. */
  points: number | null;
  /** Points this component put on the table. Zero when it does not count. */
  possible: number;
  /** Chart row the performance landed on, for highlighting. Null if none. */
  rowIndex: number | null;
  /** The component minimum in raw units, and how to show it. */
  minimum: number | null;
  minimumDisplay: string | null;
  /** Formatted points, or PASS / FAIL / EXEMPT. */
  display: string;
  /**
   * True on body composition when a passed Tier 2 assessment took it out of
   * the composite. The points still stand and are still shown; they simply no
   * longer count on either side of the division.
   */
  droppedByBfa?: boolean;
}

export type Rating =
  | 'excellent'
  | 'satisfactory'
  | 'unsatisfactory'
  | 'component-fail'
  | 'no-score';

export interface PtResult {
  ageGroup: AgeGroup | null;
  /** Null on a neutral track, or before a usable age is entered. */
  column: number | null;
  neutral: boolean;
  components: ComponentResult[];
  earned: number;
  possible: number;
  /** Null while any assessed component is still blank. */
  percent: number | null;
  rating: Rating | null;
  /** True while something still has to be filled in. */
  incomplete: boolean;
  waist: number | null;
  whtr: number | null;
  riskLabel: string | null;
  bfa: BfaOutcome;
  notes: string[];
}

/** Whether a Tier 2 assessment is required here, and what it did to the score. */
export interface BfaOutcome {
  /**
   * The AFMAN condition: ratio over the threshold AND the assessment not met.
   * This is what makes the tape count towards the composite.
   */
  required: boolean;
  /**
   * Whether the worksheet is open for use.
   *
   * Wider than `required` on purpose. Anyone who has not met the assessment can
   * be taped, and the number is worth having in front of you at that point even
   * when the ratio is under the threshold and the result cannot change the
   * score. The source PDF locks the worksheet in that case; we open it and say
   * plainly that it does not count. See `effect`.
   */
  available: boolean;
  /** Why it is or is not required, in the source's own terms. */
  requirement: string;
  assessment: BodyFatAssessment;
  /** What the assessment did to the composite. */
  effect: string;
}

function formatPoints(points: number): string {
  return points.toFixed(1);
}

/** How a raw value in this event's units is displayed. */
export function formatValue(event: EventDefinition, value: number): string {
  return event.input === 'time' ? formatTime(value) : String(value);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The 2 km walk maximum for this person, in seconds. */
export function walkMaxSeconds(
  standards: PtStandards,
  event: EventDefinition,
  age: number,
  sex: Sex,
): number | null {
  const limits = standards.limitTables[event.limits ?? ''];
  if (!limits) return null;
  return limits.bySex[sex]?.[bracketIndex(limits.ageGroups, age)] ?? null;
}

function scoreTableEvent(
  standards: PtStandards,
  component: ComponentDefinition,
  event: EventDefinition,
  entry: ComponentEntry,
  column: number | null,
  notes: string[],
): ComponentResult {
  const values = standardsColumn(standards, event.table!, column);
  const ladder = standards.pointLadders[component.ladder!] ?? [];
  const minimum = values.length > 0 ? values[values.length - 1]! : null;
  const minimumDisplay = minimum === null ? null : formatValue(event, minimum);

  const base = {
    componentId: component.id,
    label: component.label,
    event,
    minimum,
    minimumDisplay,
  };

  if (entry.value === null) {
    return { ...base, status: 'empty', points: null, possible: 0, rowIndex: null, display: '' };
  }

  const row = rowFor(values, entry.value, event.better ?? 'higher');
  if (row < 0) {
    notes.push(
      event.better === 'lower'
        ? `${component.label}: slower than the ${minimumDisplay} minimum.`
        : `${component.label}: under the ${minimumDisplay} ${event.unit ?? ''} minimum.`.replace(
            /\s+\./,
            '.',
          ),
    );
    return {
      ...base,
      status: 'below-minimum',
      points: 0,
      possible: component.maxPoints,
      rowIndex: null,
      display: formatPoints(0),
    };
  }

  const points = ladder[row] ?? 0;
  return {
    ...base,
    status: 'scored',
    points,
    possible: component.maxPoints,
    rowIndex: row,
    display: formatPoints(points),
  };
}

function scorePassFailEvent(
  standards: PtStandards,
  component: ComponentDefinition,
  event: EventDefinition,
  entry: ComponentEntry,
  age: number,
  sex: Sex,
  notes: string[],
): ComponentResult {
  const max = walkMaxSeconds(standards, event, age, sex);
  const base = {
    componentId: component.id,
    label: component.label,
    event,
    minimum: max,
    minimumDisplay: max === null ? null : `${formatTime(max)} (pass/fail)`,
    rowIndex: null,
    points: null,
  };
  if (event.note) notes.push(event.note);

  if (entry.value === null || max === null) {
    return { ...base, status: 'empty', possible: 0, display: '' };
  }
  if (entry.value <= max) {
    // A pass earns no points and puts none on the table, so the composite is
    // prorated exactly as it would be for an exemption.
    return { ...base, status: 'pass', possible: 0, display: 'PASS' };
  }
  notes.push(`Walk over the ${formatTime(max)} maximum.`);
  return { ...base, status: 'fail', possible: 0, display: 'FAIL' };
}

function scoreRatioComponent(
  component: ComponentDefinition,
  event: EventDefinition,
  entry: ComponentEntry,
  notes: string[],
): { result: ComponentResult; waist: number | null; whtr: number | null; risk: string | null } {
  const { waist, notes: waistNotes } = averageWaist(entry.waists ?? []);
  notes.push(...waistNotes);
  const height = entry.heightIn ?? null;

  const base = {
    componentId: component.id,
    label: component.label,
    event,
    minimum: null,
    minimumDisplay: null,
  };

  if (waist === null || height === null || height <= 0) {
    return {
      result: { ...base, status: 'empty', points: null, possible: 0, rowIndex: null, display: '' },
      waist,
      whtr: null,
      risk: null,
    };
  }

  const ratio = waistToHeightRatio(waist, height);
  const row = ratioRow(component, ratio);
  const points = component.ladderRows?.[row]?.points ?? 0;
  if (points === 0) {
    notes.push(`Waist-to-height ratio ${ratio.toFixed(2)} scores 0 points.`);
  }
  return {
    result: {
      ...base,
      status: 'scored',
      points,
      possible: component.maxPoints,
      rowIndex: row,
      display: formatPoints(points),
    },
    waist,
    whtr: ratio,
    risk: riskLabel(component, ratio),
  };
}

/**
 * Scores one assessment.
 *
 * The composite is prorated over the components actually assessed: an exempt
 * component, and a passed walk, drop out of both the points earned and the
 * points possible rather than counting as zero. A component scored at zero is
 * a different thing entirely and fails the whole assessment.
 */
export function score(standards: PtStandards, input: PtInput): PtResult {
  const notes: string[] = [];
  const track = standards.tracks.find((t) => t.id === input.trackId) ?? standards.tracks[0]!;
  const neutral = track.neutral;

  const ageOk =
    input.age !== null &&
    Number.isFinite(input.age) &&
    input.age >= standards.ageRange.min &&
    input.age <= standards.ageRange.max;
  const age = ageOk ? input.age! : null;

  const ageGroup = age === null ? null : standards.ageGroups[bracketIndex(standards.ageGroups, age)]!;
  const column = neutral || age === null ? null : columnFor(standards, age, input.sex);

  // Without an age there is no column to read, so nothing can be scored. On a
  // neutral track the tables are readable, but the walk maximum still is not.
  if (age === null && !neutral) {
    return {
      ageGroup: null,
      column: null,
      neutral,
      components: [],
      earned: 0,
      possible: 0,
      percent: null,
      rating: null,
      incomplete: true,
      waist: null,
      whtr: null,
      riskLabel: null,
      bfa: {
        required: false,
        available: false,
        requirement: 'Complete the assessment above first',
        // The worksheet still reads back what has been typed into it; only
        // whether it is required has to wait for an age.
        assessment: assessBodyFat(
          standards,
          input.sex,
          input.entries[standards.components.find((c) => c.kind === 'ratio')?.id ?? '']
            ?.heightIn ?? null,
          input.bodyFat ?? {},
        ),
        effect: 'Complete the assessment above first.',
      },
      notes: ['Enter your age to load your chart.'],
    };
  }

  const results: ComponentResult[] = [];
  let waist: number | null = null;
  let whtr: number | null = null;
  let risk: string | null = null;
  // The ratio component owns the height the tape assessment also needs.
  let bodyComponentId: string | null = null;
  let bodyHeight: number | null = null;

  for (const component of standards.components) {
    const entry = input.entries[component.id];
    const event =
      component.events.find((e) => e.id === entry?.eventId) ?? component.events[0]!;

    if (entry?.exempt) {
      if (component.kind === 'ratio') {
        bodyComponentId = component.id;
        bodyHeight = entry.heightIn ?? null;
      }
      results.push({
        componentId: component.id,
        label: component.label,
        event,
        status: 'exempt',
        points: null,
        possible: 0,
        rowIndex: null,
        minimum: null,
        minimumDisplay: null,
        display: 'EXEMPT',
      });
      continue;
    }

    const useEntry: ComponentEntry = entry ?? { eventId: event.id, exempt: false, value: null };

    if (component.kind === 'ratio') {
      bodyComponentId = component.id;
      bodyHeight = useEntry.heightIn ?? null;
      const scored = scoreRatioComponent(component, event, useEntry, notes);
      results.push(scored.result);
      waist = scored.waist;
      whtr = scored.whtr;
      risk = scored.risk;
      continue;
    }
    if (event.kind === 'passFail') {
      results.push(
        age === null
          ? {
              componentId: component.id,
              label: component.label,
              event,
              status: 'empty',
              points: null,
              possible: 0,
              rowIndex: null,
              minimum: null,
              minimumDisplay: null,
              display: '',
            }
          : scorePassFailEvent(standards, component, event, useEntry, age, input.sex, notes),
      );
      continue;
    }
    results.push(scoreTableEvent(standards, component, event, useEntry, column, notes));
  }

  const incomplete = results.some((r) => r.status === 'empty');
  const walkPassed = results.some((r) => r.status === 'pass' && r.event.excludesExcellent);
  let componentFail = results.some(
    (r) => r.status === 'fail' || (r.status === 'below-minimum' && r.points === 0),
  );
  let exemptCount = results.filter((r) => r.status === 'exempt').length;

  // Body composition is held aside rather than summed with the rest, because a
  // passed Tier 2 assessment takes it out of the composite after the fact --
  // and whether one is required depends on the score it would otherwise have.
  const bodyResult = results.find((r) => r.componentId === bodyComponentId) ?? null;
  const bodyExempt = bodyResult?.status === 'exempt';
  const others = results.filter((r) => r !== bodyResult);

  let earned = others.reduce((sum, r) => sum + (r.points ?? 0), 0);
  let possible = others.reduce((sum, r) => sum + r.possible, 0);
  let bodyPoints = bodyResult?.points ?? 0;
  let bodyPossible = bodyResult?.possible ?? 0;

  const threshold = standards.rating.tier2BfaRatioOver;
  const assessment = assessBodyFat(standards, input.sex, bodyHeight, input.bodyFat ?? {});

  // The provisional score decides whether a Tier 2 assessment is called for:
  // it is required only when the assessment would otherwise not be met.
  const provisionalPossible = possible + bodyPossible;
  const provisional =
    provisionalPossible > 0 ? ((earned + bodyPoints) / provisionalPossible) * 100 : null;
  const provisionalUnsat =
    componentFail || (provisional !== null && provisional < standards.rating.passMinPercent);

  const bfaRequired =
    !bodyExempt && whtr !== null && whtr > threshold && provisionalUnsat && !incomplete;

  /**
   * The worksheet is open to anyone who has not met the assessment.
   *
   * The source PDF opens it only when it is required, which means a member who
   * failed with a ratio under the threshold cannot be taped at all. Being taped
   * is the useful thing to do at that point even when the result cannot move
   * the score, so the gate here is "not met" and the narrower AFMAN condition
   * governs whether it counts.
   */
  const bfaAvailable = !bodyExempt && !incomplete && provisionalUnsat;
  const reported = bfaAvailable ? assessment : blankAssessment(standards, input.sex);

  let effect = 'No Tier 2 body fat assessment is required by the entries above.';
  if (bfaAvailable && !bfaRequired) {
    effect =
      assessment.result === null
        ? `The assessment was not met, so the tape measurements are available here. They do not change the score: a Tier 2 assessment only counts when the waist-to-height ratio is over ${threshold.toFixed(2)}.`
        : `Recorded for reference only. The ratio is not over ${threshold.toFixed(2)}, so this result does not change the score (para 3.7.2).`;
  }
  if (bfaRequired && assessment.result === 'pass') {
    // Para 3.7.2: a passed assessment scores body composition as an exempt
    // component, which drops it from both sides of the division.
    bodyPoints = 0;
    bodyPossible = 0;
    // Scored as an exempt component (para 3.7.2), but NOT an exemption: a
    // PFRA hold follows an AF Form 469 (para 3.9), and a met body fat
    // assessment is not one. The source PDF counts it and so warns about a
    // hold that does not apply.
    if (bodyResult) bodyResult.droppedByBfa = true;
    effect =
      'Body fat assessment met — body composition is scored as an exempt component and the composite is recalculated (para 3.7.2).';
    notes.push('Body fat assessment met — body composition scored as an exempt component (para 3.7.2).');
  } else if (bfaRequired && assessment.result === 'fail') {
    componentFail = true;
    effect =
      'Body fat assessment not met — the assessment is unsatisfactory regardless of points (para 3.7.2).';
    notes.push('Body fat assessment not met — unsatisfactory PFRA (para 3.7.2).');
  } else if (bfaRequired) {
    effect = 'Tier 2 body fat assessment required — enter the tape measurements.';
    notes.push(
      `Waist-to-height ratio over ${threshold.toFixed(2)} with an unsatisfactory score: Tier 2 body fat assessment required.`,
    );
  }

  if (bodyResult) bodyResult.possible = bodyPossible;
  earned += bodyPoints;
  possible += bodyPossible;

  let percent: number | null = null;
  let rating: Rating | null = null;

  if (incomplete) {
    notes.unshift('Fill every box for a composite score.');
  } else if (possible === 0) {
    rating = 'no-score';
    notes.push('Every component is exempt — there is no composite to score.');
  } else {
    percent = (earned / possible) * 100;
    if (componentFail) rating = 'component-fail';
    else if (percent < standards.rating.passMinPercent) rating = 'unsatisfactory';
    else if (walkPassed) rating = 'satisfactory';
    else if (percent < standards.rating.excellentMinPercent) rating = 'satisfactory';
    else rating = 'excellent';

    if (possible < 100) {
      notes.unshift(
        `Scored on ${possible} of 100 possible points (${earned.toFixed(1)}/${possible} × 100).` +
          (walkPassed ? ' The walk passed, so cardio is not scored and Excellent is unavailable.' : ''),
      );
    }
  }

  if (exemptCount > 0) {
    notes.push('Exemptions normally mean a PFRA hold — confirm your ALC status with your UFPM.');
  }

  const requirement = bodyExempt
    ? 'Body composition is exempt'
    : whtr === null || incomplete
      ? 'Complete the assessment above first'
      : bfaRequired
        ? `Yes — waist-to-height ratio over ${threshold.toFixed(2)} and the assessment was not met`
        : whtr > threshold
          ? 'No — high risk, but the assessment was met'
          : provisionalUnsat
            ? `No — the assessment was not met, but the ratio is not over ${threshold.toFixed(2)}`
            : 'No';

  return {
    ageGroup,
    column,
    neutral,
    components: results,
    earned,
    possible,
    percent,
    rating,
    incomplete,
    waist,
    whtr,
    riskLabel: risk,
    bfa: {
      required: bfaRequired,
      available: bfaAvailable,
      requirement,
      assessment: reported,
      effect,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export interface ChartRow {
  /**
   * The band of performances that score this row, formatted.
   *
   * The top row is open-ended (">= 67"), the rest are the span between this
   * row's threshold and the next better row's ("65-64", or a single value
   * where only one performance falls between them).
   */
  value: string;
  points: string;
  /** True on the last row: the component minimum. */
  isMinimum: boolean;
}

/**
 * The scoring chart for one event, as the user's own column of it.
 *
 * This is the part of the PDF worth keeping most: seeing the whole ladder,
 * with your row marked, is what tells you how many more reps buy a point.
 */
export function chartFor(
  standards: PtStandards,
  component: ComponentDefinition,
  event: EventDefinition,
  column: number | null,
): ChartRow[] {
  if (event.kind !== 'table') return [];
  const values = standardsColumn(standards, event.table!, column);
  const ladder = standards.pointLadders[component.ladder!] ?? [];
  const lower = event.better === 'lower';
  const marker = lower ? '≤' : '≥';
  const show = (v: number) => formatValue(event, v);

  return values.map((value, i) => {
    // The top row is everything at or beyond the best threshold.
    if (i === 0) {
      return {
        value: `${marker} ${show(value)}`,
        points: formatPoints(ladder[0] ?? 0),
        isMinimum: values.length === 1,
      };
    }
    // Every other row runs from its own threshold to just short of the row
    // above it, which is exactly the set of performances the row search sends
    // here. Showing the band rather than the threshold answers the question a
    // user actually has: how many more buys the next half point.
    const previous = values[i - 1]!;
    // One step past the row above: worse by one rep, or slower by one second.
    const edge = lower ? previous + 1 : previous - 1;
    // A degenerate span means only one performance scores this row -- or, where
    // two rows share a threshold, that none does. Show the threshold alone
    // rather than an inverted range.
    const single = lower ? edge >= value : edge <= value;
    return {
      value: single ? show(value) : `${show(edge)}–${show(value)}`,
      points: formatPoints(ladder[i] ?? 0),
      isMinimum: i === values.length - 1,
    };
  });
}

/** The body-composition ladder, in the same shape as `chartFor`. */
export function ratioChart(component: ComponentDefinition): ChartRow[] {
  return (component.ladderRows ?? []).map((row, i, all) => ({
    value: row.label,
    points: formatPoints(row.points),
    isMinimum: i === all.length - 1,
  }));
}
