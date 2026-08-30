import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import {
  shapeLine,
  shapeDocument,
  DEFAULT_TOLERANCE_MM,
  effectiveTargetMm,
  type ShapeResult,
} from '@/lib/shape/optimizer';
import { fontUnitsToMm } from '@/lib/metrics/units';
import {
  SPACE_CHARS,
  SPACE_LEVELS,
  countSpaces,
  unshape,
  usesOnlyPermittedSpaces,
} from '@/lib/shape/spaces';

const SIZE_PT = 12;
const BULLET =
  'Led 12-person maintenance team; drove 340 sorties and zero mishaps across the quarter';

let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics('/fonts/LiberationSerif-Regular.ttf');
});

const natural = (line: string) => font.widthMm(unshape(line), SIZE_PT);
const shape = (line: string, targetMm: number, toleranceMm?: number) =>
  shapeLine(line, font, { targetMm, sizePt: SIZE_PT, toleranceMm });

/** The level (0/1/2) chosen for each gap, recovered from the output. */
function levelsOf(result: ShapeResult): number[] {
  const levels: number[] = [];
  for (const char of result.text) {
    const level = SPACE_LEVELS.indexOf(char as never);
    if (level >= 0) levels.push(level);
  }
  return levels;
}

describe('shapeLine', () => {
  it('pads a short line to within tolerance of the target', () => {
    const target = natural(BULLET) + 3;
    const result = shape(BULLET, target);
    expect(result.status).toBe('shaped');
    expect(result.widthMm).toBeLessThanOrEqual(target);
    expect(target - result.widthMm).toBeLessThanOrEqual(DEFAULT_TOLERANCE_MM);
  });

  // The reference measures against `widthPx + 0.55`, so a successful line may
  // sit a fraction past the nominal field width. That slack is deliberate and
  // shared with the wrapper, so it can never put a line onto a second row.
  it('never exceeds the effective target when it reports success', () => {
    for (let extra = 0; extra <= 20; extra += 0.25) {
      const target = natural(BULLET) + extra;
      const result = shape(BULLET, target);
      if (result.status === 'shaped' || result.status === 'at-target') {
        expect(result.widthMm).toBeLessThanOrEqual(effectiveTargetMm(target) + 1e-9);
      }
    }
  });

  it('leaves a line that already sits at the target unchanged', () => {
    const target = natural(BULLET);
    const result = shape(BULLET, target);
    expect(result.status).toBe('at-target');
    expect(result.text).toBe(unshape(BULLET));
    expect(countSpaces(result.text)[SPACE_CHARS.SIX_PER_EM]).toBe(0);
    expect(countSpaces(result.text)[SPACE_CHARS.THREE_PER_EM]).toBe(0);
  });

  it('flags a line too long to shape and returns the text untouched', () => {
    const target = natural(BULLET) - 20;
    const result = shape(BULLET, target);
    expect(result.status).toBe('too-long');
    // Not silently emitted: no narrow spaces slipped in to fake a fit.
    expect(result.text).toBe(unshape(BULLET));
    expect(result.deltaMm).toBeGreaterThan(0);
  });

  it('narrows spacing to rescue a line that is only slightly too long', () => {
    const target = natural(BULLET) - 1.5;
    const result = shape(BULLET, target);
    expect(result.status).toBe('shaped');
    expect(result.widthMm).toBeLessThanOrEqual(effectiveTargetMm(target));
    expect(countSpaces(result.text)[SPACE_CHARS.SIX_PER_EM]).toBeGreaterThan(0);
  });

  it('flags a line too short to reach the target even at widest spacing', () => {
    const target = natural(BULLET) + 200;
    const result = shape(BULLET, target);
    expect(result.status).toBe('too-short');
    expect(result.deltaMm).toBeLessThan(0);
    // Best effort is still the widest achievable spacing.
    expect(result.widthMm).toBeCloseTo(result.maxWidthMm, 9);
  });

  it('emits only permitted space characters', () => {
    for (let extra = -2; extra <= 30; extra += 0.5) {
      const result = shape(BULLET, natural(BULLET) + extra);
      expect(usesOnlyPermittedSpaces(result.text)).toBe(true);
      expect(unshape(result.text)).toBe(unshape(BULLET));
    }
  });




  // The first gap after the bullet dash is never substituted -- the reference
  // leaves it alone because a narrowed space right after the dash is the one
  // place the change is obvious. So the achievable range is one gap short of
  // the theoretical maximum, and is not symmetric about the natural width.
  it('leaves the first gap after the dash alone', () => {
    const dashed = `- ${BULLET}`;
    const result = shape(dashed, natural(dashed) - 3);
    expect(result.status).toBe('shaped');
    // A narrowed space right after the dash is the one place the substitution
    // is obvious, so that gap is never chosen.
    expect(result.text.startsWith(`-${SPACE_CHARS.NORMAL}Led`)).toBe(true);
  });

  it('is deterministic', () => {
    const target = natural(BULLET) + 7.3;
    const first = shape(BULLET, target);
    for (let i = 0; i < 50; i += 1) {
      const again = shape(BULLET, target);
      expect(again.text).toBe(first.text);
      expect(again.widthMm).toBe(first.widthMm);
      expect(again.status).toBe(first.status);
    }
  });

  it('keeps a leading bullet marker attached to the first word', () => {
    const line = `- ${BULLET}`;
    const result = shape(line, natural(line) + 8);
    expect(result.text.startsWith(`-${SPACE_CHARS.NORMAL}Led`)).toBe(true);
  });

  it('reports the achievable range and the natural width', () => {
    const result = shape(BULLET, natural(BULLET) + 5);
    expect(result.minWidthMm).toBeLessThan(result.naturalWidthMm);
    expect(result.naturalWidthMm).toBeLessThan(result.maxWidthMm);
    expect(result.naturalWidthMm).toBeCloseTo(natural(BULLET), 9);
    expect(result.gapCount).toBe(unshape(BULLET).split(' ').length - 1);
  });

  it('handles blank and single-word lines without crashing', () => {
    expect(shape('', 100).status).toBe('empty');
    expect(shape('   ', 100).status).toBe('empty');
    const single = shape('Squadron', 100);
    expect(single.gapCount).toBe(0);
    expect(single.status).toBe('too-short');
    expect(single.text).toBe('Squadron');
  });

  it('measures the returned text rather than trusting its own arithmetic', () => {
    const result = shape(BULLET, natural(BULLET) + 3);
    expect(font.widthMm(result.text, SIZE_PT)).toBeCloseTo(result.widthMm, 12);
  });
});

describe('shapeDocument', () => {
  it('shapes every line and preserves blank lines and order', () => {
    const doc = `${BULLET}\n\n- Second bullet here`;
    const results = shapeDocument(doc, font, { targetMm: 180, sizePt: SIZE_PT });
    expect(results).toHaveLength(3);
    expect(results[1]!.status).toBe('empty');
    expect(unshape(results[0]!.text)).toBe(unshape(BULLET));
  });
});

/**
 * Behaviours ported deliberately from AF-VCD/pdf-bullets. Each one is a place
 * where an "improvement" would make our output differ from theirs for the same
 * bullet, which is the thing to avoid.
 */
describe('parity with the reference implementation', () => {
  const OVER =
    '- SrA Saunders was the focal point for squadron training day. He facilitated two bridge chats, and headed training on critic';

  it('is deterministic: their gap choice is a hash, not a random draw', () => {
    const first = shape(OVER, 202.321);
    for (let i = 0; i < 25; i += 1) {
      expect(shape(OVER, 202.321).text).toBe(first.text);
    }
  });

  // Their loop merges a pair into one element, so a later pass can merge that
  // element with its neighbour. Substituted spaces therefore run together
  // rather than spreading out -- the opposite of even distribution.
  it('allows substituted spaces to cluster', () => {
    const result = shape(OVER, 202.321);
    expect(result.status).toBe('shaped');
    expect(countSpaces(result.text)[SPACE_CHARS.SIX_PER_EM]).toBeGreaterThan(0);
    expect(unshape(result.text)).toBe(unshape(OVER));
  });

  // Shrinking stops the moment overflow reaches zero; there is no attempt to
  // push the line back out to the right margin.
  it('stops as soon as the line fits rather than reaching for flush', () => {
    const result = shape(OVER, 202.321);
    const effective = effectiveTargetMm(202.321);
    expect(result.widthMm).toBeLessThanOrEqual(effective);
    // Undoing a single substitution would put it back over the line.
    const oneFewer = result.text.replace(SPACE_CHARS.SIX_PER_EM, SPACE_CHARS.NORMAL);
    expect(font.widthMm(oneFewer, SIZE_PT, false)).toBeGreaterThan(effective);
  });

  it('measures without kerning, as a form field lays text out', () => {
    const result = shape(OVER, 202.321);
    // Kerned measurement would report this line narrower than it renders,
    // which is how a bullet that "fits" here overflows in the form.
    expect(font.widthMm(result.text, SIZE_PT, false)).toBeGreaterThanOrEqual(
      font.widthMm(result.text, SIZE_PT, true),
    );
  });

  it('measures against the target plus their 0.55px slack', () => {
    expect(effectiveTargetMm(202.321) - 202.321).toBeCloseTo(0.55 / (96 / 25.4), 9);
  });

  it('emits only permitted space characters and preserves the words', () => {
    for (let extra = -8; extra <= 8; extra += 0.5) {
      const result = shape(OVER, natural(OVER) + extra);
      expect(usesOnlyPermittedSpaces(result.text)).toBe(true);
      expect(unshape(result.text)).toBe(unshape(OVER));
    }
  });
});
