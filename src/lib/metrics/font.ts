import opentype from 'opentype.js';
import { fontUnitsToMm } from './units';

/**
 * Text measurement against a real font file.
 *
 * Deliberately NOT canvas `measureText()`: canvas resolves the family through
 * the user's locally installed fonts and silently substitutes when the font is
 * missing, so the same bullet measures differently on two machines. For a tool
 * whose only value is precision, quietly wrong is the one unacceptable failure.
 *
 * ## Kerning, and an opentype.js trap
 *
 * opentype.js 2.x silently drops all kerning for these fonts, and does it
 * through its own public API, so the naive implementation looks correct and
 * measures wrong.
 *
 * `Font.getKerningValue()` reads `position.defaultKerningTables`, which is
 * built from `getDefaultScriptName()`. Liberation declares seven GPOS scripts
 * -- DFLT, bopo, copt, cyrl, grek, hebr, latn -- and the default resolves to
 * `DFLT`, which carries **zero** `kern` lookups. The Latin kerning lives under
 * `latn`. The DFLT query returns an empty array, which is truthy, so
 * `getKerningValue` takes the GPOS branch, finds nothing, returns 0, and never
 * reaches its own legacy-`kern` fallback. `font.getAdvanceWidth()` inherits the
 * same fault: for Liberation Serif it reports "AV" at 12pt as 17.332pt, exactly
 * the unkerned sum, when the true kerned value is 264 units narrower.
 *
 * So we resolve the kerning source ourselves: try the default script, then
 * `latn`, and fall back to the legacy `kern` table when GPOS yields no lookups.
 * For Liberation both sources agree (A/V = -264 units in Serif, -152 in Sans),
 * which the tests assert as a cross-check.
 */

export type KerningSource = 'gpos' | 'kern' | 'none';

export interface FontMetrics {
  readonly family: string;
  readonly unitsPerEm: number;
  /** Which table kerning was actually read from. Asserted in tests. */
  readonly kerningSource: KerningSource;
  /**
   * Advance width of `text` in font units.
   *
   * `kerning` defaults to true, which is correct typography. Pass false to
   * measure the way a PDF form field lays plain text out -- glyph advances
   * only, no GPOS adjustment. That is what the shaping path uses; see the note
   * in shape/optimizer.ts.
   */
  advanceUnits(text: string, kerning?: boolean): number;
  /** Advance width of `text` in millimetres at `sizePt`. */
  widthMm(text: string, sizePt: number, kerning?: boolean): number;
  /** Kerning adjustment between two characters, in font units (usually <= 0). */
  kernUnits(left: string, right: string): number;
  /** Characters with no glyph in this font. Empty is the healthy case. */
  unsupportedChars(text: string): string[];
}

/**
 * The parts of opentype.js we depend on that its type definitions omit.
 * `position` and `kerningPairs` both exist at runtime; see the note above on
 * why we read them directly instead of calling the documented helper.
 */
interface PositionInternals {
  getDefaultScriptName(): string | undefined;
  getKerningTables(script: string, language: string | undefined): unknown[] | undefined;
  getKerningValue(lookups: unknown[], leftIndex: number, rightIndex: number): number;
}

export type OpenTypeFont = ReturnType<typeof opentype.parse> & {
  position: PositionInternals;
  kerningPairs: Record<string, number>;
};

function resolveKerning(font: OpenTypeFont): {
  source: KerningSource;
  lookups: unknown[] | null;
} {
  // A GPOS 'kern' feature takes precedence when the font genuinely has one.
  // Try the font's default script, then 'latn', since DFLT-only fonts are common.
  const scripts = [font.position.getDefaultScriptName(), 'latn'].filter(
    (s): s is string => typeof s === 'string',
  );
  for (const script of scripts) {
    const lookups = font.position.getKerningTables(script, undefined) as unknown[] | undefined;
    if (Array.isArray(lookups) && lookups.length > 0) {
      return { source: 'gpos', lookups };
    }
  }
  const pairs = font.kerningPairs ?? {};
  return Object.keys(pairs).length > 0
    ? { source: 'kern', lookups: null }
    : { source: 'none', lookups: null };
}

export interface CreateFontMetricsOptions {
  /** Overrides the family name read from the font's name table. */
  family?: string;
}

export function createFontMetrics(
  data: ArrayBuffer,
  options: CreateFontMetricsOptions = {},
): FontMetrics {
  const font = opentype.parse(data) as OpenTypeFont;
  const unitsPerEm = font.unitsPerEm;
  const { source, lookups } = resolveKerning(font);

  const family =
    options.family ??
    (font.names?.fontFamily?.en as string | undefined) ??
    'unknown';

  // Glyph lookup dominates the cost, and the optimizer measures many candidate
  // strings per keystroke, so memoize per code point.
  const glyphCache = new Map<number, opentype.Glyph>();
  function glyphFor(codePoint: number): opentype.Glyph {
    let glyph = glyphCache.get(codePoint);
    if (!glyph) {
      glyph = font.charToGlyph(String.fromCodePoint(codePoint));
      glyphCache.set(codePoint, glyph);
    }
    return glyph;
  }

  const kernCache = new Map<string, number>();
  function kernBetween(left: opentype.Glyph, right: opentype.Glyph): number {
    if (source === 'none') return 0;
    const key = `${left.index},${right.index}`;
    const cached = kernCache.get(key);
    if (cached !== undefined) return cached;

    let value = 0;
    if (source === 'gpos' && lookups) {
      value = font.position.getKerningValue(lookups, left.index, right.index) || 0;
    } else {
      value = font.kerningPairs[key] || 0;
    }
    kernCache.set(key, value);
    return value;
  }

  /**
   * Per-code-point advances plus kern pairs. Ligature substitution is
   * deliberately not applied: whether a PDF viewer forms "fi" in an XFA field is
   * not something we can know, and skipping the ligature over-estimates width
   * slightly, which errs toward a shorter line rather than an overflowing one.
   */
  function advanceUnits(text: string, kerning = true): number {
    let total = 0;
    let previous: opentype.Glyph | null = null;
    for (const char of text) {
      const glyph = glyphFor(char.codePointAt(0)!);
      if (kerning && previous) total += kernBetween(previous, glyph);
      total += glyph.advanceWidth ?? 0;
      previous = glyph;
    }
    return total;
  }

  return Object.freeze({
    family,
    unitsPerEm,
    kerningSource: source,
    advanceUnits,
    widthMm(text: string, sizePt: number, kerning = true): number {
      return fontUnitsToMm(advanceUnits(text, kerning), unitsPerEm, sizePt);
    },
    kernUnits(left: string, right: string): number {
      return kernBetween(
        glyphFor(left.codePointAt(0)!),
        glyphFor(right.codePointAt(0)!),
      );
    },
    unsupportedChars(text: string): string[] {
      const missing = new Set<string>();
      for (const char of text) {
        // Index 0 is .notdef -- the font has no glyph for this code point.
        if (glyphFor(char.codePointAt(0)!).index === 0) missing.add(char);
      }
      return [...missing];
    },
  });
}
