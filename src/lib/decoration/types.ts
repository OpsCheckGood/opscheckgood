/**
 * Shapes for the two decoration datasets.
 *
 * Kept beside the code that reads them rather than in lib/data/types.ts: the
 * citation writer is the only consumer, and the general types file is where
 * every tool's shapes meet.
 */

import type { FontSpec } from '../data/types';

/** How the certificate holds the citation. */
export interface CertificateBox {
  /** Inner width of the citation box in millimetres. */
  widthMm: number | null;
  /**
   * Characters per line, when someone has counted them off a real
   * certificate. Null means derive from widthMm and the font.
   */
  columns: number | null;
  /** Lines the box holds before the rest is cut off. */
  lines: number | null;
  /** Baseline to baseline, in points. */
  linePitchPt: number | null;
  /** True when the certificate sets the citation fully justified. */
  justified: boolean;
}

export type HeaderFace = 'serif' | 'serif-bold' | 'mono';

/**
 * One centred line of the certificate above or below the citation. `text`
 * may carry `{decoration}`, `{cluster}`, `{member}`, `{basis}`, `{period}`,
 * `{authority}` or `{signed}`; a line whose placeholders all come up empty
 * is not drawn.
 */
export interface HeaderLine {
  text: string;
  face: HeaderFace;
  sizePt: number;
  /** Top of the line, in points from the top of the page. Absent: flows. */
  yPt?: number;
}

export type CertificateStyle = 'daf' | 'presidential';

/** The whole page, as myDecs lays it out. Points, letter size. */
export interface PageLayout {
  widthPt: number;
  heightPt: number;
  marginPt: number;
  citationTopPt: number;
  givenUnderMyHandPt: number;
  signatureTopPt: number;
  headers: Record<CertificateStyle, { label: string; lines: HeaderLine[] }>;
  closing: HeaderLine[];
  /** Ordinal words for oak leaf clusters, index 1 = FIRST. */
  clusters: string[];
}

export interface CertificateDefinition {
  id: string;
  label: string;
  font: FontSpec;
  /** What the myDecs field itself refuses beyond. */
  maxChars: number;
  box: CertificateBox;
  page: PageLayout | null;
}

export interface ServiceOption {
  id: string;
  label: string;
  /** As it appears in the closing sentence. */
  text: string;
}

export interface PronounSet {
  id: string;
  label: string;
  reflexive: string;
  possessive: string;
}

export interface GradeTitle {
  id: string;
  abbr: string;
  /** Spelled out, for the opening sentence. */
  full: string;
  /** Short title, for the rest of the citation. */
  short: string;
  service: 'usaf' | 'ussf' | 'both';
}

/** A labelled fragment with `{placeholders}`. */
export interface Phrase {
  id: string;
  label: string;
  text: string;
  /** For a basis: what the certificate prints after FOR. Default: the label in capitals. */
  forLine?: string;
}

export interface AwardCertificate {
  style: CertificateStyle;
  /** The decoration's name as the certificate prints it, in capitals. */
  title: string;
  /** The Presidential header's authority line, when known. */
  authority: string;
}

export interface AwardLanguage {
  id: string;
  label: string;
  /** Paragraph of the manual's Attachment 5 this came from. */
  ref: string;
  /** Overrides the shared opening pattern for a decoration with its own shape. */
  pattern: string | null;
  bases: Phrase[];
  /** Optional clause after the assignment, e.g. the Bronze Star's engagement. */
  circumstances: Phrase[];
  closings: Phrase[];
  certificate: AwardCertificate;
}

export interface CitationRule {
  ref: string;
  text: string;
}

export interface CitationLanguage {
  services: ServiceOption[];
  pronouns: PronounSet[];
  grades: GradeTitle[];
  opening: {
    pattern: string;
    assignments: Phrase[];
    periods: Phrase[];
  };
  awards: AwardLanguage[];
  rules: CitationRule[];
}
