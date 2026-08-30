/**
 * Shared shapes for everything under /src/data.
 *
 * Every dataset in this project -- form definitions, abbreviation tables, vocab
 * lists, and (phase 2) PT scoring tables -- is a `DataFile<T>`: a `meta` block
 * describing provenance plus a `data` payload. Nothing bypasses this.
 */

/**
 * `stub` means the values are placeholders the maintainer has not yet replaced
 * from an official source. Stubs are allowed to hold zeros and "TBD" strings,
 * but any tool that consumes one must show an unverified-data banner.
 *
 * `verified` asserts the values were transcribed from the cited source. The
 * validation tests hold verified files to a much stricter bar.
 */
export type DataStatus = 'stub' | 'verified';

export interface DataMeta {
  /** Human-readable name of the source document, e.g. "AF Form 1206". */
  source: string;
  /** Version or revision of that source, e.g. a form date "20240101". */
  version: string;
  /** ISO 8601 date (YYYY-MM-DD) the values were last checked against source. */
  verifiedDate: string;
  /** Canonical URL for the source document. */
  sourceUrl: string;
  status: DataStatus;
  /** How the values were obtained, and anything a future reader needs to know. */
  notes?: string;
  /** Required when the payload is derived from a third-party licensed work. */
  license?: string;
}

export interface DataFile<T> {
  meta: DataMeta;
  data: T;
}

/** A dataset after loading: validated, normalized, and provenance-stamped. */
export interface Dataset<T> {
  readonly meta: DataMeta;
  readonly data: T;
  /** True when `meta.status === 'stub'`. Drives the UI banner. */
  readonly isStub: boolean;
}

/** Thrown when a data file is structurally invalid. Always names the file. */
export class DataFileError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'DataFileError';
  }
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Which metric actually binds on a given field.
 *
 * 1206 accomplishment blocks are width-driven; EPB narrative blocks are
 * character-limited. The UI highlights the binding metric and shows the other
 * as informational -- both are always displayed.
 */
export type Constraint = 'width' | 'chars';

export interface FontSpec {
  family: string;
  sizePt: number;
  /** Path under /public, e.g. "/fonts/LiberationSerif-Regular.ttf". */
  file: string;
}

export interface FormField {
  id: string;
  label: string;
  constraint: Constraint;
  /** Usable line width in millimetres. Required when constraint is 'width'. */
  widthMm: number | null;
  /** Maximum characters per line. Required when constraint is 'chars'. */
  maxChars: number | null;
  /** How many lines the block holds. Informational. */
  lines: number | null;
}

export interface FormDefinition {
  id: string;
  label: string;
  font: FontSpec;
  fields: FormField[];
}

// ---------------------------------------------------------------------------
// Abbreviations
// ---------------------------------------------------------------------------

/**
 * HQ-approved entries are on the official list. Common entries are widely used
 * but locally variable -- the UI always pairs them with the local-guidance note.
 */
export type AbbreviationTier = 'hq-approved' | 'common';

export interface AbbreviationEntry {
  /** The full phrase, e.g. "United States Air Force Academy". */
  phrase: string;
  /** The abbreviation, e.g. "USAFA". */
  abbr: string;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export interface VerbEntry {
  verb: string;
  /** Optional grouping, e.g. "leadership". Purely for display. */
  category?: string;
}

/** lemma -> synonyms. Lazily loaded; see constraint 1 in CLAUDE.md. */
export type SynonymMap = Record<string, string[]>;
