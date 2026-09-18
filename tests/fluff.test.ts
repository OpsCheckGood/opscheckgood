import { describe, it, expect } from 'vitest';
import { patrol, tally, type PatrolFinding } from '@/lib/text/fluff';
import { FLUFF, IRREGULAR_PAST, WEAK_OPENERS } from '@/lib/data/vocab';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';

const sources = {
  fluff: FLUFF.data,
  hq: HQ_APPROVED.data,
  common: COMMON.data,
  weakOpeners: WEAK_OPENERS.data,
  irregularPast: IRREGULAR_PAST.data,
};

const run = (text: string) => patrol(text, sources);
const tokens = (findings: PatrolFinding[], category?: string) =>
  findings.filter((f) => !category || f.category === category).map((f) => f.token.toLowerCase());

describe('fluff dictionary', () => {
  // Acceptance criterion 13.1.
  it('flags successfully, supported and numerous with category-specific guidance', () => {
    const { findings } = run('- Successfully supported numerous projects');
    const fluff = findings.filter((f) => f.kind === 'fluff');
    expect(tokens(fluff)).toEqual(expect.arrayContaining(['successfully', 'supported', 'numerous']));
    const byToken = new Map(fluff.map((f) => [f.token.toLowerCase(), f]));
    expect(byToken.get('successfully')!.category).toBe('generic-success');
    expect(byToken.get('supported')!.category).toBe('weak-contribution');
    expect(byToken.get('numerous')!.category).toBe('empty-qualifier');
    for (const f of fluff) {
      expect(f.ask.length).toBeGreaterThan(10);
      expect(f.why.length).toBeGreaterThan(10);
    }
  });

  it('matches phrases as one finding, longest first', () => {
    const { findings } = run('- Participated in 3 exercises in order to qualify');
    const fluff = findings.filter((f) => f.kind === 'fluff');
    expect(tokens(fluff)).toContain('participated in');
    expect(tokens(fluff)).not.toContain('participated');
    expect(tokens(fluff)).toContain('in order to');
    expect(fluff.find((f) => f.token === 'in order to')!.try).toEqual(['to']);
  });

  it('matches capitalisation variants and reports the text as typed', () => {
    const { findings } = run('- VERY Effectively led 4 crews');
    expect(findings.map((f) => f.token)).toEqual(expect.arrayContaining(['VERY', 'Effectively']));
  });

  it('does not flag a term inside a longer word', () => {
    const { findings } = run('- Keyed 40 alarms; rekeyed 12 locks');
    expect(tokens(findings, 'unsupported-superlative')).toEqual([]);
  });

  it('flags duty language and asks what changed', () => {
    const { findings } = run('- Responsible for 12 vehicles');
    const duty = findings.find((f) => f.category === 'duty-language')!;
    expect(duty.token).toBe('Responsible for');
    expect(duty.ask).toMatch(/beyond the assigned duty/);
  });

  it('ranks superlatives high and transitions low', () => {
    const { findings } = run('- Flawless launch; additionally led 3 crews');
    expect(findings.find((f) => f.token === 'Flawless')!.severity).toBe('high');
    expect(findings.find((f) => f.token === 'additionally')!.severity).toBe('low');
    expect(findings[0]!.severity).toBe('high');
  });

  it('carries offsets that point at the text', () => {
    const text = '- Led 4 crews\n- Very good';
    const { findings } = run(text);
    const very = findings.find((f) => f.token === 'Very')!;
    expect(very.line).toBe(1);
    expect(text.slice(very.start, very.end)).toBe('Very');
  });

  it('keys a finding by term and line so an edit elsewhere keeps a dismissal', () => {
    const a = run('- Very good\n- Led 3').findings.find((f) => f.token === 'Very')!;
    const b = run('- Very good\n- Led 3 crews on 5 sorties').findings.find((f) => f.token === 'Very')!;
    expect(a.key).toBe(b.key);
  });
});

describe('Action-Result-Impact-Scope', () => {
  it('detects all four on a complete statement', () => {
    const { lines } = run('- Repaired 14 faulty test sets for 3 squadrons; restored maintenance capability');
    expect(lines).toHaveLength(1);
    const l = lines[0]!;
    expect(l.action).toBe('detected');
    expect(l.evidence.action).toBe('Repaired');
    expect(l.result).toBe('detected');
    expect(l.evidence.result).toBe('14');
    expect(l.impact).toBe('detected');
    expect(l.evidence.impact).toMatch(/maintenance capability/i);
    expect(l.scope).toBe('detected');
    expect(l.evidence.scope).toMatch(/3 squadrons/);
  });

  it('reads an irregular past as an action and a weak opener as not one', () => {
    expect(run('- Led 4 crews').lines[0]!.action).toBe('detected');
    expect(run('- Drove 4 fixes').lines[0]!.action).toBe('detected');
    expect(run('- Assisted 4 crews').lines[0]!.action).toBe('possibly-missing');
    expect(run('- Outstanding NCO').lines[0]!.action).toBe('possibly-missing');
  });

  it('marks what is possibly missing without requiring all four', () => {
    const l = run('- Organized the holiday party').lines[0]!;
    expect(l.action).toBe('detected');
    expect(l.result).toBe('possibly-missing');
    expect(l.impact).toBe('possibly-missing');
    expect(l.scope).toBe('possibly-missing');
  });

  it('skips blank lines', () => {
    expect(run('- Led 4 crews\n\n- Drove 2 fixes').lines.map((l) => l.line)).toEqual([0, 2]);
  });
});

describe('number style', () => {
  it('asks what a bare number counts', () => {
    const { findings } = run('- Processed 450; cleared backlog');
    const bare = findings.find((f) => f.category === 'bare-number')!;
    expect(bare.token).toBe('450');
    expect(bare.ask).toMatch(/450 of what/);
    // A number with a noun after it is fine.
    expect(run('- Processed 450 records').findings.some((f) => f.category === 'bare-number')).toBe(false);
    // And so is a percentage or a dollar figure.
    expect(run('- Cut errors 40%').findings.some((f) => f.category === 'bare-number')).toBe(false);
    expect(run('- Saved $4,500').findings.some((f) => f.category === 'bare-number')).toBe(false);
  });

  it('flags a number glued to its unit and suggests the spacing', () => {
    const f = run('- Cut turnaround to 24hrs').findings.find((x) => x.category === 'unit-spacing')!;
    expect(f.token).toBe('24hrs');
    expect(f.ask).toContain('"24 hrs"');
  });

  it('flags mixed currency styles across the draft', () => {
    const { findings } = run('- Saved $120000\n- Avoided 125K');
    expect(findings.some((f) => f.category === 'currency-separators' && f.token === '$120000')).toBe(true);
    const mixed = findings.find((f) => f.category === 'currency-style')!;
    expect(mixed.token).toBe('125K');
    expect(mixed.line).toBe(1);
  });

  it('flags mixed percent styles across the draft', () => {
    const { findings } = run('- Reduced delays by 30 percent\n- Improved 15%');
    expect(findings.some((f) => f.category === 'percent-style')).toBe(true);
    expect(run('- Reduced delays 30%\n- Improved 15%').findings.some((f) => f.category === 'percent-style')).toBe(false);
  });

  it('flags doubled symbols', () => {
    expect(run('- Saved $$4K').findings.some((f) => f.category === 'doubled-symbol')).toBe(true);
  });
});

describe('readability', () => {
  it('counts acronyms and flags a dense statement', () => {
    const { findings, lines } = run('- Led TCTO, PMEL, QA, MXG and OG reviews');
    expect(lines[0]!.acronyms).toBeGreaterThanOrEqual(4);
    const f = findings.find((x) => x.category === 'acronym-density')!;
    expect(f.ask).toMatch(/contains \d acronyms/);
  });

  it('flags stacked semicolons at the threshold', () => {
    expect(run('- a; b; c; d').findings.some((f) => f.category === 'semicolons')).toBe(true);
    expect(run('- a; b; c').findings.some((f) => f.category === 'semicolons')).toBe(false);
  });

  it('flags a long statement', () => {
    const long = '- ' + Array.from({ length: 36 }, (_, i) => `word${i}`).join(' ');
    expect(run(long).findings.some((f) => f.category === 'long-sentence')).toBe(true);
  });

  it('flags passive voice as a heuristic', () => {
    const f = run('- Was selected by the commander for 2 awards').findings.find((x) => x.category === 'passive')!;
    expect(f.why).toMatch(/heuristic/);
    expect(run('- Selected by the commander').findings.some((x) => x.category === 'passive')).toBe(false);
  });
});

describe('bullets', () => {
  it('reads a bullet from its dash to the next one, continuation lines included', () => {
    const text = '- Led 4 crews through 12 sorties\nrestoring readiness for the wing\n- Very good work';
    const { lines, findings } = run(text);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ bullet: 1, line: 0, lastLine: 1 });
    expect(lines[0]!.impact).toBe('detected');
    expect(lines[0]!.evidence.impact).toBe('readiness');
    expect(lines[1]).toMatchObject({ bullet: 2, line: 2, lastLine: 2 });
    const very = findings.find((f) => f.token === 'Very')!;
    expect(very.bullet).toBe(2);
    expect(very.line).toBe(2);
    expect(text.slice(very.start, very.end)).toBe('Very');
  });

  it('puts a finding on a continuation line on that line, inside its bullet', () => {
    const text = '- Led 4 crews\nwith numerous partners';
    const f = run(text).findings.find((x) => x.token === 'numerous')!;
    expect(f.bullet).toBe(1);
    expect(f.line).toBe(1);
    expect(text.slice(f.start, f.end)).toBe('numerous');
  });

  it('matches a phrase across the line break inside a bullet', () => {
    const text = '- Led 4 crews in\norder to qualify';
    expect(run(text).findings.some((f) => f.category === 'redundant-phrasing')).toBe(true);
  });

  it('counts words and semicolons over the whole bullet', () => {
    const text = '- a; b; c\nd; e';
    expect(run(text).findings.some((f) => f.category === 'semicolons')).toBe(true);
  });

  it('treats a draft with no dashes as one statement per line', () => {
    expect(run('Led 4 crews\nDrove 2 fixes').lines).toHaveLength(2);
  });

  it('ends a bullet at a blank line', () => {
    expect(run('- Led 4 crews\n\nloose line').lines).toHaveLength(2);
  });
});

describe('report', () => {
  it('tallies by severity and sorts high first', () => {
    const { findings } = run('- Flawless, very good, additionally fine');
    const counts = tally(findings);
    expect(counts.high).toBe(1);
    expect(counts.medium).toBeGreaterThanOrEqual(1);
    expect(counts.low).toBeGreaterThanOrEqual(1);
    expect(findings.map((f) => f.severity)).toEqual(
      [...findings.map((f) => f.severity)].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]),
    );
  });

  it('never modifies the text and returns nothing for an empty draft', () => {
    expect(run('')).toEqual({ findings: [], lines: [] });
  });
});
