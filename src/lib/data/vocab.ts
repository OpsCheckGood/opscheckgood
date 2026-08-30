import { loadDataset } from './loader';
import { DataFileError, type Dataset, type SynonymData, type VerbEntry } from './types';

import stopwordsRaw from '../../data/vocab/stopwords.json';
import verbsRaw from '../../data/vocab/verbs.json';

/**
 * Vocabulary datasets.
 *
 * Synonyms are deliberately absent here: that file is large and only feature 5
 * needs it, so it is loaded through `loadSynonyms()` as its own chunk rather
 * than pulled into the initial bundle.
 */

function normalizeStopwords(raw: unknown, _meta: unknown, file: string): ReadonlySet<string> {
  if (!Array.isArray(raw)) throw new DataFileError(file, 'data must be an array of words');
  return new Set(raw.map((w) => String(w).toLowerCase()));
}

function normalizeVerbs(raw: unknown, _meta: unknown, file: string): VerbEntry[] {
  if (!Array.isArray(raw)) throw new DataFileError(file, 'data must be an array of entries');
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || typeof (entry as VerbEntry).verb !== 'string') {
      throw new DataFileError(file, `entry ${i} must be {verb: string, category?: string}`);
    }
    const { verb, category } = entry as VerbEntry;
    return category ? { verb, category } : { verb };
  });
}

export const STOPWORDS: Dataset<ReadonlySet<string>> = loadDataset(
  'src/data/vocab/stopwords.json',
  stopwordsRaw,
  normalizeStopwords,
);

export const VERBS: Dataset<VerbEntry[]> = loadDataset(
  'src/data/vocab/verbs.json',
  verbsRaw,
  normalizeVerbs,
);

let synonymsPromise: Promise<Dataset<SynonymData>> | null = null;

/** Lazily loads the synonym map as its own chunk. Safe to call repeatedly. */
export function loadSynonyms(): Promise<Dataset<SynonymData>> {
  synonymsPromise ??= import('../../data/vocab/synonyms.json').then((module) =>
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
        return { senses, exceptions: exceptions ?? {} };
      },
    ),
  );
  return synonymsPromise;
}
