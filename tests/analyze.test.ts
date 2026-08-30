import { describe, it, expect } from 'vitest';
import { findDuplicates, findAcronyms } from '@/lib/text/analyze';
import {
  normalizeAbbreviations,
  mergeAbbreviations,
  NO_ABBREVIATIONS,
} from '@/lib/data/abbreviations';
import { STOPWORDS } from '@/lib/data/vocab';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import type { DataMeta } from '@/lib/data/types';

const stop = STOPWORDS.data;

describe('findDuplicates', () => {
  it('finds a word used twice, case-insensitively', () => {
    const found = findDuplicates('Training was good. training improved.', stop);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ word: 'training', count: 2, related: false });
  });

  it('ignores stopwords, which repeat harmlessly in any sentence', () => {
    expect(findDuplicates('the team and the shop and the wing', stop)).toEqual([]);
  });

  it('treats inflections as a softer, related warning', () => {
    const found = findDuplicates('Led the team; leads the shop; leading the wing', stop);
    expect(found).toHaveLength(1);
    expect(found[0]!.related).toBe(true);
    expect(found[0]!.forms.sort()).toEqual(['leading', 'leads', 'led'].sort());
  });

  // Suffix stripping alone cannot get from "led" to "lead"; the irregular map
  // is what makes the specified led/leads/leading grouping work.
  it('groups an irregular past tense with its stem', () => {
    const found = findDuplicates('Led the effort and leads it still', stop);
    expect(found).toHaveLength(1);
    expect(found[0]!.related).toBe(true);
  });

  it('keeps a literal repeat separate from an inflected one', () => {
    const literal = findDuplicates('audit audit', stop)[0]!;
    expect(literal.related).toBe(false);
    const inflected = findDuplicates('audit audits', stop)[0]!;
    expect(inflected.related).toBe(true);
  });

  it('ignores very short words and reports nothing for clean text', () => {
    expect(findDuplicates('Rebuilt tool accountability program for the squadron', stop)).toEqual([]);
  });

  it('ranks by frequency', () => {
    const found = findDuplicates('alpha alpha alpha bravo bravo charlie', stop);
    expect(found.map((d) => d.word)).toEqual(['alpha', 'bravo']);
  });
});

describe('findAcronyms', () => {
  const hq = () =>
    normalizeAbbreviations(
      [{ phrase: 'MAJOR COMMAND', abbr: 'MAJCOM' }],
      {} as DataMeta,
      'hq.json',
    );
  const common = () =>
    normalizeAbbreviations([{ phrase: 'Squadron', abbr: 'Sq' }], {} as DataMeta, 'common.json');

  it('classifies into approved, common and unknown', () => {
    const found = findAcronyms('Led MAJCOM effort for Sq with ZZQX support', hq(), common());
    const byToken = Object.fromEntries(found.map((f) => [f.token, f.tier]));
    expect(byToken['MAJCOM']).toBe('hq-approved');
    expect(byToken['ZZQX']).toBe('unknown');
  });

  it('surfaces unknown acronyms first, since those are what need action', () => {
    const found = findAcronyms('MAJCOM ZZQX', hq(), common());
    expect(found[0]!.tier).toBe('unknown');
  });

  it('strips surrounding punctuation but keeps the token', () => {
    const found = findAcronyms('(MAJCOM), MAJCOM; MAJCOM.', hq(), common());
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(3);
  });

  it('does not treat ordinary words or bare numbers as acronyms', () => {
    expect(findAcronyms('Led the team of 340 across 12 shops', hq(), common())).toEqual([]);
  });

  it('carries the expansion when a table knows it', () => {
    const found = findAcronyms('MAJCOM', hq(), common());
    expect(found[0]!.phrase).toBe('MAJOR COMMAND');
  });

  it('recognises real acronyms against the shipped tables', () => {
    const found = findAcronyms('Led AFSC and TDY actions for the MAJCOM', HQ_APPROVED.data, COMMON.data);
    const tiers = Object.fromEntries(found.map((f) => [f.token, f.tier]));
    expect(tiers['AFSC']).toBe('hq-approved');
    expect(tiers['TDY']).toBe('hq-approved');
    expect(tiers['MAJCOM']).toBe('common');
  });
});

/**
 * The two reference lists are switchable, so classification has to follow
 * whichever are on. Switching the AF list off must not silently leave its
 * acronyms looking approved.
 */
describe('reference list toggles', () => {
  const text = 'Led AFSC actions and MAJCOM coordination';

  it('classifies against both lists when both are on', () => {
    const tiers = Object.fromEntries(
      findAcronyms(text, HQ_APPROVED.data, COMMON.data).map((a) => [a.token, a.tier]),
    );
    expect(tiers['AFSC']).toBe('hq-approved');
    expect(tiers['MAJCOM']).toBe('common');
  });

  it('demotes Air Force list entries to unknown when that list is off', () => {
    const tiers = Object.fromEntries(
      findAcronyms(text, NO_ABBREVIATIONS, COMMON.data).map((a) => [a.token, a.tier]),
    );
    expect(tiers['AFSC']).toBe('unknown');
    expect(tiers['MAJCOM']).toBe('common');
  });

  it('demotes common entries to unknown when that list is off', () => {
    const tiers = Object.fromEntries(
      findAcronyms(text, HQ_APPROVED.data, NO_ABBREVIATIONS).map((a) => [a.token, a.tier]),
    );
    expect(tiers['AFSC']).toBe('hq-approved');
    expect(tiers['MAJCOM']).toBe('unknown');
  });

  it('reports everything unknown when both lists are off', () => {
    const found = findAcronyms(text, NO_ABBREVIATIONS, NO_ABBREVIATIONS);
    expect(found.every((a) => a.tier === 'unknown')).toBe(true);
  });

  it('merges enabled lists with the Air Force list winning a collision', () => {
    const merged = mergeAbbreviations([HQ_APPROVED.data, COMMON.data]);
    expect(merged.entries.length).toBeGreaterThan(HQ_APPROVED.data.entries.length);
    // Sorted longest-first, like any table the loader produces.
    const lengths = merged.entries.map((e) => e.phrase.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it('merging nothing yields an empty table rather than throwing', () => {
    expect(mergeAbbreviations([NO_ABBREVIATIONS, NO_ABBREVIATIONS]).entries).toEqual([]);
  });
});
