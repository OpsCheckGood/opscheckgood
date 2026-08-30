import { DataFileError, type AbbreviationEntry, type DataMeta } from './types';

/**
 * Abbreviation tables and greedy longest-match-first replacement.
 *
 * The ordering rule is the whole ballgame. If a single-word rule fires before a
 * multi-word one, "United States Air Force Academy" collapses to "USAF Academy"
 * instead of "USAFA". So the loader re-sorts descending by phrase length rather
 * than trusting the file to arrive in the right order -- a maintainer editing
 * JSON by hand, or importing from a spreadsheet, will not preserve it.
 */

export interface AbbreviationTable {
  /** Sorted descending by phrase length. Never re-sort downstream. */
  readonly entries: readonly AbbreviationEntry[];
  /** Lowercased phrase -> abbreviation, for single-word lookups. */
  readonly byPhrase: ReadonlyMap<string, string>;
}

/** Longest phrase first; ties broken alphabetically so the order is stable. */
function byPhraseLengthDesc(a: AbbreviationEntry, b: AbbreviationEntry): number {
  const delta = b.phrase.length - a.phrase.length;
  return delta !== 0 ? delta : a.phrase.localeCompare(b.phrase);
}

export function normalizeAbbreviations(
  raw: unknown,
  _meta: DataMeta,
  file: string,
): AbbreviationTable {
  if (!Array.isArray(raw)) {
    throw new DataFileError(file, 'data must be an array of {phrase, abbr} entries');
  }

  const entries: AbbreviationEntry[] = raw.map((entry, i) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as AbbreviationEntry).phrase !== 'string' ||
      typeof (entry as AbbreviationEntry).abbr !== 'string'
    ) {
      throw new DataFileError(file, `entry ${i} must be {phrase: string, abbr: string}`);
    }
    const { phrase, abbr } = entry as AbbreviationEntry;
    // Collapse internal whitespace now so matching does not have to care.
    return { phrase: phrase.trim().replace(/\s+/g, ' '), abbr: abbr.trim() };
  });

  for (const entry of entries) {
    if (entry.phrase === '') {
      throw new DataFileError(file, 'entry has an empty phrase');
    }
  }

  // Enforced here, not assumed of the file. See the note at the top.
  entries.sort(byPhraseLengthDesc);

  const byPhrase = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.phrase.toLowerCase();
    if (!byPhrase.has(key)) byPhrase.set(key, entry.abbr);
  }

  return Object.freeze({ entries: Object.freeze(entries), byPhrase });
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matcherCache = new WeakMap<AbbreviationTable, RegExp | null>();

/**
 * One alternation of every phrase, longest first.
 *
 * JavaScript alternation is first-match-wins rather than longest-match-wins, so
 * the descending sort is what makes this greedy in the direction we want. Inner
 * spaces become `\s+` so a phrase still matches across a line wrap or a double
 * space, and the surrounding lookarounds keep "Sq" from matching inside
 * "Sqdn" without `\b`'s awkwardness around punctuation.
 */
function matcherFor(table: AbbreviationTable): RegExp | null {
  const cached = matcherCache.get(table);
  if (cached !== undefined) return cached;

  let matcher: RegExp | null = null;
  if (table.entries.length > 0) {
    const alternation = table.entries
      .map((e) => escapeRegExp(e.phrase).replace(/\\?\s+/g, '\\s+'))
      .join('|');
    matcher = new RegExp(`(?<![A-Za-z0-9])(?:${alternation})(?![A-Za-z0-9])`, 'gi');
  }
  matcherCache.set(table, matcher);
  return matcher;
}

/**
 * Replaces every known phrase with its abbreviation in a single left-to-right
 * pass.
 *
 * Single-pass matters for idempotency: replaced text is copied to the output
 * and never rescanned, so an abbreviation cannot be fed back through the table
 * on the same run. Running the function twice then equals running it once,
 * provided no abbreviation is itself a phrase in the table -- an invariant the
 * data-integrity tests check.
 */
export function applyAbbreviations(text: string, table: AbbreviationTable): string {
  const matcher = matcherFor(table);
  if (!matcher) return text;

  matcher.lastIndex = 0;
  return text.replace(matcher, (match) => {
    const key = match.toLowerCase().replace(/\s+/g, ' ');
    return table.byPhrase.get(key) ?? match;
  });
}

/** The approved abbreviation for a single word, if the table has one. */
export function lookupAbbreviation(word: string, table: AbbreviationTable): string | null {
  return table.byPhrase.get(word.trim().toLowerCase()) ?? null;
}
