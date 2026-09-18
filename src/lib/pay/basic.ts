import type { PayGrade, PayTable } from '../data/types';

/**
 * Basic pay lookup.
 *
 * The one rule this file knows: a years-of-service column applies once a
 * member's cumulative service is over the years it names. "Over 6" starts
 * the day after six years are complete, so six years exactly is still the
 * "over 4" column. Everything else is reading a cell out of the table.
 */

/** Which column a length of service falls in: the last bound it exceeds. */
export function columnIndex(years: number, steps: readonly number[]): number {
  let index = 0;
  for (let i = 1; i < steps.length; i++) {
    if (years > steps[i]!) index = i;
  }
  return index;
}

/** Years and whole months, as a member would say it, to a fraction of a year. */
export function serviceYears(years: number, months: number): number {
  const y = Number.isFinite(years) ? Math.max(0, years) : 0;
  const m = Number.isFinite(months) ? Math.min(11, Math.max(0, months)) : 0;
  return y + m / 12;
}

export interface NextStep {
  /** Column heading, e.g. "Over 8". */
  column: string;
  /** Years of service at which it begins. */
  atYears: number;
  monthly: number;
  /** Monthly increase over the current rate. */
  delta: number;
}

export interface PayResult {
  grade: PayGrade;
  years: number;
  columnIndex: number;
  column: string;
  /** Null where DFAS prints no rate for this grade at this length of service. */
  monthly: number | null;
  annual: number | null;
  /** Military pay is paid on the 1st and 15th. */
  semiMonthly: number | null;
  /** The next longevity raise on the same grade, if there is one. */
  nextStep: NextStep | null;
}

export function lookup(table: PayTable, gradeId: string, years: number): PayResult | null {
  const grade = table.grades.find((g) => g.id === gradeId);
  if (!grade) return null;
  const index = columnIndex(years, table.steps);
  const monthly = grade.monthly[index] ?? null;

  let nextStep: NextStep | null = null;
  if (monthly !== null) {
    for (let i = index + 1; i < grade.monthly.length; i++) {
      const rate = grade.monthly[i];
      if (rate !== null && rate !== undefined && rate > monthly) {
        nextStep = {
          column: table.columns[i]!,
          atYears: table.steps[i]!,
          monthly: rate,
          delta: round2(rate - monthly),
        };
        break;
      }
    }
  }

  return {
    grade,
    years,
    columnIndex: index,
    column: table.columns[index]!,
    monthly,
    annual: monthly === null ? null : round2(monthly * 12),
    semiMonthly: monthly === null ? null : round2(monthly / 2),
    nextStep,
  };
}

export interface Difference {
  monthly: number;
  annual: number;
  /** Relative to the first result, as a percentage. */
  percent: number;
}

/** How much more (or less) the second result pays than the first. */
export function difference(a: PayResult, b: PayResult): Difference | null {
  if (a.monthly === null || b.monthly === null) return null;
  const monthly = round2(b.monthly - a.monthly);
  return {
    monthly,
    annual: round2(monthly * 12),
    percent: a.monthly === 0 ? 0 : Math.round((monthly / a.monthly) * 1000) / 10,
  };
}

/**
 * The grade a member would make next: the following entry in the same group.
 * Used to prefill a comparison, which is most often "if I made rank".
 */
export function nextGrade(table: PayTable, gradeId: string): PayGrade | null {
  const at = table.grades.findIndex((g) => g.id === gradeId);
  if (at < 0) return null;
  const next = table.grades[at + 1];
  return next && next.group === table.grades[at]!.group ? next : null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  return USD.format(value);
}

/** "+$189.90" or "−$189.90", with a real minus sign. */
export function formatSigned(value: number): string {
  if (value < 0) return `−${USD.format(-value)}`;
  return `+${USD.format(value)}`;
}

/** Parses a typed number, tolerating blanks. */
export function parseCount(text: string): number {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}
