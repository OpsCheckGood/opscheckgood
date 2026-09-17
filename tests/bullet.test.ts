import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { shapeBullet, shapeBullets, rowStatuses, joinRows } from '@/lib/shape/bullet';
import { effectiveTargetMm, shapeLine } from '@/lib/shape/optimizer';
import {
  SPACE_CHARS,
  countSpaces,
  plainSpaces,
  unshape,
  usesOnlyPermittedSpaces,
} from '@/lib/shape/spaces';
import { wrapToWidth } from '@/lib/text/wrap';

const SIZE_PT = 12;
const TARGET = 202.321;

let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics('/fonts/LiberationSerif-Regular.ttf');
});

const options = { targetMm: TARGET, sizePt: SIZE_PT };
const width = (t: string) => font.widthMm(t, SIZE_PT, false);

const ONE_ROW =
  '- Led 12-person team through the wing readiness inspection; drove a 42% cut in open discrepancies across 210 actions';
const TWO_ROWS =
  '- Coordinated 22 close air support missions with four joint task force partners while mentoring nine airmen through upgrade training and rewriting the preflight checklist from scratch';
const THREE_ROWS = `${TWO_ROWS}; hailed by MAJCOM/A4 as the best practice in the command and adopted wing-wide within 90 days by every squadron on station`;

describe('shapeBullet', () => {
  it('leaves a bullet that fits one row to shapeLine, unchanged', () => {
    const bullet = shapeBullet(ONE_ROW, font, options);
    const line = shapeLine(ONE_ROW, font, options);
    expect(bullet.wrapped).toBe(false);
    expect(bullet.rows).toHaveLength(1);
    expect(bullet.text).toBe(line.text);
    expect(bullet.rows[0]).toEqual(line);
    expect(bullet.whole).toEqual(line);
  });

  it('breaks a long bullet where the form breaks it', () => {
    const bullet = shapeBullet(TWO_ROWS, font, options);
    expect(bullet.wrapped).toBe(true);
    expect(bullet.rows.length).toBeGreaterThanOrEqual(2);
    const rows = wrapToWidth(unshape(TWO_ROWS), font, SIZE_PT, TARGET).map((r) => r.trim());
    expect(bullet.rows.map((r) => unshape(r.text))).toEqual(rows);
  });

  it('shapes every full row toward flush and leaves the last row as typed', () => {
    const bullet = shapeBullet(THREE_ROWS, font, options);
    expect(bullet.rows.length).toBeGreaterThanOrEqual(3);
    const last = bullet.rows.length - 1;
    for (let i = 0; i < last; i += 1) {
      const row = bullet.rows[i]!;
      // A full row is never over. It may still be short when the word that
      // follows it was too long to pull up; that is reported, not hidden.
      expect(['at-target', 'shaped', 'too-short']).toContain(row.status);
      expect(row.widthMm).toBeLessThanOrEqual(effectiveTargetMm(TARGET));
      expect(row.widthMm).toBeGreaterThanOrEqual(row.naturalWidthMm);
    }
    const tail = bullet.rows[last]!;
    expect(tail.status).toBe('at-target');
    expect(tail.text).toBe(unshape(tail.text));
    expect(countSpaces(tail.text)[SPACE_CHARS.THREE_PER_EM]).toBe(0);
    expect(countSpaces(tail.text)[SPACE_CHARS.SIX_PER_EM]).toBe(0);
  });

  it('keeps every word and only permitted spaces in the output paragraph', () => {
    for (const source of [ONE_ROW, TWO_ROWS, THREE_ROWS]) {
      const bullet = shapeBullet(source, font, options);
      expect(usesOnlyPermittedSpaces(bullet.text)).toBe(true);
      expect(unshape(bullet.text)).toBe(unshape(source));
      expect(bullet.text).not.toContain('\n');
    }
  });

  it('wraps its own output paragraph at the same rows, so the form will too', () => {
    for (const source of [TWO_ROWS, THREE_ROWS]) {
      const bullet = shapeBullet(source, font, options);
      const again = wrapToWidth(bullet.text, font, SIZE_PT, TARGET).map((r) => r.trimEnd());
      expect(again).toEqual(bullet.rows.map((r) => r.text));
    }
  });

  it('reports the one-row attempt so the panel can say what to cut', () => {
    const bullet = shapeBullet(TWO_ROWS, font, options);
    expect(bullet.whole.status).toBe('too-long');
    expect(bullet.whole.minWidthMm).toBeGreaterThan(TARGET);
  });

  it('gives up gracefully on a single token wider than the field', () => {
    const token = `- ${'x'.repeat(200)}`;
    const bullet = shapeBullet(token, font, options);
    expect(bullet.whole.status).toBe('too-long');
    expect(width(bullet.text)).toBeGreaterThan(TARGET);
  });

  it('breaks inside a token at a hyphen or slash without inventing a space', () => {
    const line = `- ${'padding '.repeat(24)}USAFE-AFAFRICA tail with more words to spill`;
    const bullet = shapeBullet(line, font, options);
    expect(bullet.wrapped).toBe(true);
    expect(unshape(bullet.text)).toBe(unshape(line));
    expect(bullet.text).toContain('USAFE-AFAFRICA');
  });
});

describe('joinRows', () => {
  it('joins rows with a space, except after a break character', () => {
    expect(joinRows(['- a b', 'c d'])).toBe('- a b c d');
    expect(joinRows(['- USAFE-', 'AFAFRICA'])).toBe('- USAFE-AFAFRICA');
    expect(joinRows(['- AF/', 'A1 x'])).toBe('- AF/A1 x');
    expect(joinRows(['only'])).toBe('only');
  });
});

describe('rowStatuses', () => {
  it('never calls the last row of a wrapped bullet short', () => {
    const bullet = shapeBullet(TWO_ROWS, font, options);
    const on = rowStatuses(bullet, true);
    const off = rowStatuses(bullet, false);
    expect(on[on.length - 1]).toBe('at-target');
    expect(off[off.length - 1]).toBe('at-target');
  });

  it('judges the text as typed when auto-space is off', () => {
    const short = '- Led team';
    const bullet = shapeBullet(short, font, options);
    expect(rowStatuses(bullet, false)).toEqual(['too-short']);
    expect(rowStatuses(bullet, true)).toEqual(['too-short']);
  });
});

describe('shapeBullets', () => {
  it('shapes every line and preserves blank lines and order', () => {
    const results = shapeBullets(`${ONE_ROW}\n\n${TWO_ROWS}`, font, options);
    expect(results).toHaveLength(3);
    expect(results[1]!.whole.status).toBe('empty');
    expect(results[1]!.text).toBe('');
    expect(results[2]!.wrapped).toBe(true);
  });
});

describe('plainSpaces', () => {
  it('turns shaped output back into the plain draft it came from, one for one', () => {
    const shaped = shapeBullet(ONE_ROW, font, options).text;
    const spaces = countSpaces(shaped);
    expect(spaces[SPACE_CHARS.SIX_PER_EM] + spaces[SPACE_CHARS.THREE_PER_EM]).toBeGreaterThan(0);
    const plain = plainSpaces(shaped);
    expect(plain).toBe(ONE_ROW);
    expect(plain.length).toBe(shaped.length);
  });

  it("covers pdf-bullets' thin space and the no-break space, and keeps everything else", () => {
    const pasted = '- Led\u2009the\u00a0team\u2006to\u2004a win  \n- next';
    expect(plainSpaces(pasted)).toBe('- Led the team to a win  \n- next');
  });

  it('leaves plain text alone', () => {
    expect(plainSpaces(TWO_ROWS)).toBe(TWO_ROWS);
    expect(plainSpaces('')).toBe('');
  });
});
