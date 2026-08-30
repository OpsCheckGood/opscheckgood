/**
 * Civil date arithmetic for promotion projections.
 *
 * Deliberately not built on `Date`. A promotion date is a calendar date -- a
 * year, a month, a day -- with no time and no zone, and running it through
 * `Date` invites exactly one bug: a member in Guam or Ramstein enters
 * 15 AUG 2025, the browser parses it at UTC midnight, renders it in local time,
 * and the tool quietly shows 14 AUG. Quietly wrong by one day is the failure
 * mode this project cannot have, so nothing here ever touches a timestamp.
 *
 * Everything is integer arithmetic on {year, month, day} and is deterministic:
 * same input, same output, on every machine and in every timezone.
 */

/** Month is 1-12, day is 1-31. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isValid(date: CivilDate): boolean {
  const { year, month, day } = date;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Days since 1970-01-01, by Howard Hinnant's days_from_civil. Used only for
 * comparison and for differences; no date is ever reconstructed from one.
 */
export function toDayNumber(date: CivilDate): number {
  const y = date.year - (date.month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Negative when `a` is earlier. Suitable for sorting. */
export function compare(a: CivilDate, b: CivilDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function isBefore(a: CivilDate, b: CivilDate): boolean {
  return compare(a, b) < 0;
}

export function earliest(dates: ReadonlyArray<CivilDate>): CivilDate | null {
  return dates.length === 0
    ? null
    : dates.reduce((best, d) => (compare(d, best) < 0 ? d : best));
}

export function latest(dates: ReadonlyArray<CivilDate>): CivilDate | null {
  return dates.length === 0
    ? null
    : dates.reduce((best, d) => (compare(d, best) > 0 ? d : best));
}

/**
 * Adds whole months, clamping the day to the target month's length.
 *
 * 31 AUG plus six months is 28 FEB (29 in a leap year), not 3 MAR. That is the
 * convention an anniversary date follows, and it is why this is not just day
 * addition. Note that it is not reversible at month ends -- 31 AUG forward six
 * and back six is 28 AUG -- so a BTZ date is computed from the fully-qualified
 * date directly rather than by undoing an addition.
 */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const zero = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(zero / 12);
  const month = zero - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Whole months from `a` to `b`, not counting a partial final month. */
export function monthsBetween(a: CivilDate, b: CivilDate): number {
  const whole = (b.year - a.year) * 12 + (b.month - a.month);
  return b.day < a.day ? whole - 1 : whole;
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------

/** Parses YYYY-MM-DD, which is what a date input produces. */
export function parseIso(text: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValid(date) ? date : null;
}

export function toIso(date: CivilDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** "15 FEB 2028". Day is padded so a column of dates stays aligned. */
export function formatDate(date: CivilDate): string {
  return `${String(date.day).padStart(2, '0')} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** "FEB 2028", for the month-granular parts of the cycle. */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function monthName(month: number): string {
  return MONTHS[month - 1]!;
}

/**
 * "18 months", "2 years 3 months", "3 weeks". A duration a supervisor reads
 * once and acts on, not a precise interval -- the exact dates are printed
 * beside it.
 */
export function describeGap(from: CivilDate, to: CivilDate): string {
  const days = toDayNumber(to) - toDayNumber(from);
  if (days === 0) return 'today';
  const months = Math.abs(monthsBetween(days < 0 ? to : from, days < 0 ? from : to));
  const suffix = days < 0 ? ' ago' : '';
  if (months === 0) {
    const weeks = Math.floor(Math.abs(days) / 7);
    if (weeks === 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}${suffix}`;
    return `${weeks} week${weeks === 1 ? '' : 's'}${suffix}`;
  }
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}${suffix}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? '' : 's'}${rest ? ` ${rest} month${rest === 1 ? '' : 's'}` : ''}${suffix}`;
}

/**
 * Today, as a civil date in the viewer's own timezone.
 *
 * The one place a real clock is read. Every function that needs "now" takes it
 * as an argument instead of calling this, so the whole engine stays pure and
 * the tests can pin a date.
 */
export function today(): CivilDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
