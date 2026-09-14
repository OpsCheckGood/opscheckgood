import type { AbbreviationTable } from '../data/abbreviations';
import type { WeakOpener } from '../data/types';
import { findAcronyms, findDuplicates } from './analyze';
import { splitLines } from './tokenize';

/**
 * The Review panel: what a reviewer would say out loud, as a list.
 *
 * Reads the draft the shaper reads, so nothing here can disagree with the
 * output. Each finding carries the offsets of the spot it is about, so the
 * panel can put the caret there; fixing it happens in the draft, and the
 * shaper follows on its own. There is deliberately no second text box.
 *
 * Four checks, each the kind of comment that comes back on a package:
 *
 *   - a word used more than once (grouped with its inflections);
 *   - a bullet that opens with a weak word instead of an action verb;
 *   - a bullet with no number in it -- impact without a figure;
 *   - an acronym on neither approved list and not spelled out in the draft.
 */

export type FindingKind = 'repeat' | 'weak-opener' | 'no-number' | 'acronym';

export interface Occurrence {
  /** Zero-based line of the draft. */
  line: number;
  /** Character offsets into the whole draft text. */
  start: number;
  end: number;
}

export interface Finding {
  kind: FindingKind;
  /** The word or phrase the finding is about, as it appears in the draft. */
  token: string;
  /** Every place it occurs; the first is where a click lands. */
  occurrences: Occurrence[];
  /** One sentence. */
  message: string;
  /** Shorter or stronger alternatives when the check knows any. */
  suggestions: string[];
}

export interface ReviewSources {
  stopwords: ReadonlySet<string>;
  hq: AbbreviationTable;
  common: AbbreviationTable;
  weakOpeners: readonly WeakOpener[];
}

const WORD = /[A-Za-z][A-Za-z'’-]*/g;
/** A bullet's leading mark and the space after it. */
const LEAD = /^\s*(?:--|-|–|—|•|\*)?\s*/;

/** Start offset of each line in the joined text. */
function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every occurrence of any of `forms` as a whole word, in draft order. */
function occurrencesOf(
  forms: readonly string[],
  lines: readonly string[],
  starts: readonly number[],
  caseSensitive = false,
): Occurrence[] {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])(?:${forms.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`,
    caseSensitive ? 'g' : 'gi',
  );
  const found: Occurrence[] = [];
  lines.forEach((line, i) => {
    for (const match of line.matchAll(pattern)) {
      found.push({
        line: i,
        start: starts[i]! + match.index!,
        end: starts[i]! + match.index! + match[0].length,
      });
    }
  });
  return found;
}

/**
 * "MAJCOM/A4" and "USAFE-AFAFRICA" are one token to the tokenizer but two
 * acronyms to a reader. The compound is fine when every part that could be an
 * acronym is on a list; an office symbol like "A4" -- a letter and digits --
 * is never an acronym and is not held against it.
 */
function compoundIsKnown(token: string, sources: ReviewSources): boolean {
  const parts = token.split(/[/&-]/).filter((p) => p !== '');
  if (parts.length < 2) return false;
  const checked = parts.filter((p) => !/^[A-Z]\d+$/.test(p));
  if (checked.length === 0) return true;
  return findAcronyms(checked.join(' '), sources.hq, sources.common).every(
    (found) => found.tier !== 'unknown',
  );
}

export function reviewDraft(text: string, sources: ReviewSources): Finding[] {
  const lines = splitLines(text);
  const starts = lineStarts(lines);
  const findings: Finding[] = [];

  // Repeated words, grouped with their inflections.
  for (const dup of findDuplicates(text, sources.stopwords)) {
    const occurrences = occurrencesOf(dup.forms, lines, starts);
    if (occurrences.length < 2) continue;
    findings.push({
      kind: 'repeat',
      token: dup.forms.join(' / '),
      occurrences,
      message: dup.related
        ? `Forms of "${dup.word}" appear ${dup.count} times.`
        : `"${dup.word}" appears ${dup.count} times.`,
      suggestions: [],
    });
  }

  // Weak openers and bullets with no number, one pass over the lines.
  const weak = new Map(sources.weakOpeners.map((w) => [w.word, w]));
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const lead = LEAD.exec(line)?.[0].length ?? 0;
    WORD.lastIndex = 0;
    const first = new RegExp(WORD.source, 'y');
    first.lastIndex = lead;
    const match = first.exec(line);
    if (match) {
      const entry = weak.get(match[0].toLowerCase());
      if (entry) {
        findings.push({
          kind: 'weak-opener',
          token: match[0],
          occurrences: [
            { line: i, start: starts[i]! + lead, end: starts[i]! + lead + match[0].length },
          ],
          message: `Opens with "${match[0]}": ${entry.why}.`,
          suggestions: entry.try,
        });
      }
    }
    if (!/\d|\bzero\b/i.test(line)) {
      findings.push({
        kind: 'no-number',
        token: line.slice(lead, lead + 40).trim() + (line.length - lead > 40 ? '…' : ''),
        occurrences: [{ line: i, start: starts[i]! + lead, end: starts[i]! + line.length }],
        message: 'No number. Impact without a figure reads as opinion.',
        suggestions: [],
      });
    }
  });

  // Acronyms on neither list, unless the draft spells them out as "(XYZ)".
  for (const acronym of findAcronyms(text, sources.hq, sources.common)) {
    if (acronym.tier !== 'unknown') continue;
    if (/^[IVX]+$/.test(acronym.token)) continue;
    if (text.includes(`(${acronym.token})`)) continue;
    if (compoundIsKnown(acronym.token, sources)) continue;
    const occurrences = occurrencesOf([acronym.token], lines, starts, true);
    if (occurrences.length === 0) continue;
    findings.push({
      kind: 'acronym',
      token: acronym.token,
      occurrences,
      message: `"${acronym.token}" is on neither approved list. Spell it out once or check the list.`,
      suggestions: [],
    });
  }

  return findings.sort(
    (a, b) =>
      a.occurrences[0]!.start - b.occurrences[0]!.start || a.kind.localeCompare(b.kind),
  );
}

export const KIND_LABEL: Record<FindingKind, string> = {
  repeat: 'Repeated',
  'weak-opener': 'Weak opener',
  'no-number': 'No number',
  acronym: 'Acronym',
};
