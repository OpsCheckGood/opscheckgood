import { describe, it, expect } from 'vitest';
import {
  normalizeAbbreviations,
  applyAbbreviations,
  lookupAbbreviation,
} from '@/lib/data/abbreviations';
import type { DataMeta } from '@/lib/data/types';

const META = {} as DataMeta;
const build = (entries: { phrase: string; abbr: string }[]) =>
  normalizeAbbreviations(entries, META, 'test-fixture.json');

/**
 * The ordering hazard, straight from the AF-VCD/pdf-bullets README: with the
 * single-word rules matching first, "United States Air Force Academy" collapses
 * to "USAF Academy" instead of "USAFA".
 */
const ENTRIES = [
  { phrase: 'Air Force', abbr: 'AF' },
  { phrase: 'United States Air Force Academy', abbr: 'USAFA' },
  { phrase: 'Academy', abbr: 'Acad' },
  { phrase: 'Squadron', abbr: 'Sq' },
  { phrase: 'United States', abbr: 'US' },
  { phrase: 'United States Air Force', abbr: 'USAF' },
];

describe('abbreviation loader', () => {
  it('sorts descending by phrase length regardless of file order', () => {
    const table = build(ENTRIES);
    const lengths = table.entries.map((e) => e.phrase.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(table.entries[0]!.phrase).toBe('United States Air Force Academy');
  });

  it('produces identical output from a deliberately scrambled file', () => {
    const scrambled = [...ENTRIES].sort((a, b) => a.phrase.length - b.phrase.length);
    expect(scrambled[0]!.phrase).toBe('Academy'); // worst-case order

    const fromScrambled = build(scrambled);
    const fromOriginal = build(ENTRIES);

    expect(fromScrambled.entries).toEqual(fromOriginal.entries);
    const input = 'Assigned to the United States Air Force Academy Squadron';
    expect(applyAbbreviations(input, fromScrambled)).toBe(
      applyAbbreviations(input, fromOriginal),
    );
  });

  it('collapses internal whitespace in phrases', () => {
    const table = build([{ phrase: '  Air   Force  ', abbr: 'AF' }]);
    expect(table.entries[0]!.phrase).toBe('Air Force');
  });

  it('rejects malformed entries by naming the file', () => {
    expect(() => build([{ phrase: '', abbr: 'X' }])).toThrow(/empty phrase/);
    expect(() =>
      normalizeAbbreviations([{ nope: 1 }], META, 'bad.json'),
    ).toThrow(/bad\.json/);
  });
});

describe('applyAbbreviations', () => {
  const table = build(ENTRIES);

  it('lets the longest match win over shorter overlapping ones', () => {
    expect(applyAbbreviations('United States Air Force Academy', table)).toBe('USAFA');
    expect(applyAbbreviations('United States Air Force', table)).toBe('USAF');
    expect(applyAbbreviations('United States', table)).toBe('US');
    expect(applyAbbreviations('Air Force', table)).toBe('AF');
  });

  it('is idempotent', () => {
    const input = 'Led the United States Air Force Academy Squadron through Air Force review';
    const once = applyAbbreviations(input, table);
    expect(applyAbbreviations(once, table)).toBe(once);
    expect(once).toContain('USAFA');
    expect(once).toContain('Sq');
  });

  it('matches case-insensitively and emits the canonical abbreviation', () => {
    expect(applyAbbreviations('UNITED STATES AIR FORCE ACADEMY', table)).toBe('USAFA');
    expect(applyAbbreviations('air force', table)).toBe('AF');
  });

  it('matches across irregular whitespace', () => {
    expect(applyAbbreviations('Air   Force', table)).toBe('AF');
  });

  it('does not match inside a longer word', () => {
    expect(applyAbbreviations('Squadrons deployed', table)).toBe('Squadrons deployed');
    expect(applyAbbreviations('Academic year', table)).toBe('Academic year');
  });

  it('leaves surrounding text and punctuation intact', () => {
    expect(applyAbbreviations('Led Squadron; drove results', table)).toBe(
      'Led Sq; drove results',
    );
  });

  it('returns the text unchanged for an empty table', () => {
    const empty = build([]);
    expect(applyAbbreviations('Air Force', empty)).toBe('Air Force');
  });
});

describe('lookupAbbreviation', () => {
  const table = build(ENTRIES);
  it('finds a single word regardless of case', () => {
    expect(lookupAbbreviation('Squadron', table)).toBe('Sq');
    expect(lookupAbbreviation('squadron', table)).toBe('Sq');
  });
  it('returns null when there is no entry', () => {
    expect(lookupAbbreviation('Wing', table)).toBeNull();
  });
});
