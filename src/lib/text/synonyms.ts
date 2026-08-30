import type { SynonymData } from '../data/types';

/**
 * Synonym lookup for a selected word.
 *
 * The hard part is not the dictionary, it is the tense. Bullets are written in
 * the past tense -- "led", "facilitated", "headed" -- and none of those are
 * WordNet lemmas. So a lookup has to reduce the selected word to its dictionary
 * form, then push each synonym back into the same form before offering it.
 *
 * Re-inflection uses regular rules and will occasionally produce something
 * ugly. That is why the option list shows the exact string that will be
 * inserted rather than the dictionary form: the user reads what they are about
 * to get and simply does not pick the bad one.
 */

export type Inflection = 'none' | 's' | 'ed' | 'ing';

export interface SynonymOption {
  /** Exactly the text that will replace the selection. */
  text: string;
  /** Dictionary form it came from. */
  lemma: string;
  /** True when the form was reconstructed rather than looked up verbatim. */
  reconstructed: boolean;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

const isVowel = (ch: string) => VOWELS.has(ch);

/** Rough syllable count: runs of vowels. Good enough for the rule below. */
function syllables(word: string): number {
  return (word.match(/[aeiouy]+/g) ?? []).length;
}

/**
 * Consonant-vowel-consonant ending, which doubles before -ed / -ing.
 *
 * Only for single-syllable bases. English doubles on a stressed final syllable
 * ("plan" -> "planned", "prefer" -> "preferred") and not otherwise ("target"
 * -> "targeted"). Stress is not derivable from spelling, and multi-syllable
 * words are far more often unstressed at the end, so doubling only when there
 * is one syllable gets the common cases right and fails quietly on the rest.
 */
function doublesFinalConsonant(base: string): boolean {
  if (base.length < 3 || syllables(base) !== 1) return false;
  const [c1, v, c2] = [base.at(-3)!, base.at(-2)!, base.at(-1)!];
  return !isVowel(c1) && isVowel(v) && !isVowel(c2) && !'wxy'.includes(c2);
}

export function inflect(base: string, form: Inflection): string {
  if (form === 'none') return base;
  const last = base.at(-1) ?? '';
  const penultimate = base.at(-2) ?? '';

  if (form === 's') {
    if (/(s|x|z|ch|sh)$/.test(base)) return `${base}es`;
    if (last === 'y' && !isVowel(penultimate)) return `${base.slice(0, -1)}ies`;
    return `${base}s`;
  }
  if (form === 'ed') {
    if (last === 'e') return `${base}d`;
    if (last === 'y' && !isVowel(penultimate)) return `${base.slice(0, -1)}ied`;
    if (doublesFinalConsonant(base)) return `${base}${last}ed`;
    return `${base}ed`;
  }
  // ing
  if (last === 'e' && penultimate !== 'e') return `${base.slice(0, -1)}ing`;
  if (doublesFinalConsonant(base)) return `${base}${last}ing`;
  return `${base}ing`;
}

/** Candidate dictionary forms for an inflected word, best guess first. */
function candidateBases(word: string): Array<{ base: string; form: Inflection }> {
  const out: Array<{ base: string; form: Inflection }> = [];
  const add = (base: string, form: Inflection) => {
    if (base.length >= 2) out.push({ base, form });
  };

  if (word.endsWith('ies') && word.length > 4) add(`${word.slice(0, -3)}y`, 's');
  if (word.endsWith('es') && word.length > 3) {
    add(word.slice(0, -2), 's');
    add(word.slice(0, -1), 's');
  }
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1), 's');

  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    add(stem, 'ing');
    add(`${stem}e`, 'ing');
    if (stem.length > 1 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1), 'ing');
  }
  if (word.endsWith('ied') && word.length > 4) add(`${word.slice(0, -3)}y`, 'ed');
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    add(stem, 'ed');
    add(word.slice(0, -1), 'ed');
    if (stem.length > 1 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1), 'ed');
  }
  return out;
}

/** Applies the selected word's capitalisation to a replacement. */
export function matchCase(replacement: string, original: string): string {
  if (original.length === 0) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0]!.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Bases that inflect irregularly, taken from the exception map's own values.
 *
 * A regular -ed rule turns "take" into "taked" and "send" into "sended". We
 * cannot produce the right form without knowing which exception is the past
 * tense rather than the participle, so instead of offering something wrong we
 * drop the option. Silence beats "taked" at the top of the list.
 */
const irregularCache = new WeakMap<SynonymData, Set<string>>();

function irregularBases(data: SynonymData): Set<string> {
  let set = irregularCache.get(data);
  if (!set) {
    set = new Set(Object.values(data.exceptions));
    irregularCache.set(data, set);
  }
  return set;
}

const PART_OF_SPEECH: Record<string, string> = { v: 'verb', a: 'adjective', n: 'noun' };

export interface Definition {
  /** The dictionary form the definition belongs to. */
  lemma: string;
  partOfSpeech: string;
  text: string;
  /** True when the selected word was inflected and had to be reduced. */
  reduced: boolean;
}

/**
 * Reduces a selected word to the dictionary form the data is keyed on.
 *
 * Shared by the synonym and definition lookups so they can never disagree
 * about which word is being described.
 */
export function resolveLemma(
  word: string,
  data: SynonymData,
): { lemma: string; form: Inflection } | null {
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  if (data.synonyms[lower] || data.definitions[lower]) {
    return { lemma: lower, form: 'none' };
  }
  const irregular = data.exceptions[lower];
  if (irregular) {
    const form: Inflection = lower.endsWith('ing')
      ? 'ing'
      : lower.endsWith('s')
        ? 's'
        : 'ed';
    return { lemma: irregular, form };
  }
  for (const candidate of candidateBases(lower)) {
    if (data.synonyms[candidate.base] || data.definitions[candidate.base]) {
      return { lemma: candidate.base, form: candidate.form };
    }
  }
  return null;
}

export function findDefinition(word: string, data: SynonymData): Definition | null {
  const resolved = resolveLemma(word, data);
  if (!resolved) return null;
  const entry = data.definitions[resolved.lemma];
  if (!entry) return null;
  const [pos, text] = entry;
  return {
    lemma: resolved.lemma,
    partOfSpeech: PART_OF_SPEECH[pos] ?? pos,
    text,
    reduced: resolved.form !== 'none',
  };
}

export function findSynonyms(word: string, data: SynonymData): SynonymOption[] {
  const lower = word.toLowerCase();
  if (lower.length < 3) return [];

  const direct = data.synonyms[lower];
  if (direct) {
    return direct.map((syn) => ({
      text: matchCase(syn, word),
      lemma: lower,
      reconstructed: false,
    }));
  }

  const irregulars = irregularBases(data);

  /** -ing and -s are regular even for irregular verbs; -ed is not. */
  const reconstruct = (list: readonly string[], base: string, form: Inflection) =>
    list
      .filter((syn) => form !== 'ed' || !irregulars.has(syn))
      .map((syn) => ({
        text: matchCase(inflect(syn, form), word),
        lemma: base,
        reconstructed: true,
      }));

  // Irregulars first: WordNet's own exception list is authoritative where the
  // suffix rules below would only guess.
  const irregular = data.exceptions[lower];
  if (irregular) {
    const form: Inflection = lower.endsWith('ing')
      ? 'ing'
      : lower.endsWith('s')
        ? 's'
        : 'ed';
    return reconstruct(data.synonyms[irregular] ?? [], irregular, form);
  }

  for (const { base, form } of candidateBases(lower)) {
    const list = data.synonyms[base];
    if (!list) continue;
    return reconstruct(list, base, form);
  }

  return [];
}

/** The word surrounding `index`, and where it sits, or null if not on a word. */
export function wordAt(
  text: string,
  index: number,
): { word: string; start: number; end: number } | null {
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z'’-]/.test(ch);
  if (text.length === 0) return null;

  let start = Math.min(index, text.length);
  let end = start;
  // A caret sitting just after a word should still select that word.
  if (!isWordChar(text[start]) && isWordChar(text[start - 1])) start -= 1;
  if (!isWordChar(text[start])) return null;
  end = start;
  while (isWordChar(text[start - 1])) start -= 1;
  while (isWordChar(text[end])) end += 1;

  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, '');
  if (word.length === 0) return null;
  const offset = text.slice(start, end).indexOf(word);
  return { word, start: start + offset, end: start + offset + word.length };
}
