import { loadDataset } from './loader';
import {
  DataFileError,
  type AgeGroup,
  type BodyFatAxis,
  type BodyFatRules,
  type BodyFatTable,
  type BodyFatSite,
  type BodyFatStandard,
  type ComponentDefinition,
  type Dataset,
  type EventDefinition,
  type LimitTable,
  type MeasurementRounding,
  type PtStandards,
  type ScoringTable,
  type Sex,
} from './types';

import afman362905 from '../../data/pt/afman36-2905.json';
import bodyFatTables from '../../data/pt/body-fat-tables.json';

/**
 * PT scoring standards.
 *
 * Reuses `loadDataset` unchanged, exactly as the phase-2 note in loader.ts
 * anticipated: this file supplies a `normalize` and gets meta validation, stub
 * handling, and provenance stamping for free.
 *
 * `normalize` enforces the invariants rather than assuming them -- the same
 * stance the abbreviation loader takes by re-sorting. A table whose row count
 * disagrees with its point ladder, or an event naming a table that is not in
 * the file, fails at load rather than scoring wrongly at runtime.
 */

// Order drives the standards picker; the first entry is the default.
const RAW_STANDARDS: ReadonlyArray<readonly [string, unknown]> = [
  ['src/data/pt/afman36-2905.json', afman362905],
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

/** A bound that may be open-ended: a number, or null for "and over". */
function bound(file: string, o: Record<string, unknown>, key: string, what: string): number | null {
  const value = o[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataFileError(file, `${what} ${key} must be a number or null`);
  }
  return value;
}

function numberArray(file: string, raw: unknown, what: string): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DataFileError(file, `${what} must be a non-empty array`);
  }
  return raw.map((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new DataFileError(file, `${what}[${i}] must be a finite number`);
    }
    return v;
  });
}

/**
 * Age groups must tile the whole range: ascending, no gaps, no overlaps, and
 * open-ended only at the top. Two adjacent brackets that both claim age 40, or
 * a gap that claims neither, would silently score somebody off the wrong row.
 */
function normalizeAgeGroups(file: string, raw: unknown, what: string): AgeGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DataFileError(file, `${what} must be a non-empty array`);
  }
  const groups = raw.map((g, i) => {
    const o = obj(file, g, `${what}[${i}]`);
    return {
      id: str(file, o, 'id', `${what}[${i}]`),
      label: str(file, o, 'label', `${what}[${i}]`),
      maxAge: bound(file, o, 'maxAge', `${what}[${i}]`),
    };
  });
  groups.forEach((g, i) => {
    const last = i === groups.length - 1;
    if (last) {
      if (g.maxAge !== null) {
        throw new DataFileError(file, `${what}: the final bracket must be open-ended (maxAge null)`);
      }
      return;
    }
    if (g.maxAge === null) {
      throw new DataFileError(file, `${what}: only the final bracket may be open-ended`);
    }
    const next = groups[i + 1]!;
    if (next.maxAge !== null && next.maxAge <= g.maxAge) {
      throw new DataFileError(
        file,
        `${what}: brackets must ascend, "${g.label}" then "${next.label}" do not`,
      );
    }
  });
  return groups;
}

function normalizeEvent(file: string, raw: unknown, what: string): EventDefinition {
  const o = obj(file, raw, what);
  const kind = o.kind;
  if (kind !== 'table' && kind !== 'passFail' && kind !== 'ratio') {
    throw new DataFileError(file, `${what} kind must be table, passFail, or ratio`);
  }
  const input = o.input;
  if (input !== 'count' && input !== 'time' && input !== 'waist') {
    throw new DataFileError(file, `${what} input must be count, time, or waist`);
  }
  const better = o.better;
  if (better !== undefined && better !== 'higher' && better !== 'lower') {
    throw new DataFileError(file, `${what} better must be higher or lower`);
  }
  if (kind === 'table' && typeof o.table !== 'string') {
    throw new DataFileError(file, `${what} is kind=table and must name a table`);
  }
  if (kind === 'passFail' && typeof o.limits !== 'string') {
    throw new DataFileError(file, `${what} is kind=passFail and must name a limit table`);
  }
  const label = str(file, o, 'label', what);
  return {
    id: str(file, o, 'id', what),
    label,
    shortLabel: typeof o.shortLabel === 'string' ? o.shortLabel : label,
    kind,
    table: typeof o.table === 'string' ? o.table : undefined,
    limits: typeof o.limits === 'string' ? o.limits : undefined,
    unit: typeof o.unit === 'string' ? o.unit : undefined,
    unitLabel: typeof o.unitLabel === 'string' ? o.unitLabel : undefined,
    better: better as EventDefinition['better'],
    input,
    excludesExcellent: o.excludesExcellent === true,
    note: typeof o.note === 'string' ? o.note : undefined,
  };
}

function normalizeComponent(file: string, raw: unknown, index: number): ComponentDefinition {
  const what = `components[${index}]`;
  const o = obj(file, raw, what);
  const kind = o.kind;
  if (kind !== 'table' && kind !== 'ratio') {
    throw new DataFileError(file, `${what} kind must be table or ratio`);
  }
  if (!Array.isArray(o.events) || o.events.length === 0) {
    throw new DataFileError(file, `${what} must offer at least one event`);
  }
  const ladder = o.ladder;
  if (kind === 'table' && typeof ladder !== 'string') {
    throw new DataFileError(file, `${what} is kind=table and must name a point ladder`);
  }

  // A ratio component carries its ladder inline rather than by name; that is
  // unpacked in normalizeStandards, which is where the cross-references live.
  return {
    id: str(file, o, 'id', what),
    label: str(file, o, 'label', what),
    shortLabel: typeof o.shortLabel === 'string' ? o.shortLabel : str(file, o, 'label', what),
    maxPoints: num(file, o, 'maxPoints', what),
    kind,
    ladder: typeof ladder === 'string' ? ladder : undefined,
    hasMinimum: o.hasMinimum === true,
    events: o.events.map((e, i) => normalizeEvent(file, e, `${what}.events[${i}]`)),
  };
}

function normalizeTable(file: string, raw: unknown, key: string, columns: number): ScoringTable {
  const o = obj(file, raw, `tables.${key}`);
  if (!Array.isArray(o.rows) || o.rows.length === 0) {
    throw new DataFileError(file, `tables.${key}.rows must be a non-empty array`);
  }
  const rows = o.rows.map((r, i) => {
    const row = numberArray(file, r, `tables.${key}.rows[${i}]`);
    if (row.length !== columns) {
      throw new DataFileError(
        file,
        `tables.${key}.rows[${i}] has ${row.length} cells, expected ${columns} (age groups x sexes)`,
      );
    }
    return row;
  });
  const neutral = numberArray(file, o.neutral, `tables.${key}.neutral`);
  if (neutral.length !== rows.length) {
    throw new DataFileError(
      file,
      `tables.${key}.neutral has ${neutral.length} rows, expected ${rows.length}`,
    );
  }
  return { rows, neutral };
}

function normalizeLimitTable(file: string, raw: unknown, key: string): LimitTable {
  const what = `limitTables.${key}`;
  const o = obj(file, raw, what);
  const ageGroups = normalizeAgeGroups(file, o.ageGroups, `${what}.ageGroups`);
  const bySexRaw = obj(file, o.bySex, `${what}.bySex`);
  const bySex = {} as Record<Sex, number[]>;
  for (const sex of ['male', 'female'] as const) {
    const values = numberArray(file, bySexRaw[sex], `${what}.bySex.${sex}`);
    if (values.length !== ageGroups.length) {
      throw new DataFileError(
        file,
        `${what}.bySex.${sex} has ${values.length} entries, expected ${ageGroups.length}`,
      );
    }
    bySex[sex] = values;
  }
  return { label: str(file, o, 'label', what), ageGroups, bySex };
}

const ROUNDINGS: ReadonlyArray<MeasurementRounding> = [
  'upQuarter',
  'downQuarter',
  'downHalf',
  'nearestHalf',
];

function rounding(
  file: string,
  o: Record<string, unknown>,
  key: string,
  what: string,
): MeasurementRounding {
  const value = o[key];
  if (typeof value !== 'string' || !ROUNDINGS.includes(value as MeasurementRounding)) {
    throw new DataFileError(file, `${what} ${key} must be one of ${ROUNDINGS.join(', ')}`);
  }
  return value as MeasurementRounding;
}

/**
 * The tape rules for one sex.
 *
 * A site whose sign is neither +1 nor -1 would quietly drop out of the
 * circumference sum, so the sign is checked rather than coerced.
 */
function normalizeBodyFatStandard(file: string, raw: unknown, what: string): BodyFatStandard {
  const o = obj(file, raw, what);
  if (!Array.isArray(o.sites) || o.sites.length === 0) {
    throw new DataFileError(file, `${what}.sites must be a non-empty array`);
  }
  const sites: BodyFatSite[] = o.sites.map((s, i) => {
    const so = obj(file, s, `${what}.sites[${i}]`);
    const sign = num(file, so, 'sign', `${what}.sites[${i}]`);
    if (sign !== 1 && sign !== -1) {
      throw new DataFileError(file, `${what}.sites[${i}].sign must be 1 or -1`);
    }
    return {
      id: str(file, so, 'id', `${what}.sites[${i}]`),
      label: str(file, so, 'label', `${what}.sites[${i}]`),
      sign,
      rounding: rounding(file, so, 'rounding', `${what}.sites[${i}]`),
    };
  });
  const ids = new Set(sites.map((s) => s.id));
  if (ids.size !== sites.length) {
    throw new DataFileError(file, `${what}.sites must have unique ids`);
  }
  if (!sites.some((s) => s.sign === 1)) {
    throw new DataFileError(file, `${what}.sites must include at least one added site`);
  }

  const equation = obj(file, o.equation, `${what}.equation`);
  return {
    formulaLabel: str(file, o, 'formulaLabel', what),
    standardLabel: str(file, o, 'standardLabel', what),
    maxPercent: num(file, o, 'maxPercent', what),
    tableRef: str(file, o, 'tableRef', what),
    sites,
    equation: {
      circumference: num(file, equation, 'circumference', `${what}.equation`),
      height: num(file, equation, 'height', `${what}.equation`),
      constant: num(file, equation, 'constant', `${what}.equation`),
    },
  };
}

function normalizeAxis(file: string, raw: unknown, what: string): BodyFatAxis {
  const o = obj(file, raw, what);
  const axis = {
    start: num(file, o, 'start', what),
    step: num(file, o, 'step', what),
    count: num(file, o, 'count', what),
  };
  if (axis.step <= 0 || axis.count < 2) {
    throw new DataFileError(file, `${what} must step upwards over at least two entries`);
  }
  return axis;
}

/**
 * A published body fat table.
 *
 * The invariants are checked rather than assumed: more circumference at the
 * same height is never less body fat, and more height at the same
 * circumference is never more. A transcription slip that broke either would
 * otherwise sit there scoring people wrongly, and that is exactly the failure
 * this project cannot have.
 */
function normalizeBodyFatTable(file: string, raw: unknown, what: string): BodyFatTable {
  const o = obj(file, raw, what);
  const circumference = normalizeAxis(file, o.circumference, `${what}.circumference`);
  const height = normalizeAxis(file, o.height, `${what}.height`);
  if (!Array.isArray(o.rows) || o.rows.length !== circumference.count) {
    throw new DataFileError(
      file,
      `${what}.rows must hold ${circumference.count} rows, one per circumference step`,
    );
  }
  const rows = o.rows.map((r, i) => {
    const row = numberArray(file, r, `${what}.rows[${i}]`);
    if (row.length !== height.count) {
      throw new DataFileError(
        file,
        `${what}.rows[${i}] has ${row.length} cells, expected ${height.count}`,
      );
    }
    if (row.some((v) => !Number.isInteger(v) || v < 0)) {
      throw new DataFileError(file, `${what}.rows[${i}] must hold whole percentages`);
    }
    for (let j = 1; j < row.length; j += 1) {
      if (row[j]! > row[j - 1]!) {
        throw new DataFileError(
          file,
          `${what}.rows[${i}]: body fat rises with height at cell ${j}`,
        );
      }
    }
    return row;
  });
  for (let j = 0; j < height.count; j += 1) {
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i]![j]! < rows[i - 1]![j]!) {
        throw new DataFileError(
          file,
          `${what}: body fat falls with circumference at row ${i}, column ${j}`,
        );
      }
    }
  }
  return { circumference, height, rows };
}

function normalizeBodyFatTables(file: string, raw: unknown): Record<Sex, BodyFatTable> {
  const o = obj(file, raw, 'data');
  const out = {} as Record<Sex, BodyFatTable>;
  for (const sex of ['male', 'female'] as const) {
    out[sex] = normalizeBodyFatTable(file, o[sex], `data.${sex}`);
  }
  return out;
}

export const BODY_FAT_TABLES: Dataset<Record<Sex, BodyFatTable>> = loadDataset(
  'src/data/pt/body-fat-tables.json',
  bodyFatTables,
  (raw, _meta, file) => normalizeBodyFatTables(file, raw),
);

function normalizeBodyFat(file: string, raw: unknown): BodyFatRules {
  const what = 'data.bodyFat';
  const o = obj(file, raw, what);
  const bySexRaw = obj(file, o.bySex, `${what}.bySex`);
  const bySex = {} as Record<Sex, BodyFatStandard>;
  for (const sex of ['male', 'female'] as const) {
    bySex[sex] = normalizeBodyFatStandard(file, bySexRaw[sex], `${what}.bySex.${sex}`);
  }
  if (o.percentRounding !== 'nearestWhole') {
    throw new DataFileError(file, `${what}.percentRounding must be nearestWhole`);
  }
  return {
    label: str(file, o, 'label', what),
    heightRounding: rounding(file, o, 'heightRounding', what),
    percentRounding: 'nearestWhole',
    bySex,
    tables: BODY_FAT_TABLES.data,
    siteNotes: Array.isArray(o.siteNotes)
      ? o.siteNotes.filter((n): n is string => typeof n === 'string')
      : [],
  };
}

function normalizeStandards(raw: unknown, _meta: unknown, file: string): PtStandards {
  const o = obj(file, raw, 'data');

  const sexesRaw = o.sexes;
  if (!Array.isArray(sexesRaw) || sexesRaw.length === 0) {
    throw new DataFileError(file, 'data.sexes must be a non-empty array');
  }
  const sexes = sexesRaw.map((s, i) => {
    const so = obj(file, s, `sexes[${i}]`);
    const id = str(file, so, 'id', `sexes[${i}]`);
    if (id !== 'male' && id !== 'female') {
      throw new DataFileError(file, `sexes[${i}].id must be male or female`);
    }
    return { id: id as Sex, label: str(file, so, 'label', `sexes[${i}]`) };
  });

  const ageGroups = normalizeAgeGroups(file, o.ageGroups, 'data.ageGroups');
  const columns = ageGroups.length * sexes.length;

  const tracksRaw = o.tracks;
  if (!Array.isArray(tracksRaw) || tracksRaw.length === 0) {
    throw new DataFileError(file, 'data.tracks must be a non-empty array');
  }
  const tracks = tracksRaw.map((t, i) => {
    const to = obj(file, t, `tracks[${i}]`);
    return {
      id: str(file, to, 'id', `tracks[${i}]`),
      label: str(file, to, 'label', `tracks[${i}]`),
      neutral: to.neutral === true,
    };
  });

  const laddersRaw = obj(file, o.pointLadders, 'data.pointLadders');
  const pointLadders: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(laddersRaw)) {
    pointLadders[key] = numberArray(file, value, `pointLadders.${key}`);
  }

  const tablesRaw = obj(file, o.tables, 'data.tables');
  const tables: Record<string, ScoringTable> = {};
  for (const [key, value] of Object.entries(tablesRaw)) {
    tables[key] = normalizeTable(file, value, key, columns);
  }

  const limitsRaw = obj(file, o.limitTables ?? {}, 'data.limitTables');
  const limitTables: Record<string, LimitTable> = {};
  for (const [key, value] of Object.entries(limitsRaw)) {
    limitTables[key] = normalizeLimitTable(file, value, key);
  }

  if (!Array.isArray(o.components) || o.components.length === 0) {
    throw new DataFileError(file, 'data.components must be a non-empty array');
  }
  const components = o.components.map((c, i) => {
    const component = normalizeComponent(file, c, i);
    const co = c as Record<string, unknown>;

    if (component.kind === 'ratio') {
      const ladder = obj(file, co.ladder, `components[${i}].ladder`);
      if (!Array.isArray(ladder.rows) || ladder.rows.length === 0) {
        throw new DataFileError(file, `components[${i}].ladder.rows must be a non-empty array`);
      }
      component.ladder = undefined;
      component.ladderRows = ladder.rows.map((r, j) => {
        const ro = obj(file, r, `components[${i}].ladder.rows[${j}]`);
        return {
          label: str(file, ro, 'label', `components[${i}].ladder.rows[${j}]`),
          ratioMax: bound(file, ro, 'ratioMax', `components[${i}].ladder.rows[${j}]`),
          points: num(file, ro, 'points', `components[${i}].ladder.rows[${j}]`),
        };
      });
      if (component.ladderRows[component.ladderRows.length - 1]!.ratioMax !== null) {
        throw new DataFileError(
          file,
          `components[${i}].ladder.rows must end with an open-ended row (ratioMax null)`,
        );
      }
      const bands = Array.isArray(ladder.riskBands) ? ladder.riskBands : [];
      component.riskBands = bands.map((b, j) => {
        const bo = obj(file, b, `components[${i}].ladder.riskBands[${j}]`);
        return {
          ratioMax: bound(file, bo, 'ratioMax', `components[${i}].ladder.riskBands[${j}]`),
          label: str(file, bo, 'label', `components[${i}].ladder.riskBands[${j}]`),
        };
      });
    }

    // Cross-reference check: every event must resolve to data that exists, and
    // a table component's rows must line up with its ladder one-for-one.
    for (const event of component.events) {
      if (event.kind === 'table') {
        const table = tables[event.table!];
        if (!table) {
          throw new DataFileError(
            file,
            `components[${i}] event "${event.id}" names missing table "${event.table}"`,
          );
        }
        const ladder = pointLadders[component.ladder!];
        if (!ladder) {
          throw new DataFileError(
            file,
            `components[${i}] names missing point ladder "${component.ladder}"`,
          );
        }
        if (ladder.length !== table.rows.length) {
          throw new DataFileError(
            file,
            `components[${i}] event "${event.id}": table "${event.table}" has ${table.rows.length} rows but ladder "${component.ladder}" has ${ladder.length} entries`,
          );
        }
      }
      if (event.kind === 'passFail' && !limitTables[event.limits!]) {
        throw new DataFileError(
          file,
          `components[${i}] event "${event.id}" names missing limit table "${event.limits}"`,
        );
      }
    }
    return component;
  });

  const ageRange = obj(file, o.ageRange, 'data.ageRange');
  const rating = obj(file, o.rating, 'data.rating');

  return {
    id: str(file, o, 'id', 'data'),
    label: str(file, o, 'label', 'data'),
    ageRange: {
      min: num(file, ageRange, 'min', 'data.ageRange'),
      max: num(file, ageRange, 'max', 'data.ageRange'),
    },
    sexes,
    ageGroups,
    tracks,
    pointLadders,
    components,
    tables,
    limitTables,
    chartNotes: Array.isArray(o.chartNotes)
      ? o.chartNotes.filter((n): n is string => typeof n === 'string')
      : [],
    bodyFat: o.bodyFat === undefined ? undefined : normalizeBodyFat(file, o.bodyFat),
    rating: {
      passMinPercent: num(file, rating, 'passMinPercent', 'data.rating'),
      excellentMinPercent: num(file, rating, 'excellentMinPercent', 'data.rating'),
      tier2BfaRatioOver: num(file, rating, 'tier2BfaRatioOver', 'data.rating'),
    },
  };
}

export const PT_STANDARDS: ReadonlyArray<Dataset<PtStandards>> = RAW_STANDARDS.map(
  ([file, raw]) => loadDataset(file, raw, normalizeStandards),
);

export function getStandards(id: string): Dataset<PtStandards> | undefined {
  return PT_STANDARDS.find((s) => s.data.id === id);
}

/** The edition a fresh session opens on. */
export const CURRENT_STANDARDS: Dataset<PtStandards> = PT_STANDARDS[0]!;

export function getComponent(
  standards: PtStandards,
  id: string,
): ComponentDefinition | undefined {
  return standards.components.find((c) => c.id === id);
}

export function getEvent(
  component: ComponentDefinition,
  id: string,
): EventDefinition | undefined {
  return component.events.find((e) => e.id === id);
}
