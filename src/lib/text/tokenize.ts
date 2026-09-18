/** Leading marks an AF bullet commonly opens with. */
const BULLET_MARKERS = new Set(['-', '--', '–', '—', '•', '*']);

export interface Tokenized {
  /** Words with all whitespace removed; gaps sit between consecutive words. */
  words: string[];
  /**
   * Gap indices that must stay a normal space. Index i is the gap between
   * words[i] and words[i+1]. A bullet's leading "- " is locked so padding never
   * opens a gap between the marker and the first word.
   */
  lockedGaps: Set<number>;
}

export function tokenizeLine(line: string): Tokenized {
  const words = line.trim().split(/\s+/).filter((w) => w.length > 0);
  const lockedGaps = new Set<number>();
  if (words.length > 1 && BULLET_MARKERS.has(words[0]!)) lockedGaps.add(0);
  return { words, lockedGaps };
}

/** Splits a document into lines. One bullet per line is the editor's contract. */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** A line that opens a bullet: a leading mark and then text. */
const OPENS_BULLET = /^\s*(?:--|-|–|—|•|\*)\s*\S/;

export interface BulletSpan {
  /** Zero-based index of the first line. */
  first: number;
  /** Zero-based index of the last line, inclusive. */
  last: number;
}

/**
 * Groups draft lines into statements the way a reader does: a bullet starts
 * at a line that opens with a dash and runs until the next one, so a line
 * without a dash continues the bullet above it. A blank line ends a bullet.
 *
 * A draft with no dashes at all is one statement per line, which is what a
 * plain list pasted in without marks means.
 */
export function groupBullets(lines: readonly string[]): BulletSpan[] {
  const anyMarked = lines.some((l) => OPENS_BULLET.test(l));
  const spans: BulletSpan[] = [];
  let open: BulletSpan | null = null;
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      open = null;
      return;
    }
    if (!anyMarked || OPENS_BULLET.test(line) || open === null) {
      open = { first: i, last: i };
      spans.push(open);
    } else {
      open.last = i;
    }
  });
  return spans;
}
