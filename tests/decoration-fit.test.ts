import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { CERTIFICATE } from '@/lib/data/decorations';
import {
  applyEdit,
  columnsFor,
  fitCitation,
  normalizeCitation,
  wrapMonospace,
  type CitationLimits,
} from '@/lib/decoration/fit';

const certificate = CERTIFICATE.data;

let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics(certificate.font.file);
});

describe('the certificate font', () => {
  it('is monospace, so a column is a column whatever the letter', () => {
    const cell = font.widthMm('0', certificate.font.sizePt, false);
    for (let code = 32; code <= 126; code += 1) {
      const ch = String.fromCharCode(code);
      expect(font.widthMm(ch, certificate.font.sizePt, false), `"${ch}"`).toBeCloseTo(cell, 6);
    }
  });

  it('measures Courier New at 6.6pt per character at 11pt', () => {
    // 0.6 em is what Courier New advances; Liberation Mono is metric-compatible.
    // Liberation Mono advances 1229/2048 em, a hair over 0.6; within a hundredth of a millimetre.
    expect(font.widthMm('x', 11, false)).toBeCloseTo(6.6 * (25.4 / 72), 2);
  });

  /**
   * Pins the working figure. 172.4mm at 11pt Courier is 74 columns; if the
   * data changes, this changes with it, deliberately.
   */
  it('derives 74 columns from the template box width', () => {
    expect(columnsFor(font, certificate.font.sizePt, certificate.box.widthMm!)).toBe(74);
  });
});

describe('wrapMonospace', () => {
  it('leaves short text on one line', () => {
    expect(wrapMonospace('During this period', 74)).toEqual(['During this period']);
  });

  it('breaks at the last space that fits and swallows the break space', () => {
    expect(wrapMonospace('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(wrapMonospace('aaaa bbbb cccc', 10)).toEqual(['aaaa bbbb', 'cccc']);
    expect(wrapMonospace('aaaa bbbb cccc', 14)).toEqual(['aaaa bbbb cccc']);
  });

  it('never emits a line wider than the column count', () => {
    const text =
      'Sergeant Ponde led a twelve-person team through a no-notice inspection and a hurricane evacuation without a single discrepancy or injury.';
    for (let columns = 5; columns <= 80; columns += 1) {
      for (const line of wrapMonospace(text, columns)) {
        expect(line.length, `columns=${columns}`).toBeLessThanOrEqual(columns);
      }
    }
  });

  it('breaks a word longer than the box at the column boundary', () => {
    expect(wrapMonospace('ab supercalifragilistic cd', 8)).toEqual(['ab', 'supercal', 'ifragili', 'stic cd']);
  });

  it('loses no characters other than the spaces it breaks on', () => {
    const text = 'one two  three   four five six seven eight nine ten';
    const rows = wrapMonospace(text, 12);
    expect(rows.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('does not treat a hyphen as a break', () => {
    expect(wrapMonospace('Joint Base Langley-Eustis', 20)).toEqual(['Joint Base', 'Langley-Eustis']);
  });
});

describe('fitCitation', () => {
  const limits: CitationLimits = { columns: 74, lines: 20, maxChars: 1350 };

  it('reports the binding overflow', () => {
    const line = 'a'.repeat(74);
    const twentyOne = Array.from({ length: 21 }, () => line).join(' ');
    const result = fitCitation(twentyOne, limits);
    expect(result.lineCount).toBe(21);
    expect(result.overLines).toBe(1);
    expect(result.overChars).toBeGreaterThan(0);
    expect(result.fits).toBe(false);
  });

  /**
   * The reason the tool exists: 1350 characters can wrap to more lines than
   * the box holds, so the counter alone does not protect a citation.
   */
  it('can fail on lines while under the character cap', () => {
    // Twelve-letter words with single spaces: 74 columns fit five words and
    // waste nine cells per line, so 1350 characters need 21 lines.
    const words = Array.from({ length: 104 }, () => 'accomplished');
    const text = words.join(' ').slice(0, 1350);
    const result = fitCitation(text, limits);
    expect(result.chars).toBe(1350);
    expect(result.overChars).toBe(0);
    expect(result.lineCount).toBeGreaterThan(20);
    expect(result.fits).toBe(false);
  });

  it('accepts a full-length citation that packs well', () => {
    // Nine-letter words plus a space fit 7.4 to a line; 1350 characters is
    // 135 words, which is 20 lines of seven with a little room.
    const words = Array.from({ length: 140 }, () => 'distinctp');
    const text = words.join(' ').slice(0, 1350);
    const result = fitCitation(text, limits);
    expect(result.chars).toBe(1350);
    expect(result.lineCount).toBeLessThanOrEqual(20);
    expect(result.fits).toBe(true);
  });
});

describe('applyEdit', () => {
  const limits: CitationLimits = { columns: 10, lines: 2, maxChars: 1350 };
  const plain = (inner: string) => inner;

  it('accepts an edit that fits', () => {
    expect(applyEdit('abc', 'abcd', plain, limits)).toEqual({ text: 'abcd', outcome: 'accepted', cut: '' });
  });

  it('always accepts a deletion', () => {
    const full = 'aaaaaaaaaa bbbbbbbbbb';
    expect(applyEdit(full, 'aaaaaaaaaa bbbbbbbbb', plain, limits).outcome).toBe('accepted');
  });

  it('refuses the keystroke that would start a third line', () => {
    const full = 'aaaaaaaaaa bbbbbbbbbb';
    const result = applyEdit(full, `${full}c`, plain, limits);
    expect(result.outcome).toBe('blocked');
    expect(result.text).toBe(full);
    expect(result.cut).toBe('c');
  });

  it('refuses a keystroke in the middle that pushes the tail over', () => {
    const full = 'aaaaaaaaaa bbbbbbbbbb';
    const result = applyEdit(full, 'aaaaaaaaaa cbbbbbbbbbb', plain, limits);
    expect(result.outcome).toBe('blocked');
    expect(result.text).toBe(full);
  });

  it('trims a paste to what fits and hands back the rest', () => {
    const result = applyEdit('aaaa', 'aaaa bbbbb ccccc ddddd', plain, limits);
    expect(result.outcome).toBe('trimmed');
    // Two lines of ten: "aaaa bbbbb" and "ccccc dddd"; the fifth d is one too many.
    expect(result.text).toBe('aaaa bbbbb ccccc dddd');
    expect(result.cut).toBe('d');
    expect(fitCitation(result.text, limits).fits).toBe(true);
  });

  it('trims a paste dropped into the middle rather than the existing tail', () => {
    const result = applyEdit('aaaa zzzz', 'aaaa bbbbb ccccc ddddd zzzz', plain, limits);
    expect(result.outcome).toBe('trimmed');
    expect(result.text.endsWith('zzzz')).toBe(true);
    expect(result.text.startsWith('aaaa ')).toBe(true);
    expect(fitCitation(result.text, limits).fits).toBe(true);
  });

  it('holds the whole citation to the box, not just the editable part', () => {
    const wrap = (inner: string) => `OPEN ${inner} CLOSE`.trim();
    // "OPEN  CLOSE" is eleven characters on the one line allowed; one more
    // character in the middle wraps it.
    const one: CitationLimits = { columns: 11, lines: 1, maxChars: 1350 };
    expect(fitCitation(wrap(''), one).fits).toBe(true);
    const result = applyEdit('', 'x', wrap, one);
    expect(result.outcome).toBe('blocked');
    expect(result.text).toBe('');
  });

  it('enforces the character cap as well', () => {
    const tight: CitationLimits = { columns: 100, lines: 100, maxChars: 5 };
    expect(applyEdit('abcde', 'abcdef', plain, tight).outcome).toBe('blocked');
    expect(applyEdit('ab', 'abcdefgh', plain, tight)).toEqual({ text: 'abcde', outcome: 'trimmed', cut: 'fgh' });
  });
});

describe('normalizeCitation', () => {
  it('turns line breaks into spaces, since the citation is one paragraph', () => {
    expect(normalizeCitation('one\ntwo\r\nthree')).toBe('one two three');
  });
});
