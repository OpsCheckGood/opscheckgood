import { normalizeAbbreviations, type AbbreviationTable } from './abbreviations';
import { HQ_APPROVED, COMMON } from './abbreviationSets';
import type { AbbreviationEntry, DataMeta } from './types';

/**
 * User edits layered over the shipped abbreviation lists.
 *
 * The shipped JSON is never mutated: it is the baseline, and everything a user
 * does is recorded as a delta against it. That makes "reset to defaults" a
 * matter of dropping the delta, and means a future data update still reaches
 * anyone who has not deliberately overridden that entry.
 *
 * Kept in localStorage like every other piece of state here -- nothing about a
 * user's abbreviation list leaves their machine.
 */

export type ListId = 'hq' | 'common';

export interface ListDelta {
  /** Keys of shipped entries the user has switched off. */
  disabled: string[];
  /** Entries the user added themselves. */
  custom: AbbreviationEntry[];
}

export type Overrides = Record<ListId, ListDelta>;

export const STORE_KEY = 'ocg.abbreviations.v1';

export const LIST_LABEL: Record<ListId, string> = {
  hq: 'Air Force Acronym & Abbreviation List',
  common: 'Common Acronyms & Abbreviations',
};

/** Shown wherever Common results appear. Wording is fixed by the spec. */
export const COMMON_NOTE =
  '"Common" terms are subject to local guidance and leadership preference.';

export const EMPTY_OVERRIDES: Overrides = {
  hq: { disabled: [], custom: [] },
  common: { disabled: [], custom: [] },
};

/**
 * Identity of an entry, stable across reorderings of the file.
 *
 * The phrase is compared case-insensitively because that is how matching works.
 * The abbreviation is not, since "Sq" and "SQ" are a deliberate choice.
 */
export function entryKey(entry: AbbreviationEntry): string {
  return `${entry.phrase.toLowerCase()}=>${entry.abbr}`;
}

export function shippedEntries(list: ListId): readonly AbbreviationEntry[] {
  return list === 'hq' ? HQ_APPROVED.data.entries : COMMON.data.entries;
}

export function shippedMeta(list: ListId): DataMeta {
  return list === 'hq' ? HQ_APPROVED.meta : COMMON.meta;
}

function isEntry(value: unknown): value is AbbreviationEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbbreviationEntry).phrase === 'string' &&
    typeof (value as AbbreviationEntry).abbr === 'string'
  );
}

function readDelta(raw: unknown): ListDelta {
  const source = (raw ?? {}) as Partial<ListDelta>;
  return {
    disabled: Array.isArray(source.disabled)
      ? source.disabled.filter((k): k is string => typeof k === 'string')
      : [],
    custom: Array.isArray(source.custom) ? source.custom.filter(isEntry) : [],
  };
}

function cloneOverrides(source: Overrides): Overrides {
  return {
    hq: { disabled: [...source.hq.disabled], custom: [...source.hq.custom] },
    common: { disabled: [...source.common.disabled], custom: [...source.common.custom] },
  };
}

/** Never throws: a corrupt or absent store falls back to the shipped lists. */
export function parseOverrides(raw: string | null): Overrides {
  if (!raw) return cloneOverrides(EMPTY_OVERRIDES);
  try {
    const parsed = JSON.parse(raw) as Partial<Overrides>;
    return { hq: readDelta(parsed.hq), common: readDelta(parsed.common) };
  } catch {
    return cloneOverrides(EMPTY_OVERRIDES);
  }
}

/**
 * Everything touching localStorage is inside the try, including the existence
 * check. On an opaque origin -- a page opened from file://, which is exactly
 * the offline copy's situation -- merely evaluating `typeof localStorage`
 * throws a SecurityError. A guard outside the try takes the whole component
 * down with it.
 */
export function loadOverrides(): Overrides {
  try {
    if (typeof localStorage === 'undefined') return cloneOverrides(EMPTY_OVERRIDES);
    return parseOverrides(localStorage.getItem(STORE_KEY));
  } catch {
    return cloneOverrides(EMPTY_OVERRIDES);
  }
}

export function saveOverrides(overrides: Overrides): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
  } catch {
    /* Blocked or opaque-origin storage: edits apply for this page view only. */
  }
}

export interface ResolvedEntry extends AbbreviationEntry {
  key: string;
  enabled: boolean;
  /** True when the user added it rather than it coming from the shipped file. */
  custom: boolean;
}

/** Shipped entries plus the user's own, each carrying its enabled state. */
export function resolveList(list: ListId, overrides: Overrides): ResolvedEntry[] {
  const disabled = new Set(overrides[list].disabled);
  const shipped = shippedEntries(list).map((entry) => ({
    ...entry,
    key: entryKey(entry),
    enabled: !disabled.has(entryKey(entry)),
    custom: false,
  }));
  const custom = overrides[list].custom.map((entry) => ({
    ...entry,
    key: entryKey(entry),
    enabled: !disabled.has(entryKey(entry)),
    custom: true,
  }));
  return [...custom, ...shipped];
}

/**
 * The table the shaper actually uses: enabled entries only, re-sorted by the
 * loader so longest-match-first still holds after a user's edits.
 */
export function effectiveTable(list: ListId, overrides: Overrides): AbbreviationTable {
  const entries = resolveList(list, overrides)
    .filter((entry) => entry.enabled)
    .map(({ phrase, abbr }) => ({ phrase, abbr }));
  return normalizeAbbreviations(entries, {} as DataMeta, `${list} (effective)`);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * CSV rather than .xlsx.
 *
 * A spreadsheet reader is roughly a megabyte of dependency for a three-column
 * table, and CSV opens in Excel, diffs in git, and can be written by hand.
 * Columns are `enabled,phrase,abbreviation`, which round-trips the enabled
 * state a bare two-column list would lose.
 */
export const CSV_HEADER = 'enabled,phrase,abbreviation';

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(entries: readonly ResolvedEntry[]): string {
  const rows = entries.map((entry) =>
    [entry.enabled ? 'TRUE' : 'FALSE', entry.phrase, entry.abbr].map(escapeCsv).join(','),
  );
  return [CSV_HEADER, ...rows].join('\n');
}

/** Splits one CSV line, honouring quotes and doubled quotes inside them. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export interface ParsedCsv {
  entries: Array<AbbreviationEntry & { enabled: boolean }>;
  /** Lines that could not be read, reported rather than silently dropped. */
  skipped: number;
}

/**
 * Accepts `enabled,phrase,abbreviation` and also a bare `phrase,abbreviation`,
 * because a list someone typed by hand will not carry the enabled column.
 */
export function fromCsv(text: string): ParsedCsv {
  const entries: Array<AbbreviationEntry & { enabled: boolean }> = [];
  let skipped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const cells = splitCsvLine(line).map((c) => c.trim());
    if (cells.length < 2) {
      skipped += 1;
      continue;
    }

    let enabled = true;
    let phrase: string;
    let abbr: string;

    if (cells.length >= 3) {
      const flag = cells[0]!.toLowerCase();
      if (flag === 'enabled') continue; // header row
      enabled = !['false', '0', 'no', 'off'].includes(flag);
      phrase = cells[1]!;
      abbr = cells[2]!;
    } else {
      if (cells[0]!.toLowerCase() === 'phrase') continue; // header row
      phrase = cells[0]!;
      abbr = cells[1]!;
    }

    if (phrase === '' || abbr === '') {
      skipped += 1;
      continue;
    }
    entries.push({ phrase: phrase.replace(/\s+/g, ' '), abbr, enabled });
  }

  return { entries, skipped };
}
