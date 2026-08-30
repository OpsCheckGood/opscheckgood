import { COPPERPLATE_WIDTHS } from './assets/letterheadFont';
import type { FontKey, MemoDoc } from './types';

/**
 * Font metrics for the memorandum renderers.
 *
 * Widths are Adobe's own AFM advance widths per 1000 units for printable ASCII
 * 32..126. The PDF places text word by word at absolute coordinates, so an
 * approximate width table does not produce slightly-off spacing -- it produces
 * words that bunch up or gap, which is the one thing a memorandum generator
 * cannot do.
 *
 * Only the base-14 PDF fonts are used, so nothing here has to be embedded and
 * nothing has to be redistributed. Times New Roman, Arial and Courier New on
 * the reader's machine are metrically identical to Times, Helvetica and Courier
 * respectively, which is why the PDF and the on-screen preview agree.
 */

/** Times-Roman. */
const TIMES_ROMAN: readonly number[] = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611,
  556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722,
  722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500,
  278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
];

/** Times-Bold. */
const TIMES_BOLD: readonly number[] = [
  250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722,
  667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722,
  1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556,
  278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394,
  220, 394, 520,
];

/** Times-Italic. */
const TIMES_ITALIC: readonly number[] = [
  250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611,
  611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611,
  556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444,
  278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541,
];

/**
 * Helvetica. Verified glyph for glyph against arial.ttf, so an Arial body
 * renders at exactly these widths. Helvetica-Oblique shares them.
 */
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722,
  667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334,
  584,
];

/** Helvetica-Bold. */
const HELVETICA_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export interface MemoFont {
  readonly key: FontKey;
  readonly label: string;
  /** CSS stack for the preview and print view. */
  readonly css: string;
  /** Font family the Word export names. */
  readonly word: string;
  /** Base-14 PDF font names: regular, bold, italic. */
  readonly pdf: readonly [string, string, string];
  /**
   * The font's own (ascent + descent + lineGap) / unitsPerEm, and
   * (lineGap + ascent) / unitsPerEm -- the same two numbers Word uses to set
   * single spacing and to place the first baseline. Sharing them is what makes
   * the PDF and the Word export agree line for line.
   */
  readonly lineFactor: number;
  readonly baseFactor: number;
}

export const FONTS: readonly MemoFont[] = [
  {
    key: 'times',
    label: 'Times New Roman',
    css: "'Times New Roman', 'Liberation Serif', Georgia, serif",
    word: 'Times New Roman',
    pdf: ['Times-Roman', 'Times-Bold', 'Times-Italic'],
    lineFactor: 1.1499,
    baseFactor: 0.93359,
  },
  {
    key: 'arial',
    label: 'Arial',
    css: "Arial, 'Liberation Sans', Helvetica, sans-serif",
    word: 'Arial',
    pdf: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'],
    lineFactor: 1.1499,
    baseFactor: 0.93799,
  },
  {
    key: 'courier',
    label: 'Courier New',
    css: "'Courier New', 'Liberation Mono', Courier, monospace",
    word: 'Courier New',
    pdf: ['Courier', 'Courier-Bold', 'Courier-Oblique'],
    lineFactor: 1.13281,
    baseFactor: 0.83252,
  },
];

/** Point sizes the memorandum may be set in. 12 pt is the standard. */
export const FONT_SIZES: readonly number[] = [10, 10.5, 11, 11.5, 12];

export function fontOf(doc: { font: FontKey }): MemoFont {
  return FONTS.find((f) => f.key === doc.font) || FONTS[0]!;
}

/** Clamped, because a stored draft can carry anything. */
export function fontSize(doc: { fontSize: number }): number {
  const n = Number(doc.fontSize);
  return n >= 10 && n <= 12 ? n : 12;
}

export function lineFactor(doc: { font: FontKey }): number {
  return fontOf(doc).lineFactor;
}

/** One single-spaced line, in points. */
export function lineHeight(doc: MemoDoc): number {
  return fontSize(doc) * fontOf(doc).lineFactor;
}

/** Top of a line box to its first baseline, in points. */
export function baseline(doc: MemoDoc): number {
  return fontSize(doc) * fontOf(doc).baseFactor;
}

/**
 * Style codes used by the PDF writer, kept here because the width tables are:
 * 1 regular, 2 bold, 4 italic of the body font; 5 is the letterhead face,
 * which is always Copperplate Gothic Bold whatever the body is set in.
 */
export type StyleCode = 1 | 2 | 4 | 5;

function widthsFor(doc: { font: FontKey }, style: StyleCode): readonly number[] {
  if (style === 5) return COPPERPLATE_WIDTHS;
  if (fontOf(doc).key === 'arial') return style === 2 ? HELVETICA_BOLD : HELVETICA;
  return style === 2 ? TIMES_BOLD : style === 4 ? TIMES_ITALIC : TIMES_ROMAN;
}

/**
 * Width of a string in points.
 *
 * A character outside printable ASCII is charged as an 'n'. Nothing outside
 * that range survives into the PDF anyway -- the writer transliterates curly
 * quotes and dashes and drops the rest -- so this keeps measurement and output
 * consistent rather than measuring a glyph that will not be drawn.
 */
export function textWidth(doc: { font: FontKey }, s: string, style: StyleCode, size: number): number {
  const str = String(s);
  if (style !== 5 && fontOf(doc).key === 'courier') return str.length * size * 0.6;
  const table = widthsFor(doc, style);
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    w += c === 0xb7 ? 250 : c < 32 || c > 126 ? table[78]! : table[c - 32]!;
  }
  return (w * size) / 1000;
}
