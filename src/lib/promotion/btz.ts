import type {
  BtzCheck,
  GradeDefinition,
  PromotionPath,
  PromotionRule,
  PromotionStandards,
} from '../data/types';
import {
  addMonths,
  compare,
  describeGap,
  earliest,
  formatDate,
  formatMonth,
  isBefore,
  latest,
  monthName,
  type CivilDate,
} from './dates';

/**
 * Below-the-zone projection.
 *
 * Pure and deterministic: it takes the rules, the member's dates, and the day
 * it is being run on, and returns the same answer every time. Nothing in here
 * knows that the threshold is 36 months, that BTZ is six months early, or that
 * boards sit in March, June, September and December -- all of that is read out
 * of a `PromotionRule`. Changing the instruction is a data edit.
 *
 * Two things this deliberately will not do.
 *
 * It will not project from a grade below the one BTZ is considered from. An
 * Airman's A1C date of rank is set by technical training, by an advanced
 * enlistment, or by an adjustment for previous service, and guessing it from
 * the date they entered active duty would produce a confident wrong date --
 * which is worse than no date. It says what it needs instead.
 *
 * It will not say anyone is eligible. It projects a consideration window and a
 * promotion date if selected. Eligibility carries conditions this tool cannot
 * see, and selection is a board's decision.
 */

export interface BtzInput {
  /** Date entered active duty. Drives every time-in-service bound. */
  enteredActiveDuty: CivilDate | null;
  gradeId: string;
  /** Date of rank in the grade currently held. */
  dateOfRank: CivilDate | null;
  /** Attested answers, keyed by check id. `null` is "not answered". */
  answers: Record<string, boolean | null>;
  /** Injected rather than read from the clock, so results stay reproducible. */
  today: CivilDate;
}

/**
 * One route to the fully-qualified promotion, worked out.
 *
 * Both dates are kept, not just the later one, because the whole point of the
 * "why this date" readout is showing which bound actually binds -- a supervisor
 * looking at "36 months TIS with 20 months TIG" wants to see that it is the TIS
 * half doing the work.
 */
export interface PathResult {
  path: PromotionPath;
  /** When the time-in-service bound is met. Null when the path has none. */
  tisDate: CivilDate | null;
  /** When the time-in-grade bound is met. Null when the path has none. */
  tigDate: CivilDate | null;
  /** The later of the two: when this path is satisfied. */
  date: CivilDate | null;
  /** Which of the two bounds is the later one, and so sets the path's date. */
  binds: 'tis' | 'tig' | null;
  /** True on the path that produces the promotion date. */
  governing: boolean;
}

export type CheckState = 'pass' | 'fail' | 'unanswered';

export interface CheckResult {
  check: BtzCheck;
  state: CheckState;
  /** The line to print: the pass, fail, or unanswered text from the data. */
  message: string;
}

export interface CycleResult {
  id: string;
  /** The months packages are processed in, and the year they fall in. */
  processing: { year: number; months: number[] };
  selection: { year: number; month: number };
  /** The quarter the promotion itself lands in. */
  window: { year: number; months: number[] };
}

export interface Milestone {
  id: string;
  label: string;
  detail?: string;
  /** Sort key. Month-granular milestones sit on the first of their month. */
  at: CivilDate;
  /** What is printed: an exact date, a month, or a month range. */
  display: string;
  /** The BTZ promotion itself, which the rail marks out from the rest. */
  emphasis?: boolean;
  /**
   * The host wing sets its own nomination timeline and board procedures, so
   * anything derived from the cycle is labelled as subject to local variation.
   */
  local?: boolean;
  past: boolean;
}

export type BtzStatus =
  /** Not enough entered yet. */
  | 'incomplete'
  /** The member is junior to the grade BTZ is considered from. */
  | 'awaiting-grade'
  /** The member is already senior to it. */
  | 'not-applicable'
  /** A required check failed. Dates are still shown, greyed, with the reason. */
  | 'blocked'
  /** A projection exists. */
  | 'projected';

export interface BtzResult {
  status: BtzStatus;
  rule: PromotionRule;
  grade: GradeDefinition | null;
  paths: PathResult[];
  /** The fully-qualified promotion date: the earliest date any path allows. */
  fullyQualifiedDate: CivilDate | null;
  btzDate: CivilDate | null;
  monthsEarly: number;
  cycle: CycleResult | null;
  timeline: Milestone[];
  checks: CheckResult[];
  /** What still has to be entered. Empty once the projection is complete. */
  missing: string[];
  /** Advisories: things that change the answer but are not the answer. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function resolvePath(path: PromotionPath, input: BtzInput): PathResult {
  const tisDate =
    path.tisMonths !== null && input.enteredActiveDuty !== null
      ? addMonths(input.enteredActiveDuty, path.tisMonths)
      : null;
  const tigDate =
    path.tigMonths !== null && input.dateOfRank !== null
      ? addMonths(input.dateOfRank, path.tigMonths)
      : null;

  // A path is satisfied only once ALL of its bounds are, so it resolves to the
  // later of them -- and only when every bound it declares has a date.
  const wanted = (path.tisMonths === null ? 0 : 1) + (path.tigMonths === null ? 0 : 1);
  const have = [tisDate, tigDate].filter((d): d is CivilDate => d !== null);
  const date = have.length === wanted ? latest(have) : null;

  let binds: PathResult['binds'] = null;
  if (date !== null) binds = tisDate !== null && compare(tisDate, date) === 0 ? 'tis' : 'tig';

  return { path, tisDate, tigDate, date, binds, governing: false };
}

/** The cycle whose promotion quarter contains `date`. */
function resolveCycle(rule: PromotionRule, date: CivilDate): CycleResult | null {
  const cycle = rule.btz?.cycles.find((c) => c.promotionMonths.includes(date.month));
  if (!cycle) return null;
  const leadYear = date.year + cycle.leadYearOffset;
  return {
    id: cycle.id,
    processing: { year: leadYear, months: cycle.processingMonths },
    selection: { year: leadYear, month: cycle.selectionMonth },
    window: { year: date.year, months: cycle.promotionMonths },
  };
}

/** "OCT – NOV 2027", or "DEC 2027" for a single month. */
export function monthRange(year: number, months: number[]): string {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  return first === last
    ? formatMonth(year, first)
    : `${monthName(first)} – ${monthName(last)} ${year}`;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function evaluateCheck(
  check: BtzCheck,
  input: BtzInput,
  rule: PromotionRule,
  btzDate: CivilDate | null,
): CheckResult {
  let state: CheckState;

  if (check.kind === 'computed') {
    // Only two predicates exist, and the loader refuses any other name.
    const passed =
      check.check === 'grade' ? input.gradeId === rule.fromGrade : btzDate !== null;
    state = passed ? 'pass' : 'fail';
  } else {
    const answer = input.answers[check.id];
    // Unanswered is its own state, never a silent pass. Quick mode asks none of
    // these, so treating a blank as "yes" would manufacture an eligibility
    // finding nobody claimed.
    state = answer === null || answer === undefined ? 'unanswered' : answer === check.desired ? 'pass' : 'fail';
  }

  const message =
    state === 'pass' ? check.pass : state === 'fail' ? check.fail : (check.unanswered ?? check.question ?? '');
  return { check, state, message };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export function project(
  standards: PromotionStandards,
  rule: PromotionRule,
  input: BtzInput,
): BtzResult {
  const btz = rule.btz;
  if (!btz) throw new Error(`promotion rule "${rule.id}" has no below-the-zone programme`);

  const grade = standards.grades.find((g) => g.id === input.gradeId) ?? null;
  const fromGrade = standards.grades.find((g) => g.id === rule.fromGrade)!;
  const toGrade = standards.grades.find((g) => g.id === rule.toGrade)!;

  const notes: string[] = [];
  const missing: string[] = [];

  // Grade gates the whole calculation. A date of rank means something different
  // in each grade, so a projection is only attempted from the right one.
  const onGrade = grade !== null && grade.id === fromGrade.id;
  const senior = grade !== null && grade.order > fromGrade.order;
  const junior = grade !== null && grade.order < fromGrade.order;

  const usable = onGrade;
  const paths = rule.paths.map((path) =>
    resolvePath(path, usable ? input : { ...input, enteredActiveDuty: null, dateOfRank: null }),
  );

  const resolved = paths.filter((p): p is PathResult & { date: CivilDate } => p.date !== null);
  const complete = usable && resolved.length === paths.length;
  const fullyQualifiedDate = complete ? earliest(resolved.map((p) => p.date)) : null;

  if (fullyQualifiedDate !== null) {
    // Mark every path that lands on the governing date, not just the first --
    // two paths can coincide, and showing one of them as decisive would be
    // arbitrary.
    for (const path of paths) {
      path.governing = path.date !== null && compare(path.date, fullyQualifiedDate) === 0;
    }
  }

  const btzDate =
    fullyQualifiedDate === null ? null : addMonths(fullyQualifiedDate, -btz.monthsEarly);
  const cycle = btzDate === null ? null : resolveCycle(rule, btzDate);

  // ---- What is still needed -----------------------------------------------
  if (onGrade) {
    if (input.enteredActiveDuty === null) missing.push('Date entered active duty');
    if (input.dateOfRank === null) missing.push(`${fromGrade.abbr} date of rank`);
  }

  // ---- Advisories ----------------------------------------------------------
  if (junior) {
    notes.push(
      `BTZ is considered from ${fromGrade.abbr}. A ${grade!.label}'s date of rank does not ` +
        `set the ${fromGrade.abbr} one, which is fixed by technical training, by an advanced ` +
        `enlistment, or by an adjustment for previous service. Enter it once it is assigned.`,
    );

    // The phase points on the way up, when the data carries them. Context for
    // roughly when the date of rank will exist -- deliberately not turned into
    // a projected BTZ date, because each step has its own exceptions.
    const route = standards.promotions.find((p) => p.toGrade === fromGrade.id);
    const priorGrade = route && standards.grades.find((g) => g.id === route.fromGrade);
    if (route && priorGrade) {
      notes.push(
        `Phase point to ${fromGrade.abbr}: ${route.paths.map((p) => p.label).join(', or ')} ` +
          `from ${priorGrade.abbr}. Technical training, an advanced enlistment, or a six-year ` +
          `enlistment each move it, so it is context rather than a projection.`,
      );
    }
  }
  if (senior) {
    notes.push(
      `Already ${grade!.abbr}. BTZ is a consideration for ${fromGrade.abbr} before the ` +
        `fully qualified promotion to ${toGrade.abbr}.`,
    );
  }
  if (
    input.enteredActiveDuty !== null &&
    input.dateOfRank !== null &&
    isBefore(input.dateOfRank, input.enteredActiveDuty)
  ) {
    notes.push(
      'The date of rank is earlier than the date entered active duty. That happens with a ' +
        'break in service, but check both entries -- and note that a date of rank adjusted ' +
        'for previous service can rule BTZ out entirely.',
    );
  }
  if (btzDate !== null && isBefore(btzDate, input.today)) {
    notes.push(
      `The projected BTZ promotion date has passed (${describeGap(btzDate, input.today)}). ` +
        'These dates are historical, not a forecast.',
    );
  }
  for (const note of btz.notes) notes.push(note);

  // ---- Checks --------------------------------------------------------------
  const checks = btz.checks.map((check) => evaluateCheck(check, input, rule, btzDate));
  const blocked = checks.some((c) => c.check.mode === 'require' && c.state === 'fail' && c.check.kind === 'attested');

  // ---- Status --------------------------------------------------------------
  let status: BtzStatus;
  if (senior) status = 'not-applicable';
  else if (junior) status = 'awaiting-grade';
  else if (btzDate === null) status = 'incomplete';
  else if (blocked) status = 'blocked';
  else status = 'projected';

  return {
    status,
    rule,
    grade,
    paths,
    fullyQualifiedDate,
    btzDate,
    monthsEarly: btz.monthsEarly,
    cycle,
    timeline: buildTimeline(input, cycle, btzDate, fullyQualifiedDate, toGrade),
    checks,
    missing,
    notes,
  };
}

/**
 * The supervisor's view: everything that has to happen, in the order it
 * happens, with today marked so the next thing to do is the next thing down.
 */
function buildTimeline(
  input: BtzInput,
  cycle: CycleResult | null,
  btzDate: CivilDate | null,
  fullyQualifiedDate: CivilDate | null,
  toGrade: GradeDefinition,
): Milestone[] {
  if (btzDate === null || fullyQualifiedDate === null) return [];

  const firstOf = (year: number, month: number): CivilDate => ({ year, month, day: 1 });
  const items: Omit<Milestone, 'past'>[] = [
    {
      id: 'today',
      label: 'Today',
      at: input.today,
      display: formatDate(input.today),
    },
  ];

  if (cycle) {
    items.push(
      {
        id: 'processing',
        label: 'BTZ processing',
        detail:
          'The consideration window. Packages are built and nominations made inside it; ' +
          'the unit suspense is set locally and is usually earlier.',
        at: firstOf(cycle.processing.year, cycle.processing.months[0]!),
        display: monthRange(cycle.processing.year, cycle.processing.months),
        local: true,
      },
      {
        id: 'selection',
        label: 'Selection board',
        detail: 'Board procedures are established by the host wing or installation.',
        at: firstOf(cycle.selection.year, cycle.selection.month),
        display: formatMonth(cycle.selection.year, cycle.selection.month),
        local: true,
      },
      {
        id: 'window',
        label: 'BTZ promotion window',
        detail: 'The quarter this cycle’s selectees are promoted in.',
        at: firstOf(cycle.window.year, cycle.window.months[0]!),
        display: monthRange(cycle.window.year, cycle.window.months),
      },
    );
  }

  items.push(
    {
      id: 'btz',
      label: `Projected BTZ promotion to ${toGrade.abbr}`,
      detail: 'If selected.',
      at: btzDate,
      display: formatDate(btzDate),
      emphasis: true,
    },
    {
      id: 'fully-qualified',
      label: `Fully qualified promotion to ${toGrade.abbr}`,
      detail: 'The date reached without BTZ.',
      at: fullyQualifiedDate,
      display: formatDate(fullyQualifiedDate),
    },
  );

  return items
    .sort((a, b) => compare(a.at, b.at))
    .map((item) => ({ ...item, past: item.id !== 'today' && isBefore(item.at, input.today) }));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** The plain-text copy of a projection. Same wording the page shows. */
export function summarize(result: BtzResult, standards: PromotionStandards): string {
  const grade = result.grade?.abbr ?? '—';
  const lines = [
    `BTZ PROJECTION — ${standards.label}`,
    `${standards.component} · ${grade}`,
    '',
  ];

  if (result.btzDate === null) {
    lines.push('No projection yet.');
    for (const item of result.missing) lines.push(`- Needs: ${item}`);
  } else {
    lines.push(
      `Projected BTZ promotion, if selected: ${formatDate(result.btzDate)}`,
      `Fully qualified promotion: ${formatDate(result.fullyQualifiedDate!)}`,
      `Advance: ${result.monthsEarly} months`,
      '',
      'Why this date:',
      ...result.paths.map((p) => {
        const date = p.date === null ? '—' : formatDate(p.date);
        return `  ${p.governing ? '>' : ' '} ${p.path.label}: ${date}`;
      }),
    );
    for (const item of result.timeline.filter((m) => m.id !== 'today')) {
      if (item.id === 'processing') lines.push('', 'Timeline:');
      if (item.id !== 'btz' && item.id !== 'fully-qualified') {
        lines.push(`  ${item.display} — ${item.label}${item.local ? ' (local timeline may differ)' : ''}`);
      }
    }
  }

  const flagged = result.checks.filter((c) => c.state !== 'pass');
  if (flagged.length > 0) {
    lines.push('', 'Check:');
    for (const c of flagged) lines.push(`  - ${c.check.label}: ${c.message}`);
  }

  lines.push(
    '',
    'Projected dates only. Not an eligibility determination and not a selection.',
    'Official guidance and the servicing MPF govern.',
  );
  return lines.join('\n');
}
