import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import {
  shapeLine,
  shapeDocument,
  DEFAULT_TOLERANCE_MM,
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

  it('never exceeds the target when it reports success', () => {
    for (let extra = 0; extra <= 20; extra += 0.25) {
      const target = natural(BULLET) + extra;
      const result = shape(BULLET, target);
      if (result.status === 'shaped' || result.status === 'at-target') {
        expect(result.widthMm).toBeLessThanOrEqual(target + 1e-9);
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
    expect(result.widthMm).toBeLessThanOrEqual(target);
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

  it('distributes padding across gaps rather than concentrating it', () => {
    const target = natural(BULLET) + 2;
    const result = shape(BULLET, target);
    const levels = levelsOf(result);
    // The evenness invariant: no gap sits more than one level above another.
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
    // And the widened gaps are genuinely spread, not clustered at one break.
    const wide = levels.filter((l) => l === 2).length;
    const normal = levels.filter((l) => l === 1).length;
    expect(wide + normal).toBe(levels.length);
    expect(wide).toBeGreaterThan(0);
  });

  it('holds the evenness invariant across the whole feasible range', () => {
    for (let extra = 0; extra <= 25; extra += 0.25) {
      const levels = levelsOf(shape(BULLET, natural(BULLET) + extra));
      if (levels.length === 0) continue;
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
    }
  });


  // The three space characters sit 1/12 em apart, so each gap can move the line
  // by only ~0.35mm at 12pt. A 12-gap bullet therefore has about +/-4.2mm of
  // total travel. Shaping is a fine-tuning instrument; anything further out has
  // to be fixed by editing the text, which is what the diagnosis exists for.
  it('has symmetric, bounded headroom of about a third of a millimetre per gap', () => {
    const result = shape(BULLET, natural(BULLET));
    const padHeadroom = result.maxWidthMm - result.naturalWidthMm;
    const shrinkHeadroom = result.naturalWidthMm - result.minWidthMm;
    expect(padHeadroom).toBeCloseTo(shrinkHeadroom, 6);
    // 1/3 em - 1/4 em = 1/12 em = 171 units on Liberation's 2048-unit em.
    const stepMm = fontUnitsToMm(683 - 512, font.unitsPerEm, SIZE_PT);
    expect(stepMm).toBeCloseTo(0.3535, 4);
    expect(padHeadroom / result.gapCount).toBeCloseTo(stepMm, 9);
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
