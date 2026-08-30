import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFontMetrics, decodeBase64 } from '@/lib/metrics/registry';
import { createFontMetrics, type FontMetrics, type OpenTypeFont } from '@/lib/metrics/font';
import { fontUnitsToMm, mmToFontUnits, MM_PER_POINT } from '@/lib/metrics/units';
import { SPACE_CHARS } from '@/lib/shape/spaces';

const SERIF = '/fonts/LiberationSerif-Regular.ttf';

describe('unit conversion', () => {
  it('converts points to millimetres at 1/72 inch', () => {
    expect(MM_PER_POINT).toBeCloseTo(0.3527777, 6);
  });

  it('round-trips millimetres through font units', () => {
    const units = mmToFontUnits(50, 2048, 12);
    expect(fontUnitsToMm(units, 2048, 12)).toBeCloseTo(50, 10);
  });
});

describe('font metrics', () => {
  let serif: FontMetrics;
  beforeAll(async () => {
    serif = await loadFontMetrics(SERIF);
  });

  it('parses the embedded font', () => {
    expect(serif.unitsPerEm).toBe(2048);
  });

  // Regression guard for the opentype.js trap documented in font.ts. Kerning
  // must come from somewhere; 'none' would mean we silently lost all of it.
  it('resolves kerning from GPOS under the latn script', () => {
    expect(serif.kerningSource).toBe('gpos');
  });

  // If someone "simplifies" font.ts to use the library helper, this fails.
  // opentype.js resolves the default script to DFLT, which has zero kern
  // lookups, and so reports no kerning at all for Latin text in this font.
  it("does not trust opentype.js's own kerning helpers", async () => {
    const opentype = (await import('opentype.js')).default;
    const raw = opentype.parse(
      decodeBase64((await import('@/lib/metrics/embedded/LiberationSerif-Regular')).base64),
    ) as OpenTypeFont;
    const A = raw.charToGlyph('A');
    const V = raw.charToGlyph('V');

    expect(raw.position.getDefaultScriptName()).toBe('DFLT');
    expect(raw.position.getKerningTables('DFLT', undefined)).toHaveLength(0);
    expect(raw.position.getKerningTables('latn', undefined)).toHaveLength(1);

    // The library says zero. The font says -264.
    expect(raw.getKerningValue(A, V)).toBe(0);
    expect(raw.getAdvanceWidth('AV', 12)).toBeCloseTo(
      ((A.advanceWidth! + V.advanceWidth!) / raw.unitsPerEm) * 12,
      10,
    );
    expect(serif.kernUnits('A', 'V')).toBe(-264);
  });

  // GPOS and the legacy kern table both carry Latin kerning here, and they
  // agree. If a future font disagrees, the fallback order needs revisiting.
  it('agrees with the legacy kern table', async () => {
    const opentype = (await import('opentype.js')).default;
    const raw = opentype.parse(
      decodeBase64((await import('@/lib/metrics/embedded/LiberationSerif-Regular')).base64),
    ) as OpenTypeFont;
    const key = `${raw.charToGlyph('A').index},${raw.charToGlyph('V').index}`;
    expect(raw.kerningPairs[key]).toBe(serif.kernUnits('A', 'V'));
  });

  it('applies kerning: a kerned pair is narrower than the sum of its advances', () => {
    const unkernedAV = serif.advanceUnits('A') + serif.advanceUnits('V');
    const kernedAV = serif.advanceUnits('AV');
    expect(kernedAV).toBeLessThan(unkernedAV);
    expect(serif.kernUnits('A', 'V')).toBe(-264);
    expect(unkernedAV - kernedAV).toBe(264);
  });

  it('leaves an unkerned pair at the sum of its advances', () => {
    const unkerned = serif.advanceUnits('o') + serif.advanceUnits('o');
    expect(serif.advanceUnits('oo')).toBe(unkerned);
    expect(serif.kernUnits('o', 'o')).toBe(0);
  });

  it('measures a known string to a known width', () => {
    // A=1479 + V=1479 advance units, kern -264 => 2694 units at 2048/em.
    // 2694/2048 em * 12 pt * 25.4/72 mm/pt = 5.5688 mm
    expect(serif.advanceUnits('AV')).toBe(2694);
    expect(serif.widthMm('AV', 12)).toBeCloseTo(5.5688, 3);
  });

  it('is deterministic across repeated calls and re-parses', async () => {
    const first = serif.widthMm('Led 12-person team; drove 4 initiatives', 12);
    for (let i = 0; i < 25; i += 1) {
      expect(serif.widthMm('Led 12-person team; drove 4 initiatives', 12)).toBe(first);
    }
    // A completely fresh parse of the same bytes must agree exactly.
    const fresh = createFontMetrics(
      decodeBase64(
        (await import('@/lib/metrics/embedded/LiberationSerif-Regular')).base64,
      ),
    );
    expect(fresh.widthMm('Led 12-person team; drove 4 initiatives', 12)).toBe(first);
  });

  it('scales linearly with point size', () => {
    expect(serif.widthMm('Squadron', 24)).toBeCloseTo(serif.widthMm('Squadron', 12) * 2, 10);
  });

  it('orders the shaping space characters narrow to wide', () => {
    const six = serif.advanceUnits(SPACE_CHARS.SIX_PER_EM);
    const normal = serif.advanceUnits(SPACE_CHARS.NORMAL);
    const three = serif.advanceUnits(SPACE_CHARS.THREE_PER_EM);
    expect(six).toBeLessThan(normal);
    expect(normal).toBeLessThan(three);
    // 1/6, 1/4 and 1/3 of a 2048-unit em.
    expect([six, normal, three]).toEqual([341, 512, 683]);
  });

  it('reports characters the font cannot render', () => {
    expect(serif.unsupportedChars('Led a team')).toEqual([]);
    expect(serif.unsupportedChars('Led a team \u{1F600}')).toEqual(['\u{1F600}']);
  });

  it('matches the bytes committed in public/fonts', async () => {
    const module = await import('@/lib/metrics/embedded/LiberationSerif-Regular');
    const onDisk = readFileSync(new URL('../public/fonts/LiberationSerif-Regular.ttf', import.meta.url));
    expect(module.byteLength).toBe(onDisk.byteLength);
    expect(Buffer.from(decodeBase64(module.base64)).equals(onDisk)).toBe(true);
  });
});
