import type { FontMetrics } from '../metrics/font';
import { splitLines } from '../text/tokenize';
import { wrapToWidth } from '../text/wrap';
import {
  measureLine,
  shapeLine,
  unshapedStatus,
  type ShapeOptions,
  type ShapeResult,
  type ShapeStatus,
} from './optimizer';
import { unshape } from './spaces';

/**
 * Shaping a whole bullet, which may take more than one row of the field.
 *
 * pdf-bullets treats every paragraph as a single row: a bullet that runs onto
 * a second row is simply red. That forces people to press Enter where they
 * think the form will break, and then to ignore the red on the short last
 * row. This module does what the form does instead. A bullet that cannot be
 * narrowed onto one row is broken where the form will break it -- the same
 * rule the output pane wraps with -- every full row is shaped to flush, and
 * the last row is left exactly as typed, because on the form it ends wherever
 * the words end.
 *
 * The half-spaces stay inside their rows. A full row is widened only up to the
 * field width, so the word that follows it still does not fit beside it, and
 * the form breaks in the same place when the paragraph is pasted back in. The
 * differential test against pdf-bullets is untouched: a bullet that fits one
 * row goes through `shapeLine` exactly as before.
 */

export interface BulletResult {
  /**
   * The rows the form will show, each shaped on its own. One row for most
   * bullets; the last row of a wrapped bullet is measured, not shaped.
   */
  rows: ShapeResult[];
  /** True when the bullet takes more than one row of the field. */
  wrapped: boolean;
  /**
   * The bullet shaped as if it had to sit on one row. For a wrapped bullet
   * this is the `too-long` attempt, which is what says how much would have to
   * go for it to fit on one row.
   */
  whole: ShapeResult;
  /** The output: one paragraph, rows joined the way they were split. */
  text: string;
}

/** Break characters the wrapper may split after without a space. */
const BREAK_CHAR = /[?/|\-%!]$/;

/**
 * Joins rows back into the paragraph they came from. A row that ended at a
 * hyphen or slash was cut inside a token, so it is joined to the next without
 * inserting a space that was never there.
 */
export function joinRows(rows: readonly string[]): string {
  let out = '';
  rows.forEach((row, i) => {
    if (i === 0) {
      out = row;
      return;
    }
    out += BREAK_CHAR.test(out) ? row : ` ${row}`;
  });
  return out;
}

export function shapeBullet(
  line: string,
  font: FontMetrics,
  options: ShapeOptions,
): BulletResult {
  const whole = shapeLine(line, font, options);
  const single = (): BulletResult => ({ rows: [whole], wrapped: false, whole, text: whole.text });

  if (whole.status !== 'too-long') return single();

  const plain = unshape(line);
  const rowTexts = wrapToWidth(plain, font, options.sizePt, options.targetMm).map((r) =>
    r.trim(),
  );
  // An unbreakable token wider than the field: nothing to do but report it.
  if (rowTexts.length <= 1) return single();

  const last = rowTexts.length - 1;
  const rows = rowTexts.map((row, i) =>
    i < last ? shapeLine(row, font, options) : measureLine(row, font, options),
  );
  return { rows, wrapped: true, whole, text: joinRows(rows.map((r) => r.text)) };
}

/** Shapes every line of a document, preserving blank lines and order. */
export function shapeBullets(
  text: string,
  font: FontMetrics,
  options: ShapeOptions,
): BulletResult[] {
  return splitLines(text).map((line) => shapeBullet(line, font, options));
}

/**
 * The verdict for each row of a bullet.
 *
 * With Auto-Space on it is the row's own status. With it off the output is
 * the text as typed, so the verdict is about that text. The last row of a
 * wrapped bullet is never short: it is not expected to be flush.
 */
export function rowStatuses(bullet: BulletResult, autoSpace: boolean): ShapeStatus[] {
  const last = bullet.rows.length - 1;
  return bullet.rows.map((row, i) => {
    if (bullet.wrapped && i === last) {
      return row.status === 'too-long' ? 'too-long' : row.status === 'empty' ? 'empty' : 'at-target';
    }
    return autoSpace ? row.status : unshapedStatus(row);
  });
}

/** The output text of a bullet, as spaced by the tool or as typed. */
export function bulletText(bullet: BulletResult, autoSpace: boolean): string {
  return autoSpace ? bullet.text : unshape(bullet.text);
}

/** The rows to draw: shaped rows as they are, or the text as typed re-wrapped. */
export function displayRows(
  bullet: BulletResult,
  autoSpace: boolean,
  font: FontMetrics,
  options: ShapeOptions,
): string[] {
  if (autoSpace) return bullet.rows.map((r) => r.text);
  // As typed, the form still wraps it; show where.
  return wrapToWidth(unshape(bullet.text), font, options.sizePt, options.targetMm);
}
