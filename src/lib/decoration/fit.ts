import type { FontMetrics } from '../metrics/font';

/**
 * Fitting a citation to the certificate, the way myDecs does it.
 *
 * myDecs enforces one number, 1350 characters, and then prints the citation
 * into a box of fixed width and fixed height in a monospace face. The box
 * binds, not the counter: word wrap leaves the end of every line partly empty,
 * so 1350 characters take a different number of lines depending on where the
 * words fall, and a citation that fills the counter can still lose its last
 * line off the bottom of the box.
 *
 * So this module does no shaping at all. No half spaces, no measured
 * substitutions: the text is wrapped exactly as typed, at the column count the
 * box allows, and the tool refuses input that would run past the last line.
 * Bullet Bench's optimizer is the wrong tool here and is deliberately not
 * imported.
 *
 * Wrapping is greedy at spaces, with a word wider than the box broken at the
 * column boundary. That is what a plain text control does; whether myDecs's
 * renderer breaks after hyphens as well is unknown, and treating a hyphenated
 * word as unbreakable errs toward one more line rather than one fewer, which
 * is the safe direction for a tool whose job is to keep text on the page.
 */

export interface CitationLimits {
  /** Characters per line. */
  columns: number;
  /** Lines the box holds. */
  lines: number;
  /** The field's own character cap. */
  maxChars: number;
}

export interface FitResult {
  chars: number;
  lines: string[];
  lineCount: number;
  fits: boolean;
  /** Lines past the box, zero when it fits. */
  overLines: number;
  /** Characters past the cap, zero when it fits. */
  overChars: number;
}

/** Character cells across the box: floor(width / one advance), monospace assumed. */
export function columnsFor(font: FontMetrics, sizePt: number, widthMm: number): number {
  const cell = font.widthMm('0', sizePt, false);
  if (cell <= 0 || widthMm <= 0) return 0;
  // A hair of tolerance so 74.0000001 does not floor to 73.
  return Math.floor(widthMm / cell + 1e-6);
}

/** The citation is one paragraph; line breaks become spaces before anything else. */
export function normalizeCitation(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ');
}

export function wrapMonospace(text: string, columns: number): string[] {
  if (columns <= 0) return [text];
  const lines: string[] = [];
  let current = '';

  const flush = () => {
    lines.push(current.trimEnd());
    current = '';
  };

  for (const token of text.split(/(\s+)/)) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) {
      // Space that fits stays; space that would hang past the edge is where
      // the line breaks, and it is swallowed by the break.
      if (current === '') continue;
      if (current.length + token.length <= columns) current += token;
      else flush();
      continue;
    }
    if (current.length + token.length <= columns) {
      current += token;
      continue;
    }
    if (current.trimEnd() !== '') flush();
    let word = token;
    while (word.length > columns) {
      lines.push(word.slice(0, columns));
      word = word.slice(columns);
    }
    current = word;
  }
  if (current !== '' || lines.length === 0) flush();
  return lines;
}

export function fitCitation(text: string, limits: CitationLimits): FitResult {
  const lines = wrapMonospace(text, limits.columns);
  const chars = text.length;
  const overLines = Math.max(0, lines.length - limits.lines);
  const overChars = Math.max(0, chars - limits.maxChars);
  return {
    chars,
    lines,
    lineCount: lines.length,
    fits: overLines === 0 && overChars === 0,
    overLines,
    overChars,
  };
}

export type EditOutcome =
  /** The new text fits. */
  | 'accepted'
  /** A keystroke that would overflow; the old text stands. */
  | 'blocked'
  /** A paste that would overflow; as much of it as fits went in. */
  | 'trimmed';

export interface EditResult {
  text: string;
  outcome: EditOutcome;
  /** What did not make it in, so nothing is lost silently. */
  cut: string;
}

/**
 * Applies an edit to the part of the citation the user controls, holding the
 * whole citation inside the box.
 *
 * `assemble` maps the editable text to the full citation, which is what has to
 * fit: the opening and closing sentences are fixed by the manual, so the
 * narrative is what gives.
 *
 * Deletions always go through. A single inserted character that overflows is
 * refused, the way a maxlength attribute refuses it. A longer insertion (a
 * paste, a drop) is cut down to the longest prefix that fits, because throwing
 * away a whole pasted draft is worse than trimming its tail and saying so.
 */
export function applyEdit(
  previous: string,
  next: string,
  assemble: (inner: string) => string,
  limits: CitationLimits,
): EditResult {
  const fits = (inner: string) => fitCitation(assemble(inner), limits).fits;

  if (fits(next)) return { text: next, outcome: 'accepted', cut: '' };
  if (next.length <= previous.length) return { text: next, outcome: 'accepted', cut: '' };

  // Locate the inserted span: common prefix, then common suffix of what is left.
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < maxPrefix - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const head = next.slice(0, prefix);
  const tail = next.slice(next.length - suffix);
  const inserted = next.slice(prefix, next.length - suffix);

  if (inserted.length <= 1) return { text: previous, outcome: 'blocked', cut: inserted };

  // Fit is monotone in how much of the insertion goes in, so bisect.
  let lo = 0;
  let hi = inserted.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(head + inserted.slice(0, mid) + tail)) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return { text: previous, outcome: 'blocked', cut: inserted };
  return {
    text: head + inserted.slice(0, lo) + tail,
    outcome: 'trimmed',
    cut: inserted.slice(lo),
  };
}
