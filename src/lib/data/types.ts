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

/** One meaning of a word: part of speech, definition, and its own synonyms. */
export interface Sense {
  /** First letter of the part of speech: v, a or n. */
  p: string;
  /** Definition (gloss), with WordNet's quoted usage examples stripped. */
  g: string;
  /** Synonyms belonging to this meaning only. */
  s: string[];
}

/** Lazily loaded; see constraint 1 in the README. */
export interface SynonymData {
  /**
   * Dictionary form -> its meanings, ordered verb, adjective, noun.
   *
   * Grouped rather than flattened: "lead" means six different things, and a
   * single list would offer `conduce` as a replacement for `led a team`.
   */
  senses: Record<string, Sense[]>;
  /**
   * Irregular inflected form -> dictionary form, e.g. led -> lead. Bullets are
   * written in the past tense, so without this most lookups find nothing.
   */
  exceptions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// PT (physical fitness assessment)
// ---------------------------------------------------------------------------

/**
 * Scoring standards are versioned per source edition and are entirely data.
 *
 * Constraint 4 and the phase-2 notes both land here: the choice
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

/** How a taped measurement is rounded before it is used. */
export type MeasurementRounding =
  | 'upQuarter'
  | 'downQuarter'
  | 'downHalf'
  | 'nearestHalf';

/**
 * One site on the tape, and how it enters the circumference value.
 *
 * `sign` is what makes the male and female formulas the same code path:
 * abdomen minus neck, or natural waist plus buttocks minus neck, is just the
 * signed sum of the sites listed for that sex.
 */
export interface BodyFatSite {
  id: string;
  label: string;
  sign: 1 | -1;
  rounding: MeasurementRounding;
}

/**
 * The DoD circumference equation, as coefficients rather than as code:
 * `percent = circumference * log10(value) + height * log10(heightIn) + constant`.
 */
export interface BodyFatEquation {
  circumference: number;
  height: number;
  constant: number;
}

/** The tape standard for one sex. */
export interface BodyFatStandard {
  /** How the circumference value is described, e.g. "abdomen - neck". */
  formulaLabel: string;
  /** How the standard is printed, e.g. "Less than 26%". */
  standardLabel: string;
  /**
   * The standard, which a result must come in UNDER to pass.
   *
   * AFMAN 36-2905 Table 3.2 states it as "< 26%" and "< 36%", not "or less",
   * and the manual uses "<" and "\u2264" deliberately elsewhere (para 3.10.3 is
   * "\u2264 74.9"). So a whole-percent result equal to this number does not pass.
   */
  maxPercent: number;
  /** The published table this result should be cross-checked against. */
  tableRef: string;
  sites: BodyFatSite[];
  equation: BodyFatEquation;
}

/** An evenly-spaced axis of a lookup table. */
export interface BodyFatAxis {
  start: number;
  step: number;
  count: number;
}

/**
 * A published body fat percent table: AFMAN 36-2905 Attachment 9 (male) or 10
 * (female). `rows[circumferenceIndex][heightIndex]` is a whole percent.
 *
 * This is the authority the manual actually points at. The circumference
 * equation reproduces it to within a point, but a point is the difference
 * between meeting the standard and not.
 */
export interface BodyFatTable {
  circumference: BodyFatAxis;
  height: BodyFatAxis;
  rows: number[][];
}

/**
 * Tier 2 body fat assessment.
 *
 * Required only when the waist-to-height ratio is over
 * `RatingRules.tier2BfaRatioOver` and the assessment is otherwise not met.
 * Everything about it -- which sites are taped, which way each one rounds, the
 * equation, the maximum -- is data, exactly as the scoring tables are.
 */
export interface BodyFatRules {
  label: string;
  heightRounding: MeasurementRounding;
  percentRounding: 'nearestWhole';
  bySex: Record<Sex, BodyFatStandard>;
  /** Attachments 9 and 10. Absent only if the tables file is not shipped. */
  tables?: Record<Sex, BodyFatTable>;
  /** Tape instructions, rendered verbatim under the inputs. */
  siteNotes: string[];
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
  /** Absent in an edition that does not define a tape assessment. */
  bodyFat?: BodyFatRules;
  rating: RatingRules;
}

// ---------------------------------------------------------------------------
// Promotion (below-the-zone)
// ---------------------------------------------------------------------------

/**
 * Enlisted promotion rules, as data.
 *
 * The same stance as the PT tables: the *numbers* -- how many months of time in
 * service, how many of time in grade, how far below the zone a BTZ promotion
 * lands, which months a board sits in -- are never written into code. A change
 * to the instruction is a change to the JSON.
 *
 * What code does know is a small closed set of shapes, exactly as `EventKind`
 * is a closed set for PT: a promotion is reached by one of several `paths`, and
 * a check is either `computed` (the engine evaluates it) or `attested` (the
 * user answers yes or no). Adding a fourth path or a sixth attested question is
 * a data edit. Adding a new *kind* of computed check is not, and should not be
 * -- there are two, and both are named in `ComputedCheck`.
 */

export interface GradeDefinition {
  id: string;
  /** "A1C". What the tool prints. */
  abbr: string;
  /** "Airman First Class". */
  label: string;
  /** Ascending seniority. Used to tell "not yet" from "already past". */
  order: number;
}

/**
 * One route to a promotion. A path is satisfied on the LATER of its months --
 * "36 months TIS with 20 months TIG" is both conditions, not either -- and the
 * promotion itself lands on the EARLIER of its paths' dates.
 *
 * A null bound is simply absent: the 28-month TIG path constrains time in
 * grade and says nothing about time in service.
 */
export interface PromotionPath {
  id: string;
  label: string;
  /** Short form for the fill-rail legend, where the full label will not fit. */
  shortLabel: string;
  /** Months of total time in service, measured from date entered active duty. */
  tisMonths: number | null;
  /** Months of time in grade, measured from the current date of rank. */
  tigMonths: number | null;
}

/**
 * One quarter of the BTZ cycle: when packages are processed, when the board
 * sits, and which months the resulting promotions land in.
 *
 * Months are 1-12. The promotion months of the four cycles must tile the
 * calendar year exactly once, which the loader enforces -- a month claimed by
 * two cycles, or by none, would put a real Airman's board in the wrong quarter.
 */
export interface BtzCycle {
  id: string;
  processingMonths: number[];
  selectionMonth: number;
  promotionMonths: number[];
  /**
   * Derived, not authored: 0 when processing happens in the same calendar year
   * as the promotions, -1 when the promotions fall in the following year (the
   * Oct/Nov cycle, whose promotions land in Jan-Mar).
   */
  leadYearOffset: number;
}

/** The two checks the engine can evaluate on its own. */
export type ComputedCheck = 'grade' | 'window';

/** `require` blocks a projection; `advise` raises a flag beside one. */
export type CheckMode = 'require' | 'advise';

export interface BtzCheck {
  id: string;
  kind: 'computed' | 'attested';
  mode: CheckMode;
  label: string;
  /** Which predicate the engine runs. Only set when kind is 'computed'. */
  check?: ComputedCheck;
  /** The yes/no the user answers. Only set when kind is 'attested'. */
  question?: string;
  /** Which answer satisfies the check. Only set when kind is 'attested'. */
  desired?: boolean;
  pass: string;
  fail: string;
  /** Shown while an attested question has not been answered either way. */
  unanswered?: string;
  /**
   * Where in the instruction this check comes from, e.g. "para 2.3.4.4.2".
   * Rendered beside the check: a requirement a supervisor cannot trace is a
   * requirement they cannot argue with their MPF about.
   */
  authority?: string;
}

export interface BtzRules {
  label: string;
  /** How far ahead of the fully-qualified date a BTZ promotion lands. */
  monthsEarly: number;
  cycles: BtzCycle[];
  checks: BtzCheck[];
  /** Printed verbatim under the result, as the PT chart notes are. */
  notes: string[];
}

export interface PromotionRule {
  id: string;
  label: string;
  /** Grade the member holds while being considered. */
  fromGrade: string;
  /** Grade they are promoted into. */
  toGrade: string;
  paths: PromotionPath[];
  btz?: BtzRules;
}

export interface PromotionStandards {
  id: string;
  label: string;
  /** Which component these rules govern, e.g. "Regular Air Force". */
  component: string;
  grades: GradeDefinition[];
  promotions: PromotionRule[];
}

// ---------------------------------------------------------------------------
// First Sergeant Toolkit
// ---------------------------------------------------------------------------

/**
 * A routing directory, not an authority.
 *
 * Everything here answers one question: an Airman came to me with X, where do
 * I send them? The toolkit never diagnoses, never decides, and never restates
 * policy in its own words -- it names the agency and cites the publication,
 * and the official source governs.
 *
 * Constraint 5 binds hardest here. A phone number that is plausible and wrong
 * is worse than an absent one in every case, and catastrophically worse for a
 * crisis line, so no number is ever generated. Contacts ship empty and the UI
 * says so until a maintainer fills them in from an official directory.
 */

/**
 * `crisis` agencies are the ones a Shirt needs at 0200 with no warning. They
 * sort first, and an installation cannot be called verified while any of them
 * is unpopulated.
 */
export type Urgency = 'crisis' | 'standard';

export interface AgencyCategory {
  id: string;
  label: string;
  /** What this agency actually handles, in a Shirt's terms rather than a org chart's. */
  blurb: string;
  urgency: Urgency;
  /**
   * MilitaryINSTALLATIONS program pages carrying this agency, if any.
   *
   * Empty means Military OneSource does not publish it per installation --
   * true of most of the crisis agencies, which is exactly why the worldwide
   * fallback exists. Read by scripts/import-installations.mjs.
   */
  mosPages: string[];
}

/** One agency's details at one installation. Every string may be empty in a stub. */
export interface Contact {
  categoryId: string;
  /** The local name, e.g. "Kadena Mental Health Clinic". */
  name: string;
  phone: string;
  dsn: string;
  location: string;
  hours: string;
  /** The official page these details were read from. */
  url: string;
  notes: string;
}

export interface Installation {
  id: string;
  label: string;
  /**
   * True for the shipped placeholder. An example installation is rendered with
   * a permanent warning and can never be mistaken for a real directory.
   */
  example: boolean;
  contacts: Contact[];
}

/**
 * One entry in "I have an Airman who...".
 *
 * Deliberately a routing card and not a decision tree: it names where to start,
 * what else might apply, and what to establish first. It does not tell a Shirt
 * what the answer is.
 */
export interface Situation {
  id: string;
  /** Phrased as the Shirt would say it, e.g. "Can't pay their bills". */
  label: string;
  /** Category to send them to first. */
  startHere: string;
  /** Other categories that commonly apply. */
  alsoSee: string[];
  /** Things to establish before routing. Questions, never conclusions. */
  questions: string[];
  /** Ids into the reference library. */
  referenceIds: string[];
  /** Extra terms that should match this situation in search. */
  keywords: string[];
}

/** A pointer to official guidance. The toolkit never paraphrases the content. */
export interface ReferenceEntry {
  id: string;
  topic: string;
  /** e.g. "DAFI 36-2907". Empty until read off the real publication. */
  publication: string;
  section: string;
  url: string;
}
