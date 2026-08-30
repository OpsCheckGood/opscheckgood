import { describe, it, expect } from 'vitest';
import {
  EMPTY_OVERRIDES,
  effectiveTable,
  entryKey,
  fromCsv,
  parseOverrides,
  resolveList,
  shippedEntries,
  toCsv,
  type Overrides,
} from '@/lib/data/abbreviationStore';
import { applyAbbreviations } from '@/lib/data/abbreviations';

const blank = (): Overrides => ({
  hq: { disabled: [], custom: [] },
  common: { disabled: [], custom: [] },
});

describe('resolveList', () => {
  it('returns every shipped entry enabled by default', () => {
    const entries = resolveList('hq', blank());
    expect(entries.length).toBe(shippedEntries('hq').length);
    expect(entries.every((e) => e.enabled)).toBe(true);
    expect(entries.every((e) => !e.custom)).toBe(true);
  });

  it('marks a disabled key off without removing it', () => {
    const target = shippedEntries('hq')[0]!;
    const overrides = blank();
    overrides.hq.disabled.push(entryKey(target));

    const entries = resolveList('hq', overrides);
    expect(entries.length).toBe(shippedEntries('hq').length);
    expect(entries.find((e) => e.key === entryKey(target))!.enabled).toBe(false);
  });

  it('puts the user’s own entries first and flags them', () => {
    const overrides = blank();
    overrides.hq.custom.push({ phrase: 'Wing Weapons Officer', abbr: 'WWO' });
    const entries = resolveList('hq', overrides);
    expect(entries[0]).toMatchObject({ abbr: 'WWO', custom: true, enabled: true });
  });
});

describe('effectiveTable', () => {
  it('drops disabled entries from what the shaper uses', () => {
    const overrides = blank();
    const before = effectiveTable('common', overrides);
    expect(applyAbbreviations('Led the Squadron', before)).toContain('Sq');

    const squadron = shippedEntries('common').find((e) => e.phrase === 'Squadron')!;
    overrides.common.disabled.push(entryKey(squadron));

    const after = effectiveTable('common', overrides);
    expect(applyAbbreviations('Led the Squadron', after)).toBe('Led the Squadron');
  });

  /**
   * The reason this page exists. The shipped Common list maps a platform's
   * name to its designator, so with abbreviation on, any use of the word
   * "Eagle" is rewritten to "F-15". Switching that one entry off has to fix it
   * without disabling the other 194.
   */
  it('lets a single troublesome entry be switched off', () => {
    const overrides = blank();
    const eagle = shippedEntries('common').find((e) => e.phrase === 'Eagle');
    expect(eagle, 'the Eagle -> F-15 entry should be in the shipped list').toBeDefined();

    expect(applyAbbreviations('Eagle team led the Squadron', effectiveTable('common', overrides)))
      .toContain('F-15');

    overrides.common.disabled.push(entryKey(eagle!));
    const after = applyAbbreviations('Eagle team led the Squadron', effectiveTable('common', overrides));
    expect(after).toContain('Eagle');
    // The rest of the list still works.
    expect(after).toContain('Sq');
  });

  it('re-sorts so longest-match-first survives a user adding an entry', () => {
    const overrides = blank();
    overrides.hq.custom.push({ phrase: 'Air', abbr: 'A' });
    const table = effectiveTable('hq', overrides);
    const lengths = table.entries.map((e) => e.phrase.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    // A one-word entry must not pre-empt a longer approved phrase.
    expect(applyAbbreviations('AIR FORCE INSTRUCTION', table)).toBe('AFI');
  });

  it('an empty list yields a table that changes nothing', () => {
    const overrides = blank();
    overrides.common.disabled = shippedEntries('common').map(entryKey);
    const table = effectiveTable('common', overrides);
    expect(table.entries).toEqual([]);
    expect(applyAbbreviations('Led the Squadron', table)).toBe('Led the Squadron');
  });
});

describe('parseOverrides', () => {
  it('falls back to defaults for absent or corrupt storage', () => {
    expect(parseOverrides(null)).toEqual(EMPTY_OVERRIDES);
    expect(parseOverrides('not json')).toEqual(EMPTY_OVERRIDES);
    expect(parseOverrides('{"hq":42}')).toEqual(EMPTY_OVERRIDES);
  });

  it('ignores malformed custom entries rather than trusting them', () => {
    const parsed = parseOverrides(
      JSON.stringify({ hq: { disabled: ['a', 7], custom: [{ phrase: 'X' }, { phrase: 'Y', abbr: 'Z' }] } }),
    );
    expect(parsed.hq.disabled).toEqual(['a']);
    expect(parsed.hq.custom).toEqual([{ phrase: 'Y', abbr: 'Z' }]);
  });

  it('round-trips a real override', () => {
    const overrides = blank();
    overrides.common.disabled.push('squadron=>Sq');
    overrides.common.custom.push({ phrase: 'Test Phrase', abbr: 'TP' });
    expect(parseOverrides(JSON.stringify(overrides))).toEqual(overrides);
  });
});

describe('CSV', () => {
  it('round-trips entries including their enabled state', () => {
    const overrides = blank();
    overrides.hq.disabled.push(entryKey(shippedEntries('hq')[0]!));
    const entries = resolveList('hq', overrides);

    const parsed = fromCsv(toCsv(entries));
    expect(parsed.skipped).toBe(0);
    expect(parsed.entries.length).toBe(entries.length);
    expect(parsed.entries[0]!.enabled).toBe(entries[0]!.enabled);
  });

  it('quotes and unquotes a phrase containing a comma', () => {
    const csv = toCsv([
      { phrase: 'Command, Control', abbr: 'C2', key: 'k', enabled: true, custom: true },
    ]);
    expect(csv).toContain('"Command, Control"');
    expect(fromCsv(csv).entries[0]).toMatchObject({ phrase: 'Command, Control', abbr: 'C2' });
  });

  it('accepts a bare two-column list typed by hand', () => {
    const parsed = fromCsv('Squadron,Sq\nMajor Command,MAJCOM');
    expect(parsed.entries).toEqual([
      { phrase: 'Squadron', abbr: 'Sq', enabled: true },
      { phrase: 'Major Command', abbr: 'MAJCOM', enabled: true },
    ]);
  });

  it('skips a header row in either format', () => {
    expect(fromCsv('enabled,phrase,abbreviation\nTRUE,Squadron,Sq').entries).toHaveLength(1);
    expect(fromCsv('phrase,abbreviation\nSquadron,Sq').entries).toHaveLength(1);
  });

  it('counts unreadable rows instead of dropping them silently', () => {
    const parsed = fromCsv('Squadron,Sq\nnonsense\n,\nMajor Command,MAJCOM');
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.skipped).toBe(2);
  });

  it('reads FALSE, 0, no and off as disabled', () => {
    for (const flag of ['FALSE', 'false', '0', 'no', 'off']) {
      expect(fromCsv(`${flag},Squadron,Sq`).entries[0]!.enabled).toBe(false);
    }
    expect(fromCsv('TRUE,Squadron,Sq').entries[0]!.enabled).toBe(true);
  });
});
