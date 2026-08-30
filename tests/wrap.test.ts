import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { wrapToWidth } from '@/lib/text/wrap';
import { shapeLine } from '@/lib/shape/optimizer';
import { getForm } from '@/lib/data/forms';
import { mergeAbbreviations, applyAbbreviations } from '@/lib/data/abbreviations';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import { SPACE_CHARS, countSpaces } from '@/lib/shape/spaces';

const SIZE_PT = 12;
const TARGET = 202.321;

let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics('/fonts/LiberationSerif-Regular.ttf');
});

describe('wrapToWidth', () => {
  it('leaves a line that fits on one row', () => {
    expect(wrapToWidth('- Led a small team', font, SIZE_PT, TARGET)).toEqual([
      '- Led a small team',
    ]);
  });

  it('breaks a long line into rows that each fit', () => {
    const long =
      '- Rewrote 22-page continuity binder; cut new-tech spin-up from 6 weeks to 9 days and became the wing standard reference for all five squadrons';
    const rows = wrapToWidth(long, font, SIZE_PT, TARGET);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(font.widthMm(row, SIZE_PT)).toBeLessThanOrEqual(TARGET);
    }
    expect(rows.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
  });

  /**
   * The invariant the whole two-pane display rests on. If the optimizer says a
   * line is flush, the pane must draw it as exactly one line -- otherwise the
   * tool contradicts itself on screen.
   */
  it('renders every successfully shaped line as exactly one row', () => {
    const bullets = [
      '- Led 12-person maintenance team; drove 340 sorties w/ zero mishaps--unit earned MAJCOM Flight Safety Award FY26',
      '- Rebuilt tool accountability program; cut audit findings 60% and briefed the results to over 400 Airmen at wing call',
      '- Overhauled squadron training plan; qualified 47 Airmen in 90 days--doubled mission-ready rate to 96% for the shop',
    ];
    for (const bullet of bullets) {
      const result = shapeLine(bullet, font, { targetMm: TARGET, sizePt: SIZE_PT });
      expect(result.status).toBe('shaped');
      expect(wrapToWidth(result.text, font, SIZE_PT, TARGET)).toHaveLength(1);
    }
  });

  it('holds that invariant across a sweep of target widths', () => {
    const bullet =
      '- Rebuilt tool accountability program; cut audit findings 60% and briefed the results to over 400 Airmen at wing call';
    for (let target = 180; target <= 230; target += 0.5) {
      const result = shapeLine(bullet, font, { targetMm: target, sizePt: SIZE_PT });
      if (result.status === 'shaped' || result.status === 'at-target') {
        expect(wrapToWidth(result.text, font, SIZE_PT, target)).toHaveLength(1);
      }
    }
  });

  it('never breaks on a substituted shaping space', () => {
    const bullet =
      '- Rebuilt tool accountability program; cut audit findings 60% and briefed the results to over 400 Airmen at wing call and staff meeting afterwards';
    const result = shapeLine(bullet, font, { targetMm: TARGET, sizePt: SIZE_PT });
    for (const row of wrapToWidth(result.text, font, SIZE_PT, TARGET)) {
      for (const space of [SPACE_CHARS.THREE_PER_EM, SPACE_CHARS.SIX_PER_EM]) {
        expect(row.startsWith(space)).toBe(false);
        expect(row.endsWith(space)).toBe(false);
      }
    }
  });

  it('handles empty input and a zero width without looping', () => {
    expect(wrapToWidth('', font, SIZE_PT, TARGET)).toEqual(['']);
    expect(wrapToWidth('abc', font, SIZE_PT, 0)).toEqual(['abc']);
  });

  it('uses the width the form actually declares', () => {
    const form = getForm('af1206')!;
    expect(form.data.fields[0]!.widthMm).toBeCloseTo(TARGET, 3);
    expect(form.data.font.sizePt).toBe(SIZE_PT);
  });
});

/**
 * The default text is the tool's own instructions, and it doubles as the
 * demo: every line must actually shape to flush. If someone edits the wording
 * without re-measuring, a first-time visitor sees red lines and concludes the
 * tool is broken -- which is exactly what happened once already.
 */
describe('default instruction text', () => {
  it('shapes every line to flush at the 1206 width', async () => {
    const source = readFileSync('src/components/BulletBench.tsx', 'utf8');
    const block = source.slice(source.indexOf('const SAMPLE = ['), source.indexOf("].join('\\n');"));
    const lines = [...block.matchAll(/^\s*'(- [^']+)',$/gm)].map((m) => m[1]!);

    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      const result = shapeLine(line, font, { targetMm: TARGET, sizePt: SIZE_PT });
      // 'at-target' is a pass too: a line already inside the underflow bound
      // needs no substitution at all.
      expect(
        ['shaped', 'at-target'],
        `"${line.slice(0, 50)}..." is ${result.status}`,
      ).toContain(result.status);
      expect(wrapToWidth(result.text, font, SIZE_PT, TARGET)).toHaveLength(1);
    }
  });
});

/**
 * Replacing a word with a shorter one can flip the optimizer from narrowing
 * (U+2006) to widening (U+2004), so the shaped string gains wide spaces even
 * though the statement got shorter. Both still occupy one line on the form.
 *
 * This is the case that made the output pane appear to break: it wrapped by
 * browser width in a monospace face, where wide spaces are visibly wider, and
 * showed two lines for a line that fits. Any surface displaying shaped text
 * must wrap with these metrics, never the browser's.
 */
describe('shortening a word never costs a line', () => {
  const LONG =
    '- SrA Saunders was the focal point for squadron training day. He facilitated two bridge chats, and headed training on critic';

  it('keeps one line when a long word is swapped for a short one', () => {
    const shorter = LONG.replace('facilitated', 'ran');
    for (const line of [LONG, shorter]) {
      const result = shapeLine(line, font, { targetMm: TARGET, sizePt: SIZE_PT });
      expect(result.status).toBe('shaped');
      expect(
        wrapToWidth(result.text, font, SIZE_PT, TARGET),
        `"${line.slice(0, 40)}..." wrapped`,
      ).toHaveLength(1);
    }
  });

  it('does flip narrowing to widening, which is what caught the display out', () => {
    const narrowed = shapeLine(LONG, font, { targetMm: TARGET, sizePt: SIZE_PT });
    const widened = shapeLine(LONG.replace('facilitated', 'ran'), font, {
      targetMm: TARGET,
      sizePt: SIZE_PT,
    });
    expect(countSpaces(narrowed.text)[SPACE_CHARS.SIX_PER_EM]).toBeGreaterThan(0);
    expect(countSpaces(widened.text)[SPACE_CHARS.THREE_PER_EM]).toBeGreaterThan(0);
  });

  it('holds for every single-word shortening of the line', () => {
    const words = LONG.split(' ');
    for (let i = 1; i < words.length; i += 1) {
      if (words[i]!.length < 4) continue;
      const copy = [...words];
      copy[i] = words[i]!.slice(0, 2);
      const result = shapeLine(copy.join(' '), font, { targetMm: TARGET, sizePt: SIZE_PT });
      if (result.status === 'shaped' || result.status === 'at-target') {
        expect(
          wrapToWidth(result.text, font, SIZE_PT, TARGET),
          `shortening "${words[i]}"`,
        ).toHaveLength(1);
      }
    }
  });
});

/**
 * The output is built by replacing approved abbreviations first, then shaping
 * what is left. The order matters: abbreviating frees real width, and only then
 * is it worth adjusting spaces. Shaping first would burn the whitespace budget
 * on text that was about to get shorter anyway.
 */
describe('abbreviate before shaping', () => {
  const table = mergeAbbreviations([HQ_APPROVED.data, COMMON.data]);

  it('substitutes the longest phrase, not its shorter parts', () => {
    const out = applyAbbreviations(
      'Led training for the Air Force Personnel Center and the Major Command',
      table,
    );
    expect(out).toContain('AFPC');
    expect(out).toContain('MAJCOM');
    // "Air Force" -> "AF" must not fire inside the longer phrase.
    expect(out).not.toContain('AF Personnel Center');
  });

  it('can turn a line that will not fit into one that does', () => {
    const long =
      '- Led Squadron training for the Air Force Personnel Center, briefed the Major Command staff and the Community College of the Air Force';
    const rawResult = shapeLine(long, font, { targetMm: TARGET, sizePt: SIZE_PT });
    const abbreviated = applyAbbreviations(long, table);
    const abbrResult = shapeLine(abbreviated, font, { targetMm: TARGET, sizePt: SIZE_PT });

    expect(rawResult.status).toBe('too-long');
    expect(abbrResult.status).not.toBe('too-long');
    expect(wrapToWidth(abbrResult.text, font, SIZE_PT, TARGET)).toHaveLength(1);
  });

  it('is idempotent, so re-running the pass changes nothing', () => {
    const once = applyAbbreviations('Led Squadron training at the Major Command', table);
    expect(applyAbbreviations(once, table)).toBe(once);
  });
});
