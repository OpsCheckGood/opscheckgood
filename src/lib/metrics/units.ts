/**
 * Unit conversion for type measurement.
 *
 * Three units are in play and conflating them is the classic source of
 * silently-wrong widths:
 *
 *   font units -- the font's own integer grid, `unitsPerEm` per em (2048 for
 *                 Liberation). Glyph advance widths are in these.
 *   points     -- 1/72 inch. Form definitions specify type size in points.
 *   millimetres-- what AF form field widths are given in, and what we display.
 */

/** 1 pt = 1/72 in, 1 in = 25.4 mm. */
export const MM_PER_POINT = 25.4 / 72;

export function pointsToMm(pt: number): number {
  return pt * MM_PER_POINT;
}

export function mmToPoints(mm: number): number {
  return mm / MM_PER_POINT;
}

/**
 * Converts a font-unit advance to millimetres at a given type size.
 *
 * `units / unitsPerEm` gives ems; ems times the point size gives points.
 */
export function fontUnitsToMm(units: number, unitsPerEm: number, sizePt: number): number {
  return (units / unitsPerEm) * sizePt * MM_PER_POINT;
}

export function mmToFontUnits(mm: number, unitsPerEm: number, sizePt: number): number {
  return (mm / (sizePt * MM_PER_POINT)) * unitsPerEm;
}

/** Rounds to `places` decimals for display. Never use the result for math. */
export function roundMm(mm: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(mm * factor) / factor;
}
