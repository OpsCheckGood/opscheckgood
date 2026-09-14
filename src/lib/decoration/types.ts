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
}

export interface CertificateDefinition {
  id: string;
  label: string;
  font: FontSpec;
  /** What the myDecs field itself refuses beyond. */
  maxChars: number;
  box: CertificateBox;
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
}

export interface AwardLanguage {
  id: string;
  label: string;
  /** Paragraph of the manual's Attachment 5 this came from. */
  ref: string;
  bases: Phrase[];
  closings: Phrase[];
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
