import { loadDataset } from './loader';
import {
  DataFileError,
  type BtzCheck,
  type BtzCycle,
  type BtzRules,
  type Dataset,
  type GradeDefinition,
  type PromotionPath,
  type PromotionRule,
  type PromotionStandards,
} from './types';

import afi362502 from '../../data/promotion/afi36-2502.json';

/**
 * Enlisted promotion rules.
 *
 * Third use of `loadDataset` and it still needs nothing from it: meta
 * validation, stub handling and provenance stamping come for free, and this
 * file supplies only the `normalize` that enforces this payload's invariants.
 *
 * The invariants worth enforcing here are the ones whose violation produces a
 * plausible wrong date rather than a crash:
 *
 *   - the four cycles' promotion months must tile the calendar year exactly
 *     once, or an Airman's board lands in the wrong quarter;
 *   - a cycle's promotion months must be contiguous, since the tool prints them
 *     as a range;
 *   - every path must constrain something, or it is satisfied instantly;
 *   - a computed check must name a predicate the engine actually has.
 */

const RAW_STANDARDS: ReadonlyArray<readonly [string, unknown]> = [
  ['src/data/promotion/afi36-2502.json', afi362502],
];

function obj(file: string, raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DataFileError(file, `${what} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function str(file: string, o: Record<string, unknown>, key: string, what: string): string {
  const value = o[key];
  if (typeof value !== 'string' || value === '') {
    throw new DataFileError(file, `${what} ${key} must be a non-empty string`);
  }
  return value;
}

function num(file: string, o: Record<string, unknown>, key: string, what: string): number {
  const value = o[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataFileError(file, `${what} ${key} must be a finite number`);
  }
  return value;
}

/** A month count that may be absent: a positive integer, or null. */
function months(file: string, o: Record<string, unknown>, key: string, what: string): number | null {
  const value = o[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DataFileError(file, `${what} ${key} must be a positive whole number of months, or null`);
  }
  return value;
}

function monthList(file: string, raw: unknown, what: string): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DataFileError(file, `${what} must be a non-empty array of months`);
  }
  return raw.map((m, i) => {
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new DataFileError(file, `${what}[${i}] must be a month number 1-12`);
    }
    return m;
  });
}

function stringList(file: string, raw: unknown, what: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new DataFileError(file, `${what} must be an array of strings`);
  return raw.map((s, i) => {
    if (typeof s !== 'string' || s === '') {
      throw new DataFileError(file, `${what}[${i}] must be a non-empty string`);
    }
    return s;
  });
}

function normalizeGrades(file: string, raw: unknown): GradeDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DataFileError(file, 'data.grades must be a non-empty array');
  }
  const grades = raw.map((g, i) => {
    const o = obj(file, g, `grades[${i}]`);
    return {
      id: str(file, o, 'id', `grades[${i}]`),
      abbr: str(file, o, 'abbr', `grades[${i}]`),
      label: str(file, o, 'label', `grades[${i}]`),
      order: num(file, o, 'order', `grades[${i}]`),
    };
  });

  const ids = new Set<string>();
  for (const grade of grades) {
    if (ids.has(grade.id)) throw new DataFileError(file, `grades: duplicate id "${grade.id}"`);
    ids.add(grade.id);
  }
  // Seniority is compared numerically all over the engine, so two grades
  // sharing an order, or an out-of-sequence list, would make "already past this
  // grade" answer wrongly.
  grades.forEach((g, i) => {
    if (i > 0 && g.order <= grades[i - 1]!.order) {
      throw new DataFileError(
        file,
        `grades must be listed in ascending order; "${grades[i - 1]!.abbr}" then "${g.abbr}" are not`,
      );
    }
  });
  return grades;
}

function normalizePath(file: string, raw: unknown, what: string): PromotionPath {
  const o = obj(file, raw, what);
  const tisMonths = months(file, o, 'tisMonths', what);
  const tigMonths = months(file, o, 'tigMonths', what);
  if (tisMonths === null && tigMonths === null) {
    // A path with no bounds is met the day someone enters the Air Force.
    throw new DataFileError(file, `${what} must set tisMonths, tigMonths, or both`);
  }
  const label = str(file, o, 'label', what);
  return {
    id: str(file, o, 'id', what),
    label,
    shortLabel: typeof o.shortLabel === 'string' && o.shortLabel !== '' ? o.shortLabel : label,
    tisMonths,
    tigMonths,
  };
}

/**
 * Reads one cycle and derives its `leadYearOffset`.
 *
 * The offset is computed rather than authored, so the file cannot disagree with
 * itself: if the board sits in a month after the first promotion month, the
 * promotions must be in the following calendar year. That is the Oct/Nov cycle,
 * whose board is in December and whose promotions run January to March.
 */
function normalizeCycle(file: string, raw: unknown, index: number): BtzCycle {
  const what = `btz.cycles[${index}]`;
  const o = obj(file, raw, what);
  const processingMonths = monthList(file, o.processingMonths, `${what}.processingMonths`);
  const promotionMonths = monthList(file, o.promotionMonths, `${what}.promotionMonths`);
  const selectionMonth = num(file, o, 'selectionMonth', what);
  if (!Number.isInteger(selectionMonth) || selectionMonth < 1 || selectionMonth > 12) {
    throw new DataFileError(file, `${what}.selectionMonth must be a month number 1-12`);
  }

  // Printed as "APR - JUN", so a gap in the middle would be a lie.
  for (let i = 1; i < promotionMonths.length; i++) {
    if (promotionMonths[i] !== promotionMonths[i - 1]! + 1) {
      throw new DataFileError(file, `${what}.promotionMonths must be consecutive`);
    }
  }
  for (let i = 1; i < processingMonths.length; i++) {
    if (processingMonths[i] !== processingMonths[i - 1]! + 1) {
      throw new DataFileError(file, `${what}.processingMonths must be consecutive`);
    }
  }
  if (selectionMonth !== processingMonths[processingMonths.length - 1]! + 1) {
    throw new DataFileError(
      file,
      `${what}: the board month must follow the last processing month`,
    );
  }

  return {
    id: str(file, o, 'id', what),
    processingMonths,
    selectionMonth,
    promotionMonths,
    leadYearOffset: selectionMonth < promotionMonths[0]! ? 0 : -1,
  };
}

function normalizeCheck(file: string, raw: unknown, index: number): BtzCheck {
  const what = `btz.checks[${index}]`;
  const o = obj(file, raw, what);

  const kind = o.kind;
  if (kind !== 'computed' && kind !== 'attested') {
    throw new DataFileError(file, `${what}.kind must be computed or attested`);
  }
  const mode = o.mode;
  if (mode !== 'require' && mode !== 'advise') {
    throw new DataFileError(file, `${what}.mode must be require or advise`);
  }

  if (kind === 'computed') {
    const check = o.check;
    // The engine has exactly these two predicates. A data file naming a third
    // would otherwise render a check that silently never passes.
    if (check !== 'grade' && check !== 'window') {
      throw new DataFileError(
        file,
        `${what}.check must be one the engine implements: grade or window`,
      );
    }
  } else {
    if (typeof o.question !== 'string' || o.question === '') {
      throw new DataFileError(file, `${what} is attested and must carry a question`);
    }
    if (typeof o.desired !== 'boolean') {
      throw new DataFileError(file, `${what} is attested and must say which answer passes`);
    }
  }

  return {
    id: str(file, o, 'id', what),
    kind,
    mode,
    label: str(file, o, 'label', what),
    check: kind === 'computed' ? (o.check as BtzCheck['check']) : undefined,
    question: kind === 'attested' ? (o.question as string) : undefined,
    desired: kind === 'attested' ? (o.desired as boolean) : undefined,
    pass: str(file, o, 'pass', what),
    fail: str(file, o, 'fail', what),
    unanswered: typeof o.unanswered === 'string' ? o.unanswered : undefined,
    authority: typeof o.authority === 'string' ? o.authority : undefined,
  };
}

function normalizeBtz(file: string, raw: unknown): BtzRules {
  const o = obj(file, raw, 'btz');
  if (!Array.isArray(o.cycles) || o.cycles.length === 0) {
    throw new DataFileError(file, 'btz.cycles must be a non-empty array');
  }
  const cycles = o.cycles.map((c, i) => normalizeCycle(file, c, i));

  // The tiling check. Every month of the year belongs to exactly one cycle, or
  // a projected promotion date either matches two boards or matches none.
  const claimed = new Map<number, string>();
  for (const cycle of cycles) {
    for (const month of cycle.promotionMonths) {
      const owner = claimed.get(month);
      if (owner !== undefined) {
        throw new DataFileError(
          file,
          `btz.cycles: month ${month} is a promotion month for both "${owner}" and "${cycle.id}"`,
        );
      }
      claimed.set(month, cycle.id);
    }
  }
  const unclaimed = [];
  for (let month = 1; month <= 12; month++) if (!claimed.has(month)) unclaimed.push(month);
  if (unclaimed.length > 0) {
    throw new DataFileError(
      file,
      `btz.cycles: no cycle promotes in month${unclaimed.length === 1 ? '' : 's'} ${unclaimed.join(', ')}`,
    );
  }

  const monthsEarly = num(file, o, 'monthsEarly', 'btz');
  if (!Number.isInteger(monthsEarly) || monthsEarly <= 0) {
    throw new DataFileError(file, 'btz.monthsEarly must be a positive whole number of months');
  }

  if (!Array.isArray(o.checks) || o.checks.length === 0) {
    throw new DataFileError(file, 'btz.checks must be a non-empty array');
  }
  const checks = o.checks.map((c, i) => normalizeCheck(file, c, i));
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.id)) throw new DataFileError(file, `btz.checks: duplicate id "${check.id}"`);
    seen.add(check.id);
  }

  return {
    label: str(file, o, 'label', 'btz'),
    monthsEarly,
    cycles,
    checks,
    notes: stringList(file, o.notes, 'btz.notes'),
  };
}

/**
 * Exported so the integrity tests can feed it deliberately broken files, the
 * way the abbreviation loader's re-sort is proved against a scrambled one. A
 * loader that enforces an invariant is only worth having if something proves
 * it enforces it.
 */
export function normalizeStandards(
  raw: unknown,
  _meta: unknown,
  file: string,
): PromotionStandards {
  const o = obj(file, raw, 'data');
  const grades = normalizeGrades(file, o.grades);
  const gradeIds = new Set(grades.map((g) => g.id));

  if (!Array.isArray(o.promotions) || o.promotions.length === 0) {
    throw new DataFileError(file, 'data.promotions must be a non-empty array');
  }
  const promotions: PromotionRule[] = o.promotions.map((p, i) => {
    const what = `promotions[${i}]`;
    const po = obj(file, p, what);
    const fromGrade = str(file, po, 'fromGrade', what);
    const toGrade = str(file, po, 'toGrade', what);
    for (const [key, id] of [['fromGrade', fromGrade], ['toGrade', toGrade]] as const) {
      if (!gradeIds.has(id)) {
        throw new DataFileError(file, `${what}.${key} names unknown grade "${id}"`);
      }
    }
    if (!Array.isArray(po.paths) || po.paths.length === 0) {
      throw new DataFileError(file, `${what}.paths must be a non-empty array`);
    }
    return {
      id: str(file, po, 'id', what),
      label: str(file, po, 'label', what),
      fromGrade,
      toGrade,
      paths: po.paths.map((path, j) => normalizePath(file, path, `${what}.paths[${j}]`)),
      btz: po.btz === undefined ? undefined : normalizeBtz(file, po.btz),
    };
  });

  return {
    id: str(file, o, 'id', 'data'),
    label: str(file, o, 'label', 'data'),
    component: str(file, o, 'component', 'data'),
    grades,
    promotions,
  };
}

export const PROMOTION_STANDARDS: ReadonlyArray<Dataset<PromotionStandards>> =
  RAW_STANDARDS.map(([file, raw]) => loadDataset(file, raw, normalizeStandards));

/** The edition a fresh session opens on. */
export const CURRENT_PROMOTIONS: Dataset<PromotionStandards> = PROMOTION_STANDARDS[0]!;

export function getGrade(
  standards: PromotionStandards,
  id: string,
): GradeDefinition | undefined {
  return standards.grades.find((g) => g.id === id);
}

/** The promotion rules that carry a BTZ programme. */
export function btzPromotions(standards: PromotionStandards): PromotionRule[] {
  return standards.promotions.filter((p) => p.btz !== undefined);
}
