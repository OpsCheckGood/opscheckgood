/**
 * The space alphabet used for shaping.
 *
 * Padding is done with Unicode space characters, never font-size manipulation,
 * because the output has to survive a copy-paste into an XFA PDF form field.
 * XFA strips per-character styling but preserves the characters themselves, so
 * the shaping must live in the text, not in its formatting. The result is plain
 * text you can paste anywhere.
 *
 * Widths below are fractions of an em; the actual advance always comes from the
 * font. In Liberation Serif (and Times, which it matches metrically) they are
 * 1/6, 1/4 and 1/3 em -- evenly spaced 1/12 em apart, which is what makes even
 * distribution across gaps come out visually smooth.
 *
 * Written as escapes on purpose: these characters are invisible and mutually
 * indistinguishable in an editor, so literals here would be unreviewable.
 */
export const SPACE_CHARS = {
  /** U+2006 SIX-PER-EM SPACE -- 1/6 em, narrower than a normal space. */
  SIX_PER_EM: '\u2006',
  /** U+0020 SPACE -- the baseline, ~1/4 em. */
  NORMAL: '\u0020',
  /** U+2004 THREE-PER-EM SPACE -- 1/3 em, wider than a normal space. */
  THREE_PER_EM: '\u2004',
} as const;

/**
 * Ordered narrow to wide. The optimizer indexes into this as levels 0, 1, 2,
 * so the order is load-bearing -- do not reorder.
 */
export const SPACE_LEVELS = [
  SPACE_CHARS.SIX_PER_EM,
  SPACE_CHARS.NORMAL,
  SPACE_CHARS.THREE_PER_EM,
] as const;

/** The level rendering as an ordinary space, i.e. text as the user typed it. */
export const NORMAL_LEVEL = 1;

export type SpaceChar = (typeof SPACE_LEVELS)[number];

const PERMITTED: ReadonlySet<string> = new Set<string>(SPACE_LEVELS);

/** True when every whitespace character in `text` is one we may emit. */
export function usesOnlyPermittedSpaces(text: string): boolean {
  for (const char of text) {
    if (/\s/.test(char) && !PERMITTED.has(char)) return false;
  }
  return true;
}

/** Counts each shaping space in `text`. Used by tests and the width readout. */
export function countSpaces(text: string): Record<SpaceChar, number> {
  const counts: Record<SpaceChar, number> = {
    [SPACE_CHARS.SIX_PER_EM]: 0,
    [SPACE_CHARS.NORMAL]: 0,
    [SPACE_CHARS.THREE_PER_EM]: 0,
  };
  for (const char of text) {
    if (PERMITTED.has(char)) counts[char as SpaceChar] += 1;
  }
  return counts;
}

/** Restores shaped text to plain single-spaced text. */
export function unshape(text: string): string {
  return text
    .replace(/[\u2004\u2006]/g, SPACE_CHARS.NORMAL)
    .replace(/ {2,}/g, SPACE_CHARS.NORMAL)
    .trim();
}
