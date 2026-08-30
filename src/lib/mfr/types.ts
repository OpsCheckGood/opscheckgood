/**
 * Shapes for the memorandum generator.
 *
 * One document state feeds four renderers -- live preview, print view, PDF and
 * Word -- through a single intermediate `MemoSpec`. A template (Custom MFR,
 * LOCAR) is a function that turns the document into a spec; nothing downstream
 * knows which template it came from. That is what keeps a new template from
 * having to be wired into four places and landing in three of them.
 */

/** A run of text inside a paragraph. Bold and italic are the only styling. */
export interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
}

/**
 * A paragraph is plain text, a list of styled runs, or a parent carrying
 * sub-paragraphs. The same shape recurses at every depth.
 *
 * `sub` is only honoured on an object with an *array* `sub`. Testing `p.sub`
 * on a string is a trap -- every JavaScript string carries the legacy
 * `String.prototype.sub` method, so a plain string paragraph looks subdivided.
 */
export type Para = string | Run[] | { t: string | Run[]; sub: Para[] };

/** One post-signature list: attachments, courtesy copies, or distribution. */
export type TailField = 'atch' | 'cc' | 'distro';

/** An indorsement as the user edits it. */
export interface Indorsement {
  /** `ref` = separate-page (two-line header), `own` = same-page (one line). */
  form: 'ref' | 'own';
  /** Separate-page form: office, date and subject of the memo being indorsed. */
  refOffice?: string;
  refDate?: string;
  refSubject?: string;
  /** The indorsing office, and the date it signed. */
  office?: string;
  date?: string;
  /** Optional second line naming who indorses. */
  line2?: string;
  memoFor?: string;
  subj?: string;
  paras: Para[];
  sigRank?: string;
  sigName?: string;
  sigTitle?: string;
  atch?: string[];
  cc?: string[];
}

export type TemplateId = 'custom' | 'locar';
export type LocarType = 'Counseling' | 'Admonishment' | 'Reprimand';
export type LocarCategory = 'Enlisted' | 'Officer';
export type FontKey = 'times' | 'arial' | 'courier';

/**
 * Everything the user has typed. Persisted to localStorage and nowhere else.
 *
 * The letterhead is part of this rather than site configuration: this is a
 * public tool, so every unit sets its own three lines, colour and seal.
 */
export interface MemoDoc {
  template: TemplateId;

  // Letterhead -- fully editable, no default seal.
  lh1: string;
  lh2: string;
  lh3: string;
  lhColor: string;
  /** Data URL of a seal the user chose. Empty means no seal is drawn. */
  seal: string;

  font: FontKey;
  fontSize: number;

  // Signature block, shared by both templates.
  prepRank: string;
  prepName: string;
  prepTitle: string;
  /** Post-nominal shown as the recipient's title on a LOCAR indorsement. */
  prepPost: string;

  // Custom MFR.
  memoFor: string;
  from: string;
  subject: string;
  paras: Para[];
  atch: string[];
  cc: string[];
  distro: string[];
  inds: Indorsement[];

  // LOCAR.
  locarType: LocarType;
  locarCat: LocarCategory;
  locarRecipRank: string;
  locarRecipName: string;
  locarDayServed: string;
  locarOtherInfo: string;
  locarOffense: string;
  locarCorrective: string;
  locarUif: 'none' | 'recommend';
  locarFrom: string;

  // CUI marking, remembered per template.
  cuiMap: Partial<Record<TemplateId, boolean>>;
  cuiDesMap: Partial<Record<TemplateId, boolean>>;
  cuiDesComp: string;
  cuiDesOffice: string;
  cuiDesCat: string;
  cuiDesDist: string;
  cuiDesPoc: string;
}

/** One indorsement, resolved into what actually prints. */
export interface SpecIndorsement {
  head: string;
  headRight?: string;
  line2?: string;
  line2Right?: string;
  memoFor?: string;
  subj?: string;
  numbered: boolean;
  paras: Para[];
  atch?: string[];
  cc?: string[];
  distro?: string[];
  sig: { name: string; rank: string; title: string };
}

/**
 * The rendered form of a memorandum: what every exporter reads. No exporter
 * looks at `MemoDoc`, so a template only has to produce one of these.
 */
export interface MemoSpec {
  date: string;
  memoFor: string;
  from: string;
  subject: string;
  paras: Para[];
  atch?: string[];
  cc?: string[];
  distro?: string[];
  inds?: SpecIndorsement[];
  /** Signature block for the basic memorandum. */
  sig: { name: string; rank: string; title: string };
  /** Base filename, no extension. */
  filename: string;
}
