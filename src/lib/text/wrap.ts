import type { FontMetrics } from '../metrics/font';
import { effectiveTargetMm, SHAPING_KERNING } from '../shape/optimizer';

/**
 * Greedy word wrap using our own font metrics.
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
 */
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

  // Keep the shaping spaces attached to the word that follows, so a substituted
  // space is never what lands at a line break.
  const parts = text.split(/(\s)/).filter((p) => p !== '');
  const lines: string[] = [];
  let line = '';

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    const candidate = line + part;
    if (line !== '' && measure(candidate.trimEnd()) > limit) {
      lines.push(line.trimEnd());
      line = /\s/.test(part) ? '' : part;
    } else {
      line = candidate;
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}
