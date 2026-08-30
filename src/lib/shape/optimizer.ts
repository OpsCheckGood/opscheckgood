import type { FontMetrics } from '../metrics/font';
import { fontUnitsToMm, mmToFontUnits } from '../metrics/units';
import { tokenizeLine, splitLines } from '../text/tokenize';
import { NORMAL_LEVEL, SPACE_LEVELS, type SpaceChar } from './spaces';

/**
 * Deterministic width shaping.
 *
 * Each inter-word gap independently takes one of three space characters, so a
 * bullet with N gaps has 3^N renderings. We want the widest one that does not
 * exceed the target, with the padding spread evenly rather than dumped at a
 * single break.
 *
 * The reference implementation (AF-VCD/pdf-bullets) picks gap positions at
 * random until the overflow resolves, so the same bullet can shape two
 * different ways on two runs. This does not: gaps start at the narrowest level
 * and are promoted a whole level at a time, and when a level can only be
 * partially afforded the promoted positions are chosen by even spacing. Same
 * input, same output, always.
 *
 * ## Exactness
 *
 * Width is not `sum(word widths) + sum(space widths)`, because kerning applies
 * across the word/space boundary too. Each gap's cost is measured as
 * `kern(lastCharOfLeftWord, space) + advance(space) + kern(space, firstCharOfRightWord)`,
 * which makes the arithmetic used during the search exactly equal to measuring
 * the assembled string. The final width is re-measured from the output anyway.
 */

export type ShapeStatus =
  /** Blank line. */
  | 'empty'
  /** Ordinary spacing already lands within tolerance; text left untouched. */
  | 'at-target'
  /** Space characters were substituted to reach the target. */
  | 'shaped'
  /** Too wide even at the narrowest spacing. The text itself must shrink. */
  | 'too-long'
  /** Too narrow even at the widest spacing. The text itself must grow. */
  | 'too-short';

export interface ShapeOptions {
  targetMm: number;
  sizePt: number;
  /** How close to the target counts as flush. Default 0.5mm. */
  toleranceMm?: number;
}

export interface ShapeResult {
  status: ShapeStatus;
  /** The shaped text. For 'too-long' this is the user's own text, unmodified. */
  text: string;
  widthMm: number;
  targetMm: number;
  /** Positive means over the target, negative means short of it. */
  deltaMm: number;
  /** widthMm / targetMm. Drives the fill bars. */
  fillRatio: number;
  charCount: number;
  gapCount: number;
  /** Width with ordinary spaces throughout -- what the user typed. */
  naturalWidthMm: number;
  /** Width at the narrowest and widest spacings, i.e. the achievable range. */
  minWidthMm: number;
  maxWidthMm: number;
}

export const DEFAULT_TOLERANCE_MM = 0.5;

/**
 * Picks `count` positions from `pool` spread as evenly across it as possible.
 *
 * Bresenham-style sampling at the midpoint of each of `count` equal segments.
 * Strictly increasing (and so duplicate-free) whenever count <= pool.length.
 */
function evenlySpaced<T>(pool: readonly T[], count: number): T[] {
  const picked: T[] = [];
  for (let j = 0; j < count; j += 1) {
    picked.push(pool[Math.floor(((j + 0.5) * pool.length) / count)]!);
  }
  return picked;
}

export function shapeLine(
  line: string,
  font: FontMetrics,
  options: ShapeOptions,
): ShapeResult {
  const { targetMm, sizePt } = options;
  const toleranceMm = options.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  const { unitsPerEm } = font;
  const toUnits = (mm: number) => mmToFontUnits(mm, unitsPerEm, sizePt);
  const toMm = (units: number) => fontUnitsToMm(units, unitsPerEm, sizePt);

  const { words, lockedGaps } = tokenizeLine(line);

  const blank = (): ShapeResult => ({
    status: 'empty',
    text: '',
    widthMm: 0,
    targetMm,
    deltaMm: -targetMm,
    fillRatio: 0,
    charCount: 0,
    gapCount: 0,
    naturalWidthMm: 0,
    minWidthMm: 0,
    maxWidthMm: 0,
  });

  if (words.length === 0) return blank();

  const targetUnits = toUnits(targetMm);
  const toleranceUnits = toUnits(toleranceMm);

  // Words carry their own internal kerning; only the gaps are variable.
  const wordUnits = words.map((w) => font.advanceUnits(w));
  const wordsTotal = wordUnits.reduce((a, b) => a + b, 0);
  const gapCount = words.length - 1;

  /** gapUnits[gap][level] -- includes kerning into and out of the space. */
  const gapUnits: number[][] = [];
  for (let i = 0; i < gapCount; i += 1) {
    const left = words[i]!.at(-1)!;
    const right = words[i + 1]![0]!;
    gapUnits.push(
      SPACE_LEVELS.map(
        (space) =>
          font.kernUnits(left, space) +
          font.advanceUnits(space) +
          font.kernUnits(space, right),
      ),
    );
  }

  const levelFloor = (gap: number) => (lockedGaps.has(gap) ? NORMAL_LEVEL : 0);
  const levelCeiling = (gap: number) =>
    lockedGaps.has(gap) ? NORMAL_LEVEL : SPACE_LEVELS.length - 1;

  const widthAt = (levels: readonly number[]) =>
    wordsTotal + levels.reduce((sum, level, i) => sum + gapUnits[i]![level]!, 0);

  const minLevels = Array.from({ length: gapCount }, (_, i) => levelFloor(i));
  const maxLevels = Array.from({ length: gapCount }, (_, i) => levelCeiling(i));
  const naturalLevels = Array.from({ length: gapCount }, () => NORMAL_LEVEL);

  const minUnits = widthAt(minLevels);
  const maxUnits = widthAt(maxLevels);
  const naturalUnits = widthAt(naturalLevels);

  const finish = (
    status: ShapeStatus,
    levels: readonly number[],
  ): ShapeResult => {
    const text = words.reduce(
      (acc, word, i) =>
        i === 0 ? word : acc + (SPACE_LEVELS[levels[i - 1]!] as SpaceChar) + word,
      '',
    );
    // Re-measure the assembled string rather than trusting the arithmetic.
    const widthMm = font.widthMm(text, sizePt);
    return {
      status,
      text,
      widthMm,
      targetMm,
      deltaMm: widthMm - targetMm,
      fillRatio: targetMm > 0 ? widthMm / targetMm : 0,
      charCount: [...text].length,
      gapCount,
      naturalWidthMm: toMm(naturalUnits),
      minWidthMm: toMm(minUnits),
      maxWidthMm: toMm(maxUnits),
    };
  };

  // Over the target even at the narrowest spacing. Nothing we do to whitespace
  // fixes this, so hand back the user's own text rather than emitting narrow
  // spaces that still overflow.
  if (minUnits > targetUnits) return finish('too-long', naturalLevels);

  // Promote levels evenly: raise every gap sitting at the current minimum level
  // together when the whole step is affordable, otherwise promote an evenly
  // spaced subset and stop.
  const levels = [...minLevels];
  let total = minUnits;

  for (;;) {
    const promotable: number[] = [];
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < gapCount; i += 1) {
      if (levels[i]! < levelCeiling(i)) lowest = Math.min(lowest, levels[i]!);
    }
    if (!Number.isFinite(lowest)) break;
    for (let i = 0; i < gapCount; i += 1) {
      if (levels[i] === lowest && levels[i]! < levelCeiling(i)) promotable.push(i);
    }
    if (promotable.length === 0) break;

    const costOf = (gap: number) =>
      gapUnits[gap]![levels[gap]! + 1]! - gapUnits[gap]![levels[gap]!]!;
    const fullStep = promotable.reduce((sum, gap) => sum + costOf(gap), 0);

    if (total + fullStep <= targetUnits) {
      for (const gap of promotable) levels[gap] += 1;
      total += fullStep;
      continue;
    }

    // Only part of the step fits. Take the largest evenly spaced subset that
    // does, then stop -- anything further would concentrate padding unevenly.
    for (let k = promotable.length - 1; k >= 1; k -= 1) {
      const chosen = evenlySpaced(promotable, k);
      const cost = chosen.reduce((sum, gap) => sum + costOf(gap), 0);
      if (total + cost <= targetUnits) {
        for (const gap of chosen) levels[gap] += 1;
        total += cost;
        break;
      }
    }
    break;
  }

  const shortfall = targetUnits - total;
  if (shortfall > toleranceUnits) return finish('too-short', levels);
  if (levels.every((level) => level === NORMAL_LEVEL)) return finish('at-target', levels);
  return finish('shaped', levels);
}

/** Shapes every line of a document, preserving blank lines and line order. */
export function shapeDocument(
  text: string,
  font: FontMetrics,
  options: ShapeOptions,
): ShapeResult[] {
  return splitLines(text).map((line) => shapeLine(line, font, options));
}
