import type { FontMetrics } from '../metrics/font';
import { SPACE_CHARS, SPACE_LEVELS, unshape } from './spaces';
import { splitLines } from '../text/tokenize';

/**
 * Width shaping.
 *
 * A port of pdf-bullets' optimizer (github.com/AF-VCD/pdf-bullets, MIT), and
 * checked against it: tests/pdf-bullets-differential.test.ts runs upstream's
 * script verbatim beside this one over several hundred bullets and compares
 * the output text and the verdict. Upstream is the tool people already use, so
 * where the two disagree it is right by definition. Change the behaviour here
 * only with that test in front of you.
 *
 * Each inter-word gap can hold one of three space characters. This does NOT
 * search all 3^N of them: it substitutes one gap per pass, joining the pair it
 * picks into a single token, and stops as soon as the line lands. That is
 * upstream's algorithm and the reason narrowed gaps cluster rather than spread.
 *
 * Four decisions here look arbitrary and are not:
 *
 * 1. **The gap is chosen by hashing the remaining words**, not by a counter and
 *    not at random. Random would shape the same bullet two ways on two visits.
 *    A counter would always chew the same end of the line. Hashing spreads the
 *    choice while staying a pure function of the text.
 *
 * 2. **A substitution consumes the pair it joins.** Once two words are joined
 *    by a narrow space they behave as a single word, so a later pass can attach
 *    a third. Narrowed gaps therefore run together rather than spreading, which
 *    reads as one deliberately tightened phrase instead of a whole line of
 *    subtly wrong spacing. Spreading padding evenly across every gap would be a
 *    different tool that produced different text for the same bullet.
 *
 * 3. **Shrinking stops the moment the line fits.** Every further substitution
 *    would buy another visibly narrow gap for nothing.
 *
 * 4. **The first gap after a leading dash is never touched.** It sits beside a
 *    fixed mark, which is the one place a narrowed space is obvious.
 *
 * ## Measurement
 *
 * Widths are taken WITHOUT kerning. A PDF form field lays plain text out from
 * glyph advances alone; there is no shaping engine applying GPOS pairs inside a
 * text field. Measuring kerned reports a line around half a millimetre narrower
 * than it actually renders, which is enough to call a bullet flush that then
 * overflows on the form. So the measurement matches the destination rather than
 * matching good typography.
 *
 * The font is parsed from the bundled file rather than measured through a
 * canvas, so a font missing from the user's machine cannot silently change the
 * numbers.
 */

/**
 * Sub-pixel allowance on the target: 0.55px at 96dpi.
 *
 * A line computed to sit exactly on the field boundary should count as fitting.
 * Without a small allowance, floating-point comparison rejects it and the
 * optimizer spends a substitution buying width it already had.
 */
const TARGET_SLACK_MM = 0.55 / (96 / 25.4);

/**
 * The width the engine actually measures against.
 *
 * Anything that draws or wraps shaped text must use this, not the nominal
 * field width, or the display contradicts the verdict: a line the optimizer
 * just accepted would visibly fall onto a second row because it sits inside
 * the slack.
 */
export function effectiveTargetMm(targetMm: number): number {
  return targetMm + TARGET_SLACK_MM;
}

/** Shaping measures without kerning; see the note above. */
export const SHAPING_KERNING = false;

/**
 * How far short of the field a line may sit before widening is worth doing.
 * Four pixels at 96dpi: below that the gain is invisible and the wide spaces
 * are not.
 */
const MAX_UNDERFLOW_MM = -4 / (96 / 25.4);

export type ShapeStatus =
  | 'empty'
  /** Ordinary spacing already fits; text untouched. */
  | 'at-target'
  /** Space characters were substituted to make it fit. */
  | 'shaped'
  /** Too wide even with every gap narrowed. */
  | 'too-long'
  /** Too narrow even with every gap widened. */
  | 'too-short';

export interface ShapeOptions {
  targetMm: number;
  sizePt: number;
  /** Retained for callers; the underflow bound above is what actually binds. */
  toleranceMm?: number;
}

export interface ShapeResult {
  status: ShapeStatus;
  text: string;
  widthMm: number;
  targetMm: number;
  /** Positive means over the target, negative means short of it. */
  deltaMm: number;
  fillRatio: number;
  charCount: number;
  gapCount: number;
  naturalWidthMm: number;
  minWidthMm: number;
  maxWidthMm: number;
}

export const DEFAULT_TOLERANCE_MM = -MAX_UNDERFLOW_MM;

/** A 32-bit rolling string hash. */
function hashCode(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Picks a gap from a hash of the text. Deterministic despite reading like a
 * random draw: the same bullet always produces the same sequence of choices.
 * The sign behaviour of `%` on a negative hash is load-bearing -- changing it
 * changes which gaps get narrowed.
 */
function hashedIndex(seed: string, max: number): number {
  return Math.floor(
    Math.abs((Math.floor(9 * hashCode(seed) + 5) % 100000) / 100000) *
      Math.floor(max),
  );
}

function tokenize(sentence: string): string[] {
  return sentence.split(/\s+/).filter((w) => w.length > 0);
}

export function shapeLine(
  line: string,
  font: FontMetrics,
  options: ShapeOptions,
): ShapeResult {
  const { sizePt } = options;
  // The sub-pixel allowance is small, but it is the difference between a line
  // being declared over and being declared flush.
  const target = effectiveTargetMm(options.targetMm);

  /** Unkerned, matching how the form field lays text out. */
  const width = (text: string) => font.widthMm(text, sizePt, false);

  const plain = unshape(line);
  const words = tokenize(plain);

  const build = (status: ShapeStatus, text: string): ShapeResult => {
    const widthMm = width(text);
    const normalWords = words.length > 0 ? words : [''];
    return {
      status,
      text,
      widthMm,
      targetMm: options.targetMm,
      deltaMm: widthMm - target,
      fillRatio: options.targetMm > 0 ? widthMm / options.targetMm : 0,
      charCount: [...text].length,
      gapCount: Math.max(0, normalWords.length - 1),
      naturalWidthMm: width(plain),
      minWidthMm: width(joinAll(words, SPACE_CHARS.SIX_PER_EM)),
      maxWidthMm: width(joinAll(words, SPACE_CHARS.THREE_PER_EM)),
    };
  };

  if (words.length === 0) {
    return {
      status: 'empty',
      text: '',
      widthMm: 0,
      targetMm: options.targetMm,
      deltaMm: -target,
      fillRatio: 0,
      charCount: 0,
      gapCount: 0,
      naturalWidthMm: 0,
      minWidthMm: 0,
      maxWidthMm: 0,
    };
  }

  const initialOverflow = width(plain) - target;
  if (initialOverflow === 0) return build('at-target', plain);

  const shrinking = initialOverflow > 0;
  const newSpace = shrinking ? SPACE_CHARS.SIX_PER_EM : SPACE_CHARS.THREE_PER_EM;

  // Worst case still leaves the first space after the dash alone.
  const worstCase = joinAll(words, newSpace);
  const worstOverflow = width(worstCase) - target;

  // Even fully narrowed it still runs over, or even fully widened it still
  // falls short. Either way, report the closest the spacing can get rather
  // than the text as typed -- that is what says how much has to be cut.
  if (shrinking && worstOverflow > 0) return build('too-long', worstCase);
  if (!shrinking && worstOverflow < MAX_UNDERFLOW_MM) {
    return build('too-short', worstCase);
  }

  let optWords = [...words];
  let previous = plain;

  // One gap per pass, best gap first, until the line lands. The loop below is
  // pdf-bullets' control flow, in its order: substitute, measure, then decide.
  // Deciding before substituting -- which is what this used to do when only
  // two words were left -- accepts a line that has not been measured since it
  // last changed, and reports a bullet as shaped that is still over the field.
  for (;;) {
    const index = hashedIndex(optWords.join(''), optWords.length - 2) + 1;
    optWords.splice(
      index,
      2,
      optWords.slice(index, index + 2).join(newSpace),
    );

    const candidate = optWords.join(' ');
    const overflow = width(candidate) - target;

    if (!shrinking && overflow > 0) {
      // Widening any further would push it over; keep the last good one.
      return settle(previous);
    }
    if (shrinking && overflow <= 0) return settle(candidate);

    if (optWords.length <= 2) {
      // Nothing left to join. Widening is allowed to stop short so long as it
      // is within the underflow bound; narrowing that has not landed by now
      // never will.
      if (!shrinking && overflow > MAX_UNDERFLOW_MM) return settle(candidate);
      return build(shrinking ? 'too-long' : 'too-short', candidate);
    }

    previous = candidate;
  }

  /**
   * A result that upstream would call optimised.
   *
   * It has one status for both, and we have two: a line that came out exactly
   * as typed was never shaped, and saying so is the difference between "this
   * already fits" and "I moved your spaces".
   */
  function settle(text: string): ShapeResult {
    return build(text === plain ? 'at-target' : 'shaped', text);
  }
}

/** First gap stays a normal space; see the note on the leading dash above. */
function joinAll(words: readonly string[], space: string): string {
  if (words.length <= 1) return words.join('');
  return words[0] + SPACE_CHARS.NORMAL + words.slice(1).join(space);
}

/** Shapes every line of a document, preserving blank lines and order. */
export function shapeDocument(
  text: string,
  font: FontMetrics,
  options: ShapeOptions,
): ShapeResult[] {
  return splitLines(text).map((line) => shapeLine(line, font, options));
}

export { SPACE_LEVELS };
