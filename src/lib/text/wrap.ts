import type { FontMetrics } from '../metrics/font';
import { effectiveTargetMm, SHAPING_KERNING } from '../shape/optimizer';

/**
 * Word wrap that breaks where the PDF form breaks.
 *
 * The output pane wraps with these measurements rather than leaving it to the
 * browser: the pane has to break where the optimizer says it breaks. If the
 * browser disagreed by a fraction of a millimetre, a line the optimizer just
 * declared flush would visibly fall onto a second line, and the tool would be
 * telling the user two different things at once.
 *
 * Both the kerning setting and the target come from the optimizer rather than
 * being repeated here, because that divergence is not hypothetical -- wrapping
 * at the nominal width while the optimizer allowed its 0.55px slack put a
 * shaped line onto two rows.
 *
 * ## Where a break may fall
 *
 * Not only at spaces. Acrobat will also break after `? / | - % !` when a letter
 * or digit follows, which is why "USAFE-AFAFRICA" and "AF/A1" can split on the
 * form. Wrapping only at spaces made the preview claim a bullet took one line
 * where the form gives it two, which is the single thing this pane exists to
 * get right. The rule below is pdf-bullets' `AdobeLineSplitFn`, and the
 * fallback to breaking mid-token matches its behaviour for a first token wider
 * than the field.
 */

/**
 * Split points: after one of ``\u2004 \u2009 \u2006 whitespace ? / | - % !``,
 * but only when the next character is a letter, digit, `+` or backslash. The
 * separator stays attached to the fragment before it, so a break never leaves a
 * dangling space at the start of a row.
 */
const BREAK_AFTER = /([\u2004\u2009\u2006\s?/|\-%!])(?=[a-zA-Z0-9+\\])/;

export function splitAtBreakPoints(text: string): string[] {
  return text.split(BREAK_AFTER).filter(Boolean);
}

export function wrapToWidth(
  text: string,
  font: FontMetrics,
  sizePt: number,
  widthMm: number,
): string[] {
  if (text === '') return [''];
  if (widthMm <= 0) return [text];

  const limit = effectiveTargetMm(widthMm);
  const measure = (t: string) => font.widthMm(t, sizePt, SHAPING_KERNING);
  return wrap(text, measure, limit);
}

function wrap(
  text: string,
  measure: (t: string) => number,
  limit: number,
): string[] {
  if (text === '') return [''];
  if (measure(text.trimEnd()) < limit) return [text];

  const parts = splitAtBreakPoints(text);

  // The usual case: break at the last split point that still fits.
  if (parts.length > 0 && measure(parts[0]!.trimEnd()) < limit) {
    let cut = 0;
    for (let i = 1; i <= parts.length; i += 1) {
      if (measure(parts.slice(0, i).join('').trimEnd()) > limit) {
        cut = i - 1;
        break;
      }
    }
    const rest = parts.slice(cut).join('');
    // No progress -- one fragment is the whole line and still too wide.
    if (rest === text) return [text];
    return [parts.slice(0, cut).join('').trimEnd(), ...wrap(rest, measure, limit)];
  }

  // A single token wider than the field has to break inside itself. Guess by
  // average character width, then walk to the exact character.
  const full = measure(text.trimEnd());
  const average = full / text.length;
  const guess = Math.trunc(limit / average);
  let cut = guess;
  if (measure(text.substring(0, guess)) > limit) {
    for (let i = guess - 1; i > 0; i -= 1) {
      if (measure(text.substring(0, i)) < limit) {
        cut = i;
        break;
      }
    }
  } else {
    for (let i = guess; i <= text.length; i += 1) {
      if (measure(text.substring(0, i)) > limit) {
        cut = i - 1;
        break;
      }
    }
  }
  const rest = text.substring(cut);
  if (rest === text) return [text];
  return [text.substring(0, cut), ...wrap(rest, measure, limit)];
}
