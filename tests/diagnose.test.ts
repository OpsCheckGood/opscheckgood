import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { shapeLine } from '@/lib/shape/optimizer';
import { diagnose, abbreviationSuggestions } from '@/lib/shape/diagnose';
import { normalizeAbbreviations } from '@/lib/data/abbreviations';
import type { DataMeta } from '@/lib/data/types';

const SIZE_PT = 12;
let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics('/fonts/LiberationSerif-Regular.ttf');
});

const table = () =>
  normalizeAbbreviations(
    [
      { phrase: 'Squadron', abbr: 'Sq' },
      { phrase: 'Air Force', abbr: 'AF' },
      { phrase: 'maintenance', abbr: 'mx' },
    ],
    {} as DataMeta,
    'fixture.json',
  );

const LINE = 'Led 12-person Squadron maintenance team; drove 340 sorties for the Air Force';

describe('diagnose', () => {
  it('says nothing when the line shaped successfully', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    const result = shapeLine(LINE, font, { targetMm: natural, sizePt: SIZE_PT });
    expect(diagnose(result, { font, sizePt: SIZE_PT })).toBeNull();
  });

  it('reports how far over and how much to cut', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    const result = shapeLine(LINE, font, { targetMm: natural - 20, sizePt: SIZE_PT });
    expect(result.status).toBe('too-long');

    const d = diagnose(result, { font, sizePt: SIZE_PT })!;
    expect(d.kind).toBe('over');
    expect(d.offByMm).toBeGreaterThan(0);
    expect(d.characters).toBeGreaterThan(0);
    expect(d.headline).toMatch(/^Can't reach flush\. Over by ~\d+(\.\d+)?mm\.$/);
    expect(d.message).toContain('Cut roughly');
  });

  // Measured from the narrowest achievable width, not the natural width: the
  // spaces have already given everything they can before the user is asked to
  // cut anything.
  it('measures the overage from the edge of what shaping can reach', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    const target = natural - 20;
    const result = shapeLine(LINE, font, { targetMm: target, sizePt: SIZE_PT });
    const d = diagnose(result, { font, sizePt: SIZE_PT })!;
    expect(d.offByMm).toBeCloseTo(result.minWidthMm - target, 9);
    expect(d.offByMm).toBeLessThan(natural - target);
  });

  it('offers abbreviations ranked by measured millimetres saved', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    const result = shapeLine(LINE, font, { targetMm: natural - 20, sizePt: SIZE_PT });
    const d = diagnose(result, { font, sizePt: SIZE_PT, abbreviations: table() })!;

    expect(d.suggestions.length).toBeGreaterThan(0);
    const saves = d.suggestions.map((s) => s.savesMm);
    expect(saves).toEqual([...saves].sort((a, b) => b - a));
    expect(d.message).toMatch(/abbreviate "[^"]+" to "[^"]+" \(saves \d+(\.\d+)?mm\)/);
  });

  it('measures savings rather than counting characters', () => {
    const suggestions = abbreviationSuggestions(LINE, table(), font, SIZE_PT);
    const squadron = suggestions.find((s) => s.phrase === 'Squadron')!;
    expect(squadron.savesMm).toBeCloseTo(
      font.widthMm('Squadron', SIZE_PT) - font.widthMm('Sq', SIZE_PT),
      9,
    );
    // "maintenance" -> "mx" drops more characters than "Squadron" -> "Sq" but
    // the ranking is by width, which is what actually binds.
    expect(suggestions.every((s) => s.savesMm > 0)).toBe(true);
  });

  it('only suggests abbreviations that appear in the line', () => {
    const suggestions = abbreviationSuggestions('Led a small team', table(), font, SIZE_PT);
    expect(suggestions).toEqual([]);
  });

  it('reports how far short and how much to add', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    const result = shapeLine(LINE, font, { targetMm: natural + 60, sizePt: SIZE_PT });
    expect(result.status).toBe('too-short');

    const d = diagnose(result, { font, sizePt: SIZE_PT, abbreviations: table() })!;
    expect(d.kind).toBe('under');
    expect(d.headline).toContain('Short by');
    expect(d.message).toContain('Add roughly');
    // Abbreviating a line that is already too short would make it worse.
    expect(d.suggestions).toEqual([]);
  });

  it('never suggests cutting or adding zero characters', () => {
    const natural = font.widthMm(LINE, SIZE_PT);
    for (const target of [natural - 5, natural - 40, natural + 10, natural + 90]) {
      const result = shapeLine(LINE, font, { targetMm: target, sizePt: SIZE_PT });
      const d = diagnose(result, { font, sizePt: SIZE_PT });
      if (d) expect(d.characters).toBeGreaterThanOrEqual(1);
    }
  });
});
