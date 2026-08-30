import type { FontMetrics } from '../metrics/font';
import { SPACE_CHARS, SPACE_LEVELS, unshape } from './spaces';
import { splitLines } from '../text/tokenize';

/**
 * Width shaping, ported to match AF-VCD/pdf-bullets exactly.
 *
 * This is a behavioural port, written fresh from a reading of their
 * `optimize()` and `renderBulletText()`. Matching them precisely matters more
 * than any improvement, because a bullet shaped here has to be
 * indistinguishable from one shaped there when it lands in the same form.
 *
 * Three things about their implementation are load-bearing and easy to get
 * wrong -- I got all three wrong before reading the source:
 *
 * 1. **The gap is chosen by a hash, not at random.** `getRandomInt` looks
 *    random but seeds off `optWords.join("")`, so it is a pure function of the
 *    text. Their output is deterministic, and the choice of gap moves as words
 *    merge, which is why the substituted spaces cluster rather than spread.
 *
 * 2. **Merging consumes two words into one.** `splice(i, 2, a + space + b)`
 *    replaces a pair with a single element, so the next pass can merge that
 *    element with its neighbour and produce a run of three words joined by
 *    narrow spaces. Every gap not merged stays an ordinary space.
 *
 * 3. **It stops the moment the line fits.** There is no attempt to reach the
 *    right margin when shrinking; `overflow <= 0` ends the loop.
 *
 * ## Measurement
 *
 * Widths here are taken WITHOUT kerning. The reference measures with canvas
 * `measureText`, and more importantly a PDF form field lays plain text out
 * from glyph advances alone. Kerning this sample line makes it 0.51mm narrower
 * -- about one and a half substitutions -- which is enough to flip a borderline
 * bullet. Measuring kerned would mean declaring lines to fit that do not fit in
 * the form, which is the one failure this tool must not have.
 *
 * We still parse the real bundled font rather than using canvas, so the numbers
 * cannot change because of a missing local font.
 */

/** Their target is `widthPx + 0.55`, at 96dpi. In millimetres that is: */
const TARGET_SLACK_MM = 0.55 / (96 / 25.4);

/**
 * The width the engine actually measures against.
 *
 * Anything that draws or wraps shaped text must use this, not the nominal
 * field width, or the display contradicts the verdict: a line the optimizer
 * just accepted would visibly fall onto a second row because it sits inside
 * the slack. The reference feeds the same adjusted width to its renderer for
 * exactly this reason.
 */
export function effectiveTargetMm(targetMm: number): number {
  return targetMm + TARGET_SLACK_MM;
}

/** Shaping measures without kerning; see the note above. */
export const SHAPING_KERNING = false;

/** Their `STATUS.MAX_UNDERFLOW`, -4 pixels, expressed in millimetres. */
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
  /** Retained for callers; the reference's own -4px bound is what binds. */
  toleranceMm?: number;
}

export interface ShapeResult {
  status: ShapeStatus;
  text: string;
  widthMm: number;
  targetMm: number;
  /** Positive means over the target. Their `overflow`. */
  deltaMm: number;
  fillRatio: number;
  charCount: number;
  gapCount: number;
  naturalWidthMm: number;
  minWidthMm: number;
  maxWidthMm: number;
}

export const DEFAULT_TOLERANCE_MM = -MAX_UNDERFLOW_MM;

/** Their `hashCode`: a 32-bit rolling string hash. */
function hashCode(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Their `getRandomInt`: deterministic despite the name. Reproduced exactly,
 * including the sign behaviour of `%` on a negative hash, because the gap it
 * picks is the difference between matching their output and merely resembling
 * it.
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
  // Their `widthPxAdjusted`. Small, but it is the difference between a line
  // being declared over and being declared flush.
  const target = effectiveTargetMm(options.targetMm);

  /** Unkerned, matching the reference and the form field. */
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

  // Their worst case leaves the first space after the dash alone.
  const worstCase = joinAll(words, newSpace);
  const worstOverflow = width(worstCase) - target;

  if (shrinking && worstOverflow > 0) return build('too-long', plain);
  if (!shrinking && worstOverflow < MAX_UNDERFLOW_MM) {
    return build('too-short', worstCase);
  }

  // A line already inside the underflow bound needs no widening.
  if (!shrinking && initialOverflow >= MAX_UNDERFLOW_MM) {
    return build('at-target', plain);
  }

  let optWords = [...words];
  let previous = plain;

  for (;;) {
    if (optWords.length <= 2) return build('shaped', optWords.join(' '));

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
      return build('shaped', previous);
    }
    if (shrinking && overflow <= 0) return build('shaped', candidate);

    if (optWords.length <= 2) {
      const status: ShapeStatus =
        !shrinking && overflow > MAX_UNDERFLOW_MM ? 'shaped' : 'too-long';
      return build(status, candidate);
    }

    previous = candidate;
  }
}

/** First gap stays a normal space, as in the reference. */
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
