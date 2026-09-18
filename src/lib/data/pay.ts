import { loadDataset } from './loader';
import {
  DataFileError,
  type Dataset,
  type PayCap,
  type PayGrade,
  type PayGroup,
  type PayTable,
} from './types';

import basicPay2026 from '../../data/pay/basic-pay-2026.json';

/**
 * Basic pay tables.
 *
 * Another plain use of `loadDataset`: meta validation and provenance come for
 * free, and this file supplies only the invariants whose violation would
 * produce a plausible wrong dollar figure rather than a crash:
 *
 *   - the column bounds must ascend from zero, or a member lands in the wrong
 *     column;
 *   - every grade must carry exactly one rate per column;
 *   - within a grade, rates never fall as service grows -- a cell typed one
 *     column over shows up as a dip;
 *   - grade ids are unique, so a select can key on them.
 */

const RAW_TABLES: ReadonlyArray<readonly [string, unknown]> = [
  ['src/data/pay/basic-pay-2026.json', basicPay2026],
];

const GROUPS: ReadonlySet<string> = new Set<PayGroup>([
  'enlisted',
  'officer',
  'officer-prior',
  'warrant',
]);

export const PAY_GROUP_LABEL: Record<PayGroup, string> = {
  enlisted: 'Enlisted',
  officer: 'Officers',
  'officer-prior': 'Officers with over 4 years enlisted or warrant service',
  warrant: 'Warrant officers',
};

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

function money(file: string, value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new DataFileError(file, `${what} must be a positive amount`);
  }
  return Math.round(value * 100) / 100;
}

function cap(file: string, raw: unknown, what: string): PayCap {
  const o = obj(file, raw, what);
  return {
    monthly: money(file, o.monthly, `${what} monthly`),
    applies: str(file, o, 'applies', what),
    text: str(file, o, 'text', what),
  };
}

function normalize(raw: unknown, _meta: unknown, file: string): PayTable {
  const o = obj(file, raw, 'data');

  const effective = str(file, o, 'effective', 'data');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    throw new DataFileError(file, 'data.effective must be YYYY-MM-DD');
  }
  const raisePercent = o.raisePercent;
  if (typeof raisePercent !== 'number' || !Number.isFinite(raisePercent)) {
    throw new DataFileError(file, 'data.raisePercent must be a number');
  }

  const steps = o.steps;
  const columns = o.columns;
  if (!Array.isArray(steps) || steps.length < 2 || steps[0] !== 0) {
    throw new DataFileError(file, 'data.steps must start at 0');
  }
  if (!Array.isArray(columns) || columns.length !== steps.length) {
    throw new DataFileError(file, 'data.columns must be parallel to data.steps');
  }
  for (let i = 1; i < steps.length; i++) {
    if (typeof steps[i] !== 'number' || steps[i] <= steps[i - 1]) {
      throw new DataFileError(file, `data.steps[${i}] must exceed the step before it`);
    }
  }

  if (!Array.isArray(o.grades) || o.grades.length === 0) {
    throw new DataFileError(file, 'data.grades must be a non-empty array');
  }
  const seen = new Set<string>();
  const grades: PayGrade[] = o.grades.map((entry, i) => {
    const g = obj(file, entry, `grade ${i}`);
    const id = str(file, g, 'id', `grade ${i}`);
    if (seen.has(id)) throw new DataFileError(file, `grade "${id}" appears twice`);
    seen.add(id);
    const group = str(file, g, 'group', id);
    if (!GROUPS.has(group)) throw new DataFileError(file, `${id}: unknown group "${group}"`);
    const monthlyRaw = g.monthly;
    if (!Array.isArray(monthlyRaw) || monthlyRaw.length !== columns.length) {
      throw new DataFileError(file, `${id}: monthly must hold one rate per column`);
    }
    let last = 0;
    const monthly = monthlyRaw.map((v, c) => {
      if (v === null) return null;
      const rate = money(file, v, `${id} column ${c}`);
      if (rate < last) throw new DataFileError(file, `${id}: rate falls at column ${c}`);
      last = rate;
      return rate;
    });
    if (monthly.every((v) => v === null)) {
      throw new DataFileError(file, `${id}: no rate in any column`);
    }
    return {
      id,
      group: group as PayGroup,
      title: str(file, g, 'title', id),
      abbr: str(file, g, 'abbr', id),
      monthly,
    };
  });

  const capsRaw = obj(file, o.caps ?? {}, 'data.caps');
  const caps: Record<string, PayCap> = {};
  for (const [key, value] of Object.entries(capsRaw)) caps[key] = cap(file, value, `cap ${key}`);

  const senior = obj(file, o.seniorEnlisted, 'data.seniorEnlisted');
  const footnotes = Array.isArray(o.footnotes) ? o.footnotes.map(String) : [];

  return {
    effective,
    raisePercent,
    steps: steps as number[],
    columns: columns.map(String),
    grades,
    caps,
    seniorEnlisted: {
      monthly: money(file, senior.monthly, 'seniorEnlisted monthly'),
      text: str(file, senior, 'text', 'seniorEnlisted'),
    },
    footnotes,
  };
}

export const PAY_TABLES: Dataset<PayTable>[] = RAW_TABLES.map(([file, raw]) =>
  loadDataset<unknown, PayTable>(file, raw, normalize),
);

/** The edition in force; the first in the list. */
export const CURRENT_PAY: Dataset<PayTable> = PAY_TABLES[0]!;

export function getGrade(table: PayTable, id: string): PayGrade | undefined {
  return table.grades.find((g) => g.id === id);
}
