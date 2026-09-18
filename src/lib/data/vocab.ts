import { loadDataset } from './loader';
import {
  DataFileError,
  type ActionVerbIndex,
  type Dataset,
  type FluffData,
  type FluffSeverity,
  type SynonymData,
  type VerbEntry,
  type WeakOpener,
} from './types';

import adverbsRaw from '../../data/vocab/adverbs.json';
import fluffRaw from '../../data/vocab/fluff.json';
import irregularPastRaw from '../../data/vocab/irregular-past.json';
import stopwordsRaw from '../../data/vocab/stopwords.json';
import weakOpenersRaw from '../../data/vocab/weak-openers.json';

/**
 * Vocabulary datasets.
 *
 * Synonyms and the action-verb list are deliberately absent from the eager
 * imports: the dictionary is large and the verb list is only wanted once a
 * word is selected or the Verbs page opens, so both load through
 * `loadSynonyms()` / `loadVerbs()` as their own chunks rather than being
 * pulled into the initial bundle. `loadSynonyms()` folds the verb list and
 * the irregular past-tense map into the dictionary it returns, so every
 * lookup sees one object.
 */

function normalizeStopwords(raw: unknown, _meta: unknown, file: string): ReadonlySet<string> {
  if (!Array.isArray(raw)) throw new DataFileError(file, 'data must be an array of words');
  return new Set(raw.map((w) => String(w).toLowerCase()));
}

function normalizeVerbs(raw: unknown, _meta: unknown, file: string): VerbEntry[] {
  if (!Array.isArray(raw)) throw new DataFileError(file, 'data must be an array of entries');
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const e = entry as Partial<VerbEntry>;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.verb !== 'string' ||
      e.verb === '' ||
      typeof e.base !== 'string' ||
      e.base === '' ||
      !Array.isArray(e.synonyms)
    ) {
      throw new DataFileError(file, `entry ${i} must be {verb, base, synonyms[], category?}`);
    }
    const verb = e.verb.toLowerCase();
    if (seen.has(verb)) throw new DataFileError(file, `entry ${i} repeats "${verb}"`);
    seen.add(verb);
    const out: VerbEntry = {
      verb,
      base: e.base.toLowerCase(),
      synonyms: e.synonyms.map((s) => String(s).toLowerCase()),
    };
    if (typeof e.category === 'string' && e.category !== '') out.category = e.category;
    if (e.tq === true) out.tq = true;
    return out;
  });
}

function normalizeIrregularPast(raw: unknown, _meta: unknown, file: string): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DataFileError(file, 'data must be an object of base -> past');
  }
  const out: Record<string, string> = {};
  for (const [base, past] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof past !== 'string' || past === '') {
      throw new DataFileError(file, `"${base}" must map to a past-tense string`);
    }
    out[base.toLowerCase()] = past.toLowerCase();
  }
  return out;
}

function normalizeWeakOpeners(raw: unknown, _meta: unknown, file: string): WeakOpener[] {
  if (!Array.isArray(raw)) throw new DataFileError(file, 'data must be an array of entries');
  return raw.map((entry, i) => {
    const e = entry as Partial<WeakOpener>;
    if (typeof e !== 'object' || e === null || typeof e.word !== 'string' || e.word === '') {
      throw new DataFileError(file, `entry ${i} must be {word, why, try}`);
    }
    return {
      word: e.word.toLowerCase(),
      why: typeof e.why === 'string' ? e.why : '',
      try: Array.isArray(e.try) ? e.try.map(String) : [],
    };
  });
}

const SEVERITIES: ReadonlySet<string> = new Set<FluffSeverity>(['high', 'medium', 'low']);

function normalizeFluff(raw: unknown, _meta: unknown, file: string): FluffData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DataFileError(file, 'data must be an object');
  }
  const d = raw as Partial<FluffData>;
  const t = d.thresholds;
  if (!t || [t.sentenceWords, t.acronyms, t.semicolons, t.slashes, t.parentheticals].some((n) => typeof n !== 'number' || n <= 0)) {
    throw new DataFileError(file, 'thresholds must be positive numbers');
  }
  if (typeof d.categories !== 'object' || d.categories === null) {
    throw new DataFileError(file, 'categories must be an object');
  }
  for (const [id, c] of Object.entries(d.categories)) {
    if (!c || typeof c.label !== 'string' || !SEVERITIES.has(c.severity) || typeof c.ask !== 'string') {
      throw new DataFileError(file, `category "${id}" must have label, severity and ask`);
    }
  }
  if (!Array.isArray(d.terms)) throw new DataFileError(file, 'terms must be an array');
  const seen = new Set<string>();
  const terms = d.terms.map((e, i) => {
    if (!e || typeof e.term !== 'string' || e.term.trim() === '' || typeof e.category !== 'string') {
      throw new DataFileError(file, `term ${i} must have term and category`);
    }
    const term = e.term.trim().toLowerCase();
    if (seen.has(term)) throw new DataFileError(file, `term "${term}" appears twice`);
    seen.add(term);
    if (!Object.hasOwn(d.categories!, e.category)) {
      throw new DataFileError(file, `term "${term}" names unknown category "${e.category}"`);
    }
    if (e.severity !== undefined && !SEVERITIES.has(e.severity)) {
      throw new DataFileError(file, `term "${term}" has an unknown severity`);
    }
    const out: FluffData['terms'][number] = { term, category: e.category };
    if (e.severity) out.severity = e.severity;
    if (Array.isArray(e.try) && e.try.length > 0) out.try = e.try.map(String);
    return out;
  });
  const list = (v: unknown, what: string) => {
    if (!Array.isArray(v)) throw new DataFileError(file, `${what} must be an array of words`);
    return v.map((w) => String(w).toLowerCase());
  };
  return {
    thresholds: { ...t },
    categories: d.categories,
    terms,
    signals: {
      impact: list(d.signals?.impact, 'signals.impact'),
      scope: list(d.signals?.scope, 'signals.scope'),
      result: list(d.signals?.result, 'signals.result'),
    },
    units: list(d.units, 'units'),
  };
}

export const FLUFF: Dataset<FluffData> = loadDataset(
  'src/data/vocab/fluff.json',
  fluffRaw,
  normalizeFluff,
);

function normalizeWordList(raw: unknown, _meta: unknown, file: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DataFileError(file, 'data must be a non-empty array of words');
  }
  const words = raw.map((w) => String(w).toLowerCase());
  if (new Set(words).size !== words.length) throw new DataFileError(file, 'a word repeats');
  return words;
}

/** The Tongue and Quill's sample adverbs, for the Verbs page. */
export const ADVERBS: Dataset<string[]> = loadDataset(
  'src/data/vocab/adverbs.json',
  adverbsRaw,
  normalizeWordList,
);

export const STOPWORDS: Dataset<ReadonlySet<string>> = loadDataset(
  'src/data/vocab/stopwords.json',
  stopwordsRaw,
  normalizeStopwords,
);

export const IRREGULAR_PAST: Dataset<Record<string, string>> = loadDataset(
  'src/data/vocab/irregular-past.json',
  irregularPastRaw,
  normalizeIrregularPast,
);

let verbsPromise: Promise<Dataset<VerbEntry[]>> | null = null;

/** Lazily loads the curated action-verb list as its own chunk. */
export function loadVerbs(): Promise<Dataset<VerbEntry[]>> {
  verbsPromise ??= import('../../data/vocab/verbs.json').then((module) =>
    loadDataset<unknown, VerbEntry[]>('src/data/vocab/verbs.json', module.default, normalizeVerbs),
  );
  return verbsPromise;
}

/** The verb list keyed by dictionary form, which is what a lookup resolves to. */
export function indexActionVerbs(entries: readonly VerbEntry[]): ActionVerbIndex {
  const index: ActionVerbIndex = {};
  for (const entry of entries) {
    // First entry wins when two share a base ("found" and "founded" do not,
    // but a future edit might); the list is alphabetical, so that is stable.
    index[entry.base] ??= { verb: entry.verb, synonyms: entry.synonyms };
  }
  return index;
}

export const WEAK_OPENERS: Dataset<WeakOpener[]> = loadDataset(
  'src/data/vocab/weak-openers.json',
  weakOpenersRaw,
  normalizeWeakOpeners,
);

let synonymsPromise: Promise<Dataset<SynonymData>> | null = null;

/**
 * Lazily loads the synonym map as its own chunk. Safe to call repeatedly.
 *
 * The returned data also carries the irregular past-tense map and the
 * action-verb list, so a lookup that gets this object needs nothing else.
 */
export function loadSynonyms(): Promise<Dataset<SynonymData>> {
  synonymsPromise ??= Promise.all([import('../../data/vocab/synonyms.json'), loadVerbs()]).then(
    ([module, verbs]) =>
      loadDataset<SynonymData, SynonymData>(
        'src/data/vocab/synonyms.json',
        module.default,
        (raw, _meta, file) => {
          if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            throw new DataFileError(file, 'data must be an object');
          }
          const { senses, exceptions } = raw as Partial<SynonymData>;
          if (typeof senses !== 'object' || senses === null) {
            throw new DataFileError(file, 'data.senses must be an object of lemma -> senses');
          }
          return {
            senses,
            exceptions: exceptions ?? {},
            pastTense: IRREGULAR_PAST.data,
            actionVerbs: indexActionVerbs(verbs.data),
          };
        },
      ),
  );
  return synonymsPromise;
}
