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

/** Lazily loaded; see constraint 1 in CLAUDE.md. */
export interface SynonymData {
  /** Dictionary form -> synonyms, e.g. lead -> [direct, guide, ...]. */
  synonyms: Record<string, string[]>;
  /**
   * Irregular inflected form -> dictionary form, e.g. led -> lead. Bullets are
   * written in the past tense, so without this most lookups find nothing.
   */
  exceptions: Record<string, string>;
  /**
   * Dictionary form -> [part of speech initial, definition]. Shown so a writer
   * can tell whether the word they picked means what they think, before
   * swapping it for something shorter.
   */
  definitions: Record<string, [string, string]>;
}

// ---------------------------------------------------------------------------
// PT (physical fitness assessment)
// ---------------------------------------------------------------------------

/**
 * Scoring standards are versioned per source edition and are entirely data.
 *
 * Constraint 4 and the phase-2 note in CLAUDE.md both land here: the choice
 * between push-ups and hand-release push-ups, or between a run, a shuttle, and
 * a walk, is an `EventDefinition` in the JSON -- never a branch in a component.
 * Supporting a new event is a data edit plus nothing else.
 */

export type Sex = 'male' | 'female';

/** How a raw entry is typed in, which is not the same as how it is scored. */
export type EventInput = 'count' | 'time' | 'waist';

/** Which direction along a table's rows counts as better performance. */
export type Better = 'higher' | 'lower';

/**
 * `table`     -- look the raw value up in a scoring table, take ladder points.
 * `passFail`  -- compare against a maximum; earns no points and no percentage.
 * `ratio`     -- the waist-to-height ladder, which has its own input shape.
 */
export type EventKind = 'table' | 'passFail' | 'ratio';

/** An age band. `maxAge` null means "and over" -- always the final entry. */
export interface AgeGroup {
  id: string;
  label: string;
  maxAge: number | null;
}

export interface EventDefinition {
  id: string;
  /** The maintainer's own option wording, e.g. "Hand Release Push-up". */
  label: string;
  /** Column heading on the chart, where the full label will not fit. */
  shortLabel: string;
  kind: EventKind;
  /** Key into `PtStandards.tables`. Required when kind is 'table'. */
  table?: string;
  /** Key into `PtStandards.limitTables`. Required when kind is 'passFail'. */
  limits?: string;
  unit?: string;
  /** Caption over the input box, e.g. "REPS" or "MIN:SEC". */
  unitLabel?: string;
  better?: Better;
  input: EventInput;
  /** Passing this event caps the rating below Excellent (the 2 km walk). */
  excludesExcellent?: boolean;
  /** Shown whenever this event is selected. */
  note?: string;
}

export interface RatioLadderRow {
  label: string;
  /** Highest ratio earning these points. null on the final catch-all row. */
  ratioMax: number | null;
  points: number;
}

export interface RiskBand {
  ratioMax: number | null;
  label: string;
}

export interface ComponentDefinition {
  id: string;
  label: string;
  shortLabel: string;
  /** Points this component contributes when it is assessed. */
  maxPoints: number;
  kind: 'table' | 'ratio';
  /** Key into `PtStandards.pointLadders`. Absent for ratio components. */
  ladder?: string;
  /** False for body composition, which has no component minimum. */
  hasMinimum: boolean;
  events: EventDefinition[];
  ladderRows?: RatioLadderRow[];
  riskBands?: RiskBand[];
}

/**
 * One scoring table. `rows` runs best-performance-first; the row index is the
 * index into the component's point ladder, so the two lengths must match.
 *
 * A row holds one cell per (age group x sex) in declaration order, so the
 * column is `ageIndex * sexes.length + sexIndex`. `neutral` is the single
 * age- and sex-neutral column used by the AFSPECWAR/EOD track.
 */
export interface ScoringTable {
  rows: number[][];
  neutral: number[];
}

/** A pass/fail maximum, bracketed on its own age bands. */
export interface LimitTable {
  label: string;
  ageGroups: AgeGroup[];
  bySex: Record<Sex, number[]>;
}

export interface RatingRules {
  passMinPercent: number;
  excellentMinPercent: number;
  /** Above this WHtR, an unsatisfactory score triggers a Tier 2 BFA. */
  tier2BfaRatioOver: number;
}

export interface PtTrack {
  id: string;
  label: string;
  /** True when the track scores off the age- and sex-neutral column. */
  neutral: boolean;
}

export interface PtStandards {
  id: string;
  label: string;
  ageRange: { min: number; max: number };
  sexes: { id: Sex; label: string }[];
  ageGroups: AgeGroup[];
  tracks: PtTrack[];
  pointLadders: Record<string, number[]>;
  components: ComponentDefinition[];
  tables: Record<string, ScoringTable>;
  limitTables: Record<string, LimitTable>;
  /** Footnotes the source prints under its chart. Rendered verbatim. */
  chartNotes: string[];
  rating: RatingRules;
}
