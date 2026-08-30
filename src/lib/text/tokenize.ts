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
