import type { AgencyCategory, Situation } from '../data/types';

/**
 * "What does your Airman need help with?"
 *
 * One box over two kinds of thing: the situations a Shirt would describe in
 * their own words ("can't pay their bills") and the agencies they might already
 * know they want ("finance"). Both are searched, situations rank first, because
 * someone who types "money" wants routing rather than an org chart.
 *
 * Deterministic and offline -- plain substring and token matching over the
 * shipped data. No index to go stale, and the same query always ranks the same.
 */

export type ResultKind = 'situation' | 'category';

export interface SearchResult {
  kind: ResultKind;
  id: string;
  label: string;
  /** Secondary line: the blurb, or the agency a situation starts at. */
  detail: string;
  score: number;
}

/** Lowercased words, punctuation dropped. Apostrophes fold so "cant" finds "can't". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * How well `haystack` answers `query`.
 *
 * Whole-phrase hits beat scattered word hits, and a hit at the start of the
 * label beats one buried in it -- typing "pay" should surface "Has a pay
 * problem" above anything that merely mentions pay.
 */
function scoreText(queryTokens: string[], phrase: string, weight: number): number {
  const haystack = phrase.toLowerCase().replace(/['’]/g, '');
  const joined = queryTokens.join(' ');
  let score = 0;
  if (joined.length > 0 && haystack.includes(joined)) {
    score += weight * (haystack.startsWith(joined) ? 3 : 2);
  }
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += weight;
  }
  return score;
}

export function search(
  query: string,
  situations: readonly Situation[],
  categories: readonly AgencyCategory[],
  categoryLabel: (id: string) => string,
): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];

  for (const situation of situations) {
    const score =
      scoreText(tokens, situation.label, 10) +
      scoreText(tokens, situation.keywords.join(' '), 6) +
      scoreText(tokens, situation.questions.join(' '), 1);
    if (score > 0) {
      results.push({
        kind: 'situation',
        id: situation.id,
        label: situation.label,
        detail: `Start with ${categoryLabel(situation.startHere)}`,
        score,
      });
    }
  }

  for (const category of categories) {
    const score = scoreText(tokens, category.label, 8) + scoreText(tokens, category.blurb, 3);
    if (score > 0) {
      results.push({
        kind: 'category',
        id: category.id,
        label: category.label,
        detail: category.blurb,
        score,
      });
    }
  }

  // Ties break on label so the order never depends on file order.
  return results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}
