import { describe, it, expect } from 'vitest';
import { reviewDraft, type Finding } from '@/lib/text/review';
import { STOPWORDS, WEAK_OPENERS } from '@/lib/data/vocab';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';

const sources = {
  stopwords: STOPWORDS.data,
  hq: HQ_APPROVED.data,
  common: COMMON.data,
  weakOpeners: WEAK_OPENERS.data,
};

const review = (text: string) => reviewDraft(text, sources);
const ofKind = (findings: Finding[], kind: Finding['kind']) =>
  findings.filter((f) => f.kind === kind);

describe('reviewDraft', () => {
  it('flags a word used more than once, with every occurrence', () => {
    const text = '- Led 12 airmen; led 3 exercises\n- Drove 4 fixes';
    const repeats = ofKind(review(text), 'repeat');
    expect(repeats).toHaveLength(1);
    expect(repeats[0]!.occurrences).toHaveLength(2);
    expect(repeats[0]!.occurrences[0]).toEqual({ line: 0, start: 2, end: 5 });
    expect(text.slice(repeats[0]!.occurrences[1]!.start, repeats[0]!.occurrences[1]!.end)).toBe('led');
  });

  it('groups inflections and says so', () => {
    const repeats = ofKind(review('- Leads 4 crews; led 2 teams'), 'repeat');
    expect(repeats).toHaveLength(1);
    expect(repeats[0]!.message).toMatch(/^Forms of/);
  });

  it('does not count stopwords as repeats', () => {
    expect(ofKind(review('- Led the team and the flight for 2 yrs'), 'repeat')).toHaveLength(0);
  });

  it('flags a weak opener after the dash and offers alternatives', () => {
    const text = '- Assisted 3 crews with 12 launches';
    const weak = ofKind(review(text), 'weak-opener');
    expect(weak).toHaveLength(1);
    expect(weak[0]!.token).toBe('Assisted');
    expect(weak[0]!.occurrences[0]).toEqual({ line: 0, start: 2, end: 10 });
    expect(weak[0]!.suggestions.length).toBeGreaterThan(0);
  });

  it('reads the first word without a dash and with a double dash', () => {
    expect(ofKind(review('Helped 2 units'), 'weak-opener')).toHaveLength(1);
    expect(ofKind(review('-- Helped 2 units'), 'weak-opener')).toHaveLength(1);
    expect(ofKind(review('- Led 2 units'), 'weak-opener')).toHaveLength(0);
  });

  it('flags a bullet with no number, on its own line', () => {
    const text = '- Led 12 airmen\n- Drove the readiness effort\n\n- Saved zero dollars';
    const none = ofKind(review(text), 'no-number');
    expect(none).toHaveLength(1);
    expect(none[0]!.occurrences[0]!.line).toBe(1);
  });

  it('flags an acronym on neither list, unless the draft spells it out', () => {
    const unknown = ofKind(review('- Ran 4 XQZR sorties; XQZR lead'), 'acronym');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.token).toBe('XQZR');
    expect(unknown[0]!.occurrences).toHaveLength(2);

    expect(
      ofKind(review('- Ran 4 Xylo Quorum Zed Runs (XQZR) sorties; XQZR lead'), 'acronym'),
    ).toHaveLength(0);
  });

  it('accepts a compound whose parts are listed, ignoring office symbols', () => {
    const listed = HQ_APPROVED.data.entries[0]!.abbr;
    expect(ofKind(review(`- Briefed ${listed}/A4 on 3 items`), 'acronym')).toHaveLength(0);
    expect(ofKind(review(`- Briefed ${listed}/XQZR on 3 items`), 'acronym')).toHaveLength(1);
  });

  it('leaves listed acronyms and roman numerals alone', () => {
    const listed = HQ_APPROVED.data.entries[0]!.abbr;
    expect(ofKind(review(`- Led 4 ${listed} teams in Phase II`), 'acronym')).toHaveLength(0);
  });

  it('orders findings by where they sit in the draft', () => {
    const text = '- Assisted 4 crews\n- Drove the effort';
    const starts = review(text).map((f) => f.occurrences[0]!.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('returns nothing for a clean draft', () => {
    expect(review('- Led 12 airmen through 4 exercises; cut 3 findings')).toEqual([]);
  });
});
