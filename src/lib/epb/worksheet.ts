import type { EpbData, EpbSection } from '../data/epb';

/**
 * The EPB Worksheet's arithmetic: how many characters a box holds, how many
 * are left, and what to say about it. The PDF builder carries the same rules
 * in ES5 (`src/lib/pdfform/epb-form.ts`), and the tests hold the two to the
 * same answers.
 *
 * A count is a plain count of characters, spaces and all, after line breaks
 * are made uniform: that is how myEval counts, and a paragraph with a
 * Windows line ending must not read two characters longer than it is.
 */

export type Draft = Record<string, string>;

/** Every box empty, plus the scratch area. */
export function emptyDraft(data: EpbData): Draft {
  const draft: Draft = { workbench: '' };
  for (const s of data.sections) draft[s.id] = '';
  return draft;
}

export function isEmpty(draft: Draft): boolean {
  return Object.values(draft).every((v) => v.trim() === '');
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function countChars(text: string): number {
  return normalizeText(text).length;
}

export interface Count {
  length: number;
  limit: number;
  /** Positive with room to spare, zero at the limit, negative when over. */
  remaining: number;
  /** "12 remaining", "0 remaining" or "3 over": the counter's text. */
  label: string;
  over: boolean;
}

export function count(text: string, limit: number): Count {
  const length = countChars(text);
  const remaining = limit - length;
  return {
    length,
    limit,
    remaining,
    label: remaining >= 0 ? `${remaining} remaining` : `${-remaining} over`,
    over: remaining < 0,
  };
}

/** "0 characters", "1 character", "412 characters": the scratch area's counter. */
export function characterLabel(text: string): string {
  const n = countChars(text);
  return `${n} character${n === 1 ? '' : 's'}`;
}

/** The whole worksheet as plain text, one heading per box, for the clipboard. */
export function worksheetText(data: EpbData, draft: Draft): string {
  const parts: string[] = [];
  for (const s of data.sections) {
    const text = normalizeText(draft[s.id] ?? '').trim();
    if (!text) continue;
    parts.push(`${s.title.toUpperCase()} (${count(text, s.limit).label})\n${text}`);
  }
  return parts.join('\n\n');
}

export function sectionById(data: EpbData, id: string): EpbSection | undefined {
  return data.sections.find((s) => s.id === id);
}
