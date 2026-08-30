import {
  DataFileError,
  type DataMeta,
  type DataStatus,
  type Dataset,
} from './types';

/**
 * Generic loading and validation for every dataset under /src/data.
 *
 * Phase 2 (PT scoring tables) reuses `loadDataset` unchanged: it supplies its
 * own `normalize` and gets meta validation, stub handling, and provenance
 * stamping for free. Keep this file payload-agnostic.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strings a maintainer leaves behind in a stub. Matched case-insensitively so
 * the validation tests can tell "not yet filled in" from a real value.
 */
const PLACEHOLDER_STRINGS = new Set(['', 'tbd', 'todo', 'unknown', 'n/a', '-']);

export function isPlaceholderString(value: string): boolean {
  return PLACEHOLDER_STRINGS.has(value.trim().toLowerCase());
}

/** A numeric slot is unpopulated when it is null, zero, or negative. */
export function isPlaceholderNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || value <= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(file: string, obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string') {
    throw new DataFileError(file, `meta.${key} must be a string, got ${typeof value}`);
  }
  return value;
}

/**
 * Validates the `meta` block that every data file carries.
 *
 * Structural requirements apply to stub and verified files alike -- a stub may
 * hold placeholder *values*, but it still has to declare where those values are
 * eventually coming from. The stricter content rules for verified files live in
 * the data-integrity tests, so that authoring a new stub never fails the build.
 */
export function readMeta(file: string, raw: unknown): DataMeta {
  if (!isRecord(raw)) {
    throw new DataFileError(file, 'expected an object at the top level');
  }
  if (!isRecord(raw.meta)) {
    throw new DataFileError(file, 'missing a meta block');
  }
  const meta = raw.meta;

  const status = meta.status;
  if (status !== 'stub' && status !== 'verified') {
    throw new DataFileError(
      file,
      `meta.status must be "stub" or "verified", got ${JSON.stringify(status)}`,
    );
  }

  const verifiedDate = requireString(file, meta, 'verifiedDate');
  if (!ISO_DATE.test(verifiedDate) || Number.isNaN(Date.parse(verifiedDate))) {
    throw new DataFileError(
      file,
      `meta.verifiedDate must be a parseable YYYY-MM-DD date, got "${verifiedDate}"`,
    );
  }

  return {
    source: requireString(file, meta, 'source'),
    version: requireString(file, meta, 'version'),
    verifiedDate,
    sourceUrl: requireString(file, meta, 'sourceUrl'),
    status: status as DataStatus,
    notes: typeof meta.notes === 'string' ? meta.notes : undefined,
    license: typeof meta.license === 'string' ? meta.license : undefined,
  };
}

/**
 * Loads one data file: validates meta, hands the raw payload to `normalize`,
 * and returns an immutable, provenance-stamped dataset.
 *
 * `normalize` is where invariants get *enforced* rather than assumed -- the
 * abbreviation loader re-sorts there instead of trusting the file's order.
 */
export function loadDataset<TRaw, T>(
  file: string,
  raw: unknown,
  normalize: (data: TRaw, meta: DataMeta, file: string) => T,
): Dataset<T> {
  const meta = readMeta(file, raw);
  const payload = (raw as { data?: unknown }).data;
  if (payload === undefined) {
    throw new DataFileError(file, 'missing a data block');
  }
  return Object.freeze({
    meta,
    data: normalize(payload as TRaw, meta, file),
    isStub: meta.status === 'stub',
  });
}

/**
 * Collapses many datasets into the provenance stamp a tool renders.
 *
 * A tool is only as trustworthy as its least-verified input, so one stub among
 * the sources marks the whole readout unverified.
 */
export function collectSources(datasets: ReadonlyArray<Dataset<unknown>>): {
  sources: DataMeta[];
  hasStub: boolean;
} {
  const sources = datasets.map((d) => d.meta);
  return { sources, hasStub: datasets.some((d) => d.isStub) };
}
