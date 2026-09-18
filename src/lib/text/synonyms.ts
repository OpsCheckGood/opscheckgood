import type { Sense, SynonymData } from '../data/types';

/**
 * Synonym lookup for a selected word.
 *
 * The hard part is not the dictionary, it is the tense. Bullets are written in
 * the past tense -- "led", "facilitated", "headed" -- and none of those are
 * WordNet lemmas. So a lookup has to reduce the selected word to its dictionary
 * form, then push each synonym back into the same form before offering it.
 *
 * Re-inflection uses regular rules, plus a map of irregular pasts (lead ->
 * led) so the verbs bullets are actually built from come back right. It will
 * still occasionally produce something ugly. That is why the option list
 * shows the exact string that will be inserted rather than the dictionary
 * form: the user reads what they are about to get and simply does not pick
 * the bad one.
 *
 * Two sources feed a lookup. The curated action-verb list comes first: its
 * three or so picks per verb were chosen for bullets, and they lead the list
 * flagged as such. The dictionary follows with everything else.
 */

export type Inflection = 'none' | 's' | 'ed' | 'ing';

export interface SynonymOption {
  /** Exactly the text that will replace the selection. */
  text: string;
  /** Dictionary form it came from. */
  lemma: string;
  /** True when the form was reconstructed rather than looked up verbatim. */
  reconstructed: boolean;
  /** True when it comes from the curated action-verb list, not the dictionary. */
  curated: boolean;
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

/**
 * Puts a dictionary form into `form`. `pastTense` supplies irregular simple
 * pasts; without it an irregular base gets the regular rule, which is wrong.
 */
export function inflect(
  base: string,
  form: Inflection,
  pastTense?: Readonly<Record<string, string>>,
): string {
  if (form === 'none') return base;
  if (form === 'ed' && pastTense && Object.hasOwn(pastTense, base)) return pastTense[base]!;
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

  // A stem that would double its last consonant cannot be the base: "cod"
  // gives "codded", so "coded" must come from "code". Tried in that order,
  // with the bare stem kept as a fallback since the doubling rule is a guess.
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    if (doublesFinalConsonant(stem)) add(`${stem}e`, 'ing');
    add(stem, 'ing');
    add(`${stem}e`, 'ing');
    if (stem.length > 1 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1), 'ing');
  }
  if (word.endsWith('ied') && word.length > 4) add(`${word.slice(0, -3)}y`, 'ed');
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    if (doublesFinalConsonant(stem)) add(word.slice(0, -1), 'ed');
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

const PART_OF_SPEECH: Record<string, string> = { v: 'verb', a: 'adjective', n: 'noun' };

/**
 * Own-property lookup.
 *
 * The data is a JSON object keyed by dictionary words, and WordNet contains
 * "constructor", "toString" and "valueOf". A bare `data.senses[word]` returns
 * an inherited function for those, so every lookup goes through here.
 */
function sensesFor(data: SynonymData, lemma: string): Sense[] | undefined {
  return Object.hasOwn(data.senses, lemma) ? data.senses[lemma] : undefined;
}

function exceptionFor(data: SynonymData, word: string): string | undefined {
  return Object.hasOwn(data.exceptions, word) ? data.exceptions[word] : undefined;
}

function actionVerbFor(data: SynonymData, lemma: string) {
  const verbs = data.actionVerbs;
  return verbs && Object.hasOwn(verbs, lemma) ? verbs[lemma] : undefined;
}

/** Past-tense form -> base, for the listed verbs; built once per dataset. */
const actionPastCache = new WeakMap<SynonymData, Map<string, string>>();

function actionVerbByPast(data: SynonymData): Map<string, string> {
  let map = actionPastCache.get(data);
  if (!map) {
    map = new Map();
    for (const [base, entry] of Object.entries(data.actionVerbs ?? {})) {
      if (!map.has(entry.verb)) map.set(entry.verb, base);
    }
    actionPastCache.set(data, map);
  }
  return map;
}

/** The label shown where a dictionary definition would be. */
export const ACTION_VERB_LABEL = 'action verb list';
export const ACTION_VERB_DEFINITION =
  'On the curated list of verbs bullets are built from. These picks come first.';

export interface Definition {
  /** The dictionary form the definition belongs to. */
  lemma: string;
  partOfSpeech: string;
  text: string;
  /** True when the selected word was inflected and had to be reduced. */
  reduced: boolean;
  /** True when the word is on the curated action-verb list. */
  actionVerb: boolean;
}

/** One meaning, with its synonyms already put into the selected word's form. */
export interface ResolvedSense {
  partOfSpeech: string;
  definition: string;
  options: SynonymOption[];
  /** True for the action-verb list's entry, which leads when present. */
  curated: boolean;
}

/**
 * Reduces a selected word to the dictionary form the data is keyed on.
 *
 * Shared by every lookup so they can never disagree about which word is being
 * described.
 */
export function resolveLemma(
  word: string,
  data: SynonymData,
): { lemma: string; form: Inflection } | null {
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  if (sensesFor(data, lower) || actionVerbFor(data, lower)) return { lemma: lower, form: 'none' };

  const irregular = exceptionFor(data, lower);
  if (irregular) {
    const form: Inflection = lower.endsWith('ing')
      ? 'ing'
      : lower.endsWith('s')
        ? 's'
        : 'ed';
    // WordNet's list prefers the shorter spelling of a doubled-l verb, so
    // "installed" maps to "instal". When the regular rule reaches a longer
    // lemma the shorter one is the start of, that is the spelling people use.
    const fuller = candidateBases(lower).find(
      (c) =>
        c.form === form &&
        c.base.length > irregular.length &&
        c.base.startsWith(irregular) &&
        sensesFor(data, c.base),
    );
    return { lemma: fuller?.base ?? irregular, form };
  }
  for (const candidate of candidateBases(lower)) {
    if (sensesFor(data, candidate.base)) {
      return { lemma: candidate.base, form: candidate.form };
    }
  }
  // Listed verbs the dictionary lacks ("re-engineered", "benchmarked").
  const listedBase = actionVerbByPast(data).get(lower);
  if (listedBase) return { lemma: listedBase, form: 'ed' };
  for (const candidate of candidateBases(lower)) {
    if (actionVerbFor(data, candidate.base)) {
      return { lemma: candidate.base, form: candidate.form };
    }
  }
  return null;
}

/**
 * Bases that inflect irregularly, taken from the exception map's own values.
 *
 * A regular -ed rule turns "take" into "taked" and "send" into "sended". We
 * cannot produce the right form without knowing which exception is the past
 * tense rather than the participle, so instead of offering something wrong the
 * option is dropped. Silence beats "taked" at the top of the list.
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

/** Puts a list of dictionary forms into the form the selected word was written in. */
function optionsFor(
  synonyms: readonly string[],
  word: string,
  lemma: string,
  form: Inflection,
  irregulars: Set<string>,
  data: SynonymData,
  curated: boolean,
): SynonymOption[] {
  const pastTense = data.pastTense ?? {};
  return (
    synonyms
      // -ing and -s are regular even for irregular verbs; -ed is not, so an
      // irregular base is offered only when its past is known.
      .filter((syn) => form !== 'ed' || !irregulars.has(syn) || Object.hasOwn(pastTense, syn))
      .map((syn) => ({
        text: matchCase(form === 'none' ? syn : inflect(syn, form, pastTense), word),
        lemma,
        reconstructed: form !== 'none',
        curated,
      }))
  );
}

/** The action-verb list's entry for a lemma, shaped like a dictionary sense. */
function curatedSense(
  word: string,
  lemma: string,
  form: Inflection,
  irregulars: Set<string>,
  data: SynonymData,
): ResolvedSense | null {
  const entry = actionVerbFor(data, lemma);
  if (!entry) return null;
  return {
    partOfSpeech: 'verb',
    definition: ACTION_VERB_DEFINITION,
    options: optionsFor(entry.synonyms, word, lemma, form, irregulars, data, true),
    curated: true,
  };
}

/**
 * Every meaning of a word, each with its own definition and replacements.
 *
 * This is what the thesaurus page shows. The editor uses `findSynonyms`, which
 * flattens only the senses sharing the first one's part of speech.
 */
export function findSenses(word: string, data: SynonymData): ResolvedSense[] {
  const resolved = resolveLemma(word, data);
  if (!resolved) return [];
  const senses = sensesFor(data, resolved.lemma) ?? [];
  const irregulars = irregularBases(data);
  const { lemma, form } = resolved;

  const curated = curatedSense(word, lemma, form, irregulars, data);
  const dictionary = senses.map((sense) => ({
    partOfSpeech: PART_OF_SPEECH[sense.p] ?? sense.p,
    definition: sense.g,
    options: optionsFor(sense.s, word, lemma, form, irregulars, data, false),
    curated: false,
  }));
  return [...(curated ? [curated] : []), ...dictionary].filter(
    (sense) => sense.options.length > 0,
  );
}

export function findDefinition(word: string, data: SynonymData): Definition | null {
  const resolved = resolveLemma(word, data);
  if (!resolved) return null;
  const actionVerb = actionVerbFor(data, resolved.lemma) !== undefined;
  const first = sensesFor(data, resolved.lemma)?.[0];
  if (!first) {
    // Listed but not in the dictionary: still worth saying what it is.
    if (!actionVerb) return null;
    return {
      lemma: resolved.lemma,
      partOfSpeech: 'verb',
      text: ACTION_VERB_DEFINITION,
      reduced: resolved.form !== 'none',
      actionVerb,
    };
  }
  return {
    lemma: resolved.lemma,
    partOfSpeech: PART_OF_SPEECH[first.p] ?? first.p,
    text: first.g,
    reduced: resolved.form !== 'none',
    actionVerb,
  };
}

/**
 * A single flat list for the editor, drawn only from the senses that share the
 * first sense's part of speech.
 *
 * Mixing parts of speech is what offers `physique` as a replacement for
 * `build`. Mixing senses within one part of speech is tolerable here, because
 * the editor sorts by width and you are scanning for something shorter. The
 * action-verb list's picks lead when the word is on it, and since that entry
 * is a verb, a listed word only ever gets verbs back.
 */
export function findSynonyms(word: string, data: SynonymData): SynonymOption[] {
  const senses = findSenses(word, data);
  if (senses.length === 0) return [];

  const leading = senses[0]!.partOfSpeech;
  const seen = new Set<string>([word.toLowerCase()]);
  const out: SynonymOption[] = [];

  for (const sense of senses) {
    if (sense.partOfSpeech !== leading) break;
    for (const option of sense.options) {
      const key = option.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(option);
    }
  }
  return out;
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
