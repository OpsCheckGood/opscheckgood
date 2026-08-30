import { loadDataset } from './loader';
import { DataFileError, type Dataset } from './types';
import type { Run } from '@/lib/mfr/types';

import locarRaw from '../../data/mfr/locar-language.json';
import memoRaw from '../../data/mfr/memo-format.json';

/**
 * The fixed wording behind the memorandum generator.
 *
 * None of this is written in a component. The LOCAR's Privacy Act statement,
 * its rights paragraph, its three indorsements and both sample libraries are
 * data; so is the sample body of a new Custom MFR. Adding a sample offence is
 * a data edit, and a component that inlined one would be a bug (constraint 4).
 *
 * Both files are stubs. The wording was transcribed by the maintainer, not
 * generated, but neither carries a citable source URL yet -- so the tool shows
 * the unverified-data banner until someone puts the official form in hand and
 * flips the status. See constraint 5.
 */

export interface LabelledSample {
  readonly label: string;
  readonly text: string;
}

export interface LocarLanguage {
  readonly types: readonly string[];
  readonly abbreviations: Readonly<Record<string, string>>;
  readonly verbs: Readonly<Record<string, string>>;
  readonly issuerRanks: readonly string[];
  readonly recipientRanks: Readonly<Record<string, readonly string[]>>;
  readonly privacyActRuns: readonly Run[];
  readonly rights: string;
  readonly uifSentence: string;
  readonly acknowledgement: {
    readonly memberFirst: readonly string[];
    readonly issuerDecision: readonly string[];
    readonly memberFinal: readonly string[];
  };
  readonly offenseSamples: readonly LabelledSample[];
  readonly correctiveSamples: readonly LabelledSample[];
}

export interface MemoFormatLanguage {
  readonly sampleSubject: string;
  readonly sampleParagraphs: readonly string[];
}

function rec(file: string, raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DataFileError(file, `${what} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function str(file: string, o: Record<string, unknown>, key: string, what: string): string {
  const value = o[key];
  if (typeof value !== 'string' || value === '') {
    throw new DataFileError(file, `${what}.${key} must be a non-empty string`);
  }
  return value;
}

function strList(file: string, o: Record<string, unknown>, key: string): string[] {
  const value = o[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new DataFileError(file, `${key} must be a non-empty array`);
  }
  return value.map((entry, i) => {
    if (typeof entry !== 'string' || entry === '') {
      throw new DataFileError(file, `${key}[${i}] must be a non-empty string`);
    }
    return entry;
  });
}

function strMap(file: string, o: Record<string, unknown>, key: string): Record<string, string> {
  const value = rec(file, o[key], key);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' || v === '') {
      throw new DataFileError(file, `${key}.${k} must be a non-empty string`);
    }
    out[k] = v;
  }
  return out;
}

/**
 * A sample library is stored as a list, not a map, so its order is the file's
 * order and a duplicate label is caught here rather than silently swallowed by
 * an object literal.
 */
function samples(file: string, o: Record<string, unknown>, key: string): LabelledSample[] {
  const value = o[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new DataFileError(file, `${key} must be a non-empty array`);
  }
  const seen = new Set<string>();
  return value.map((entry, i) => {
    const item = rec(file, entry, `${key}[${i}]`);
    const label = str(file, item, 'label', `${key}[${i}]`);
    if (seen.has(label)) {
      throw new DataFileError(file, `${key} has two entries labelled "${label}"`);
    }
    seen.add(label);
    return { label, text: str(file, item, 'text', `${key}[${i}]`) };
  });
}

export const LOCAR_LANGUAGE: Dataset<LocarLanguage> = loadDataset(
  'src/data/mfr/locar-language.json',
  locarRaw,
  (raw, _meta, file) => {
    const d = rec(file, raw, 'data');
    const types = strList(file, d, 'types');
    const abbreviations = strMap(file, d, 'abbreviations');
    const verbs = strMap(file, d, 'verbs');
    // A type with no verb prints "You are hereby ." -- catch it at load, not
    // in a signed letter.
    for (const t of types) {
      if (!verbs[t]) throw new DataFileError(file, `type "${t}" has no verb`);
      if (!abbreviations[t]) throw new DataFileError(file, `type "${t}" has no abbreviation`);
    }

    const runsRaw = d.privacyActRuns;
    if (!Array.isArray(runsRaw) || runsRaw.length === 0) {
      throw new DataFileError(file, 'privacyActRuns must be a non-empty array');
    }
    const privacyActRuns: Run[] = runsRaw.map((entry, i) => {
      const item = rec(file, entry, `privacyActRuns[${i}]`);
      if (typeof item.t !== 'string' || item.t === '') {
        throw new DataFileError(file, `privacyActRuns[${i}].t must be a non-empty string`);
      }
      return { t: item.t, b: item.b === true, i: item.i === true };
    });

    const ranks = rec(file, d.recipientRanks, 'recipientRanks');
    const recipientRanks: Record<string, string[]> = {};
    for (const key of Object.keys(ranks)) {
      recipientRanks[key] = strList(file, ranks, key);
    }
    for (const category of ['Enlisted', 'Officer']) {
      if (!recipientRanks[category]) {
        throw new DataFileError(file, `recipientRanks is missing "${category}"`);
      }
    }

    const ack = rec(file, d.acknowledgement, 'acknowledgement');
    return Object.freeze({
      types,
      abbreviations,
      verbs,
      issuerRanks: strList(file, d, 'issuerRanks'),
      recipientRanks,
      privacyActRuns,
      rights: str(file, d, 'rights', 'data'),
      uifSentence: str(file, d, 'uifSentence', 'data'),
      acknowledgement: Object.freeze({
        memberFirst: strList(file, ack, 'memberFirst'),
        issuerDecision: strList(file, ack, 'issuerDecision'),
        memberFinal: strList(file, ack, 'memberFinal'),
      }),
      offenseSamples: samples(file, d, 'offenseSamples'),
      correctiveSamples: samples(file, d, 'correctiveSamples'),
    });
  },
);

export const MEMO_FORMAT: Dataset<MemoFormatLanguage> = loadDataset(
  'src/data/mfr/memo-format.json',
  memoRaw,
  (raw, _meta, file) => {
    const d = rec(file, raw, 'data');
    return Object.freeze({
      sampleSubject: str(file, d, 'sampleSubject', 'data'),
      sampleParagraphs: strList(file, d, 'sampleParagraphs'),
    });
  },
);
