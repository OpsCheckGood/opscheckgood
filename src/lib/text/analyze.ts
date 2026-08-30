import type { AbbreviationTable } from '../data/abbreviations';

/**
 * Document analysis behind the Writing Checks panel.
 *
 * Everything here reads the same text the optimizer reads, so a check can never
 * disagree with the shaped output -- the reason competing tools have to warn
 * that their shaping tool "does not work with character count".
 */

const WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** A token that looks like an acronym: two or more caps, digits allowed. */
const ACRONYM = /^[A-Z][A-Z0-9]*(?:[&/-][A-Z0-9]+)*$/;

export interface DuplicateWord {
  word: string;
  count: number;
  /**
   * True when the repeats are inflections of one stem rather than the same
   * word twice (led / leads / leading). Reported as a softer warning, because
   * varying the form is often deliberate.
   */
  related: boolean;
  forms: string[];
}

/**
 * Irregular forms suffix stripping cannot reach.
 *
 * Deliberately tiny. "led" is here because grouping led/leads/leading is the
 * behaviour the tool is specified to have, and no amount of suffix rules gets
 * there -- "led" is not "lead" plus an ending. Extend as real bullets prove
 * cases worth adding; if it grows past a handful, move it to /src/data.
 */
const IRREGULAR: Record<string, string> = {
  led: 'lead',
  ran: 'run',
  wrote: 'write',
  built: 'build',
  taught: 'teach',
  oversaw: 'oversee',
  rebuilt: 'rebuild',
};

/**
 * Crude suffix stripping. Cheap on purpose -- a real stemmer is not worth the
 * bundle for what is only ever a softer warning.
 */
function stem(word: string): string {
  const w = word.toLowerCase();
  const irregular = IRREGULAR[w];
  if (irregular) return irregular;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      return w.slice(0, -suffix.length);
    }
  }
  return w;
}

export function findDuplicates(
  text: string,
  stopwords: ReadonlySet<string>,
): DuplicateWord[] {
  const byStem = new Map<string, string[]>();

  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    const lower = word.toLowerCase();
    if (lower.length < 3 || stopwords.has(lower)) continue;
    const key = stem(lower);
    const forms = byStem.get(key);
    if (forms) forms.push(lower);
    else byStem.set(key, [lower]);
  }

  const duplicates: DuplicateWord[] = [];
  for (const forms of byStem.values()) {
    if (forms.length < 2) continue;
    const distinct = [...new Set(forms)];
    duplicates.push({
      word: distinct[0]!,
      count: forms.length,
      related: distinct.length > 1,
      forms: distinct,
    });
  }

  return duplicates.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

export type AcronymTier = 'hq-approved' | 'common' | 'unknown';

export interface FoundAcronym {
  token: string;
  tier: AcronymTier;
  /** The expansion, when the tables know one. */
  phrase: string | null;
  count: number;
}

function abbrIndex(table: AbbreviationTable): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of table.entries) {
    const key = entry.abbr.toLowerCase();
    if (!index.has(key)) index.set(key, entry.phrase);
  }
  return index;
}

export function findAcronyms(
  text: string,
  hq: AbbreviationTable,
  common: AbbreviationTable,
): FoundAcronym[] {
  const hqIndex = abbrIndex(hq);
  const commonIndex = abbrIndex(common);
  const counts = new Map<string, number>();

  // Split on whitespace, then strip surrounding punctuation, so "MAJCOM;" and
  // "(USAF)" still register while "w/" and "--" do not.
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9&/-]+$/g, '');
    if (token.length < 2 || !ACRONYM.test(token)) continue;
    if (/^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const found: FoundAcronym[] = [];
  for (const [token, count] of counts) {
    const key = token.toLowerCase();
    const hqPhrase = hqIndex.get(key);
    const commonPhrase = commonIndex.get(key);
    found.push({
      token,
      count,
      tier: hqPhrase ? 'hq-approved' : commonPhrase ? 'common' : 'unknown',
      phrase: hqPhrase ?? commonPhrase ?? null,
    });
  }

  const rank: Record<AcronymTier, number> = { unknown: 0, common: 1, 'hq-approved': 2 };
  return found.sort((a, b) => rank[a.tier] - rank[b.tier] || a.token.localeCompare(b.token));
}
