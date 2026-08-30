import type { FontMetrics } from '../metrics/font';
import { roundMm } from '../metrics/units';
import type { AbbreviationTable } from '../data/abbreviations';
import { unshape } from './spaces';
import type { ShapeResult } from './optimizer';

/**
 * Turns a shaping failure into instructions.
 *
 * Marking a line red tells the user they have a problem they already know they
 * have. The useful part is the size of the problem in their own units -- how
 * many characters to cut -- and a concrete edit that would fix it. That is what
 * makes this an editing aid rather than a formatter.
 */

export type DiagnosisKind = 'over' | 'under';

export interface AbbreviationSuggestion {
  phrase: string;
  abbr: string;
  savesMm: number;
}

export interface Diagnosis {
  kind: DiagnosisKind;
  /** How far outside the achievable range the line sits, in mm. Always > 0. */
  offByMm: number;
  /** Characters to cut (kind 'over') or add (kind 'under'), approximate. */
  characters: number;
  /** Ranked abbreviations that would help. Empty when none apply. */
  suggestions: AbbreviationSuggestion[];
  /** One-line summary. */
  headline: string;
  /** Full message, headline plus the best remedies. */
  message: string;
}

export interface DiagnoseOptions {
  font: FontMetrics;
  sizePt: number;
  /** Optional; without it, only the character-count remedy is offered. */
  abbreviations?: AbbreviationTable;
  /** How many abbreviation suggestions to include. Default 2. */
  maxSuggestions?: number;
}

/** Mean rendered width of one character in this line. */
function meanCharWidthMm(text: string, font: FontMetrics, sizePt: number): number {
  const plain = unshape(text);
  const count = [...plain].length;
  return count === 0 ? 0 : font.widthMm(plain, sizePt) / count;
}

/**
 * Every abbreviation that applies to this line, best saving first.
 *
 * Savings are measured, not estimated: the phrase and its abbreviation are both
 * rendered, because "Squadron" -> "Sq" saves a different number of millimetres
 * than its six-character difference suggests.
 */
export function abbreviationSuggestions(
  text: string,
  table: AbbreviationTable,
  font: FontMetrics,
  sizePt: number,
): AbbreviationSuggestion[] {
  const haystack = unshape(text).toLowerCase();
  const suggestions: AbbreviationSuggestion[] = [];

  for (const { phrase, abbr } of table.entries) {
    if (!haystack.includes(phrase.toLowerCase())) continue;
    const savesMm = font.widthMm(phrase, sizePt) - font.widthMm(abbr, sizePt);
    if (savesMm > 0) suggestions.push({ phrase, abbr, savesMm });
  }

  return suggestions.sort(
    (a, b) => b.savesMm - a.savesMm || a.phrase.localeCompare(b.phrase),
  );
}

export function diagnose(
  result: ShapeResult,
  options: DiagnoseOptions,
): Diagnosis | null {
  if (result.status !== 'too-long' && result.status !== 'too-short') return null;

  const { font, sizePt, abbreviations, maxSuggestions = 2 } = options;
  const over = result.status === 'too-long';

  // Measure from the edge of what shaping can reach, not from the natural
  // width: the spaces have already been credited with everything they can give.
  const offByMm = over
    ? result.minWidthMm - result.targetMm
    : result.targetMm - result.maxWidthMm;

  const charWidth = meanCharWidthMm(result.text, font, sizePt);
  const characters = charWidth > 0 ? Math.max(1, Math.round(offByMm / charWidth)) : 0;

  const suggestions = over && abbreviations
    ? abbreviationSuggestions(result.text, abbreviations, font, sizePt).slice(
        0,
        maxSuggestions,
      )
    : [];

  const rounded = roundMm(offByMm, 1);
  const headline = over
    ? `Can't reach flush. Over by ~${rounded}mm.`
    : `Can't reach flush. Short by ~${rounded}mm.`;

  const remedies: string[] = [
    over
      ? `Cut roughly ${characters} character${characters === 1 ? '' : 's'}`
      : `Add roughly ${characters} character${characters === 1 ? '' : 's'}`,
  ];
  for (const s of suggestions) {
    remedies.push(
      `abbreviate "${s.phrase}" to "${s.abbr}" (saves ${roundMm(s.savesMm, 1)}mm)`,
    );
  }

  return {
    kind: over ? 'over' : 'under',
    offByMm,
    characters,
    suggestions,
    headline,
    message: `${headline} ${remedies.join(', or ')}.`,
  };
}
