import { describe, it, expect } from 'vitest';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';
import {
  assembleCitation,
  closingSentence,
  formatCitationDate,
  guessSurname,
  openingSentence,
  reviewCitation,
  type CitationInput,
} from '@/lib/decoration/citation';
import { wrapMonospace } from '@/lib/decoration/fit';

const language = CITATION_LANGUAGE.data;

const ponde: CitationInput = {
  awardId: 'ascom',
  serviceId: 'usaf',
  basisId: 'service',
  closingId: 'standard',
  longCareer: false,
  gradeId: 'tsgt',
  name: 'Ami Ponde',
  surname: 'Ponde',
  pronounId: 'she',
  assignmentId: 'as',
  duty: 'Flight Chief',
  unit: '1st Maintenance Squadron',
  location: 'Joint Base Langley-Eustis, Virginia',
  periodId: 'range',
  start: '2024-01-01',
  end: '2025-12-31',
  date: '',
};

describe('the datasets', () => {
  it('load, and are honest about being stubs', () => {
    expect(CERTIFICATE.isStub).toBe(true);
    expect(CITATION_LANGUAGE.isStub).toBe(true);
    expect(CERTIFICATE.data.maxChars).toBe(1350);
    expect(CERTIFICATE.data.box.lines).toBe(20);
    expect(CERTIFICATE.data.font.file).toBe('/fonts/LiberationMono-Regular.ttf');
  });

  it('gives every award at least one basis and a standard closing', () => {
    for (const award of language.awards) {
      expect(award.bases.length, award.id).toBeGreaterThan(0);
      expect(award.closings.some((c) => c.id === 'standard'), award.id).toBe(true);
      expect(award.ref).toMatch(/^A5\.2\.\d+$/);
    }
  });

  it('uses only placeholders the builder fills', () => {
    const known = new Set([
      'rank', 'name', 'reflexive', 'basis', 'assignment', 'period', 'place',
      'start', 'end', 'date', 'shortRank', 'surname', 'possessive', 'service', 'longAnd',
    ]);
    const texts = [
      language.opening.pattern,
      ...language.opening.assignments.map((a) => a.text),
      ...language.opening.periods.map((p) => p.text),
      ...language.awards.flatMap((a) => [...a.bases, ...a.closings].map((p) => p.text)),
    ];
    for (const text of texts) {
      for (const [, key] of text.matchAll(/\{(\w+)\}/g)) {
        expect(known.has(key!), `{${key}} in "${text}"`).toBe(true);
      }
    }
  });
});

describe('formatCitationDate', () => {
  it('spells the month and drops the leading zero', () => {
    expect(formatCitationDate('2024-01-01')).toBe('1 January 2024');
    expect(formatCitationDate('2025-12-31')).toBe('31 December 2025');
  });
  it('gives nothing for nothing', () => {
    expect(formatCitationDate('')).toBe('');
    expect(formatCitationDate('2024-13-01')).toBe('');
  });
});

describe('guessSurname', () => {
  it('takes the last word, skipping a suffix', () => {
    expect(guessSurname('Ami Ponde')).toBe('Ponde');
    expect(guessSurname('John Q. Public Jr.')).toBe('Public');
    expect(guessSurname('Robert Smith III')).toBe('Smith');
    expect(guessSurname('')).toBe('');
  });
});

describe('the sentences', () => {
  it('builds the Commendation Medal opening as A5.2.10.1.1 has it', () => {
    expect(openingSentence(ponde, language)).toBe(
      'Technical Sergeant Ami Ponde distinguished herself by meritorious service as Flight Chief, ' +
        '1st Maintenance Squadron, Joint Base Langley-Eustis, Virginia, from 1 January 2024 to 31 December 2025.',
    );
  });

  it('builds the Commendation Medal closing as A5.2.10.3.1 has it', () => {
    expect(closingSentence(ponde, language)).toBe(
      'The distinctive accomplishments of Sergeant Ponde reflect credit upon herself and the United States Air Force.',
    );
  });

  it('builds the MSM opening and the retirement closing, with and without "long and"', () => {
    const smith: CitationInput = {
      ...ponde,
      awardId: 'msm',
      basisId: 'service',
      closingId: 'retirement',
      gradeId: 'smsgt',
      name: 'Mickey Smith',
      surname: 'Smith',
      pronounId: 'he',
      assignmentId: 'while',
      unit: 'the 1st Special Operations Wing',
      location: 'Hurlburt Field, Florida',
    };
    expect(openingSentence(smith, language)).toBe(
      'Senior Master Sergeant Mickey Smith distinguished himself in the performance of outstanding ' +
        'service to the United States while assigned to the 1st Special Operations Wing, Hurlburt Field, ' +
        'Florida, from 1 January 2024 to 31 December 2025.',
    );
    expect(closingSentence(smith, language)).toBe(
      'The singularly distinctive accomplishments of Sergeant Smith culminate a distinguished career in the ' +
        'service of his country and reflect great credit upon himself and the United States Air Force.',
    );
    expect(closingSentence({ ...smith, longCareer: true }, language)).toContain('a long and distinguished career');
  });

  it('handles the single-date and no-date forms', () => {
    const on = openingSentence({ ...ponde, basisId: 'heroism', assignmentId: 'near', location: 'Hampton, Virginia', periodId: 'on', date: '2025-03-09' }, language);
    expect(on).toBe('Technical Sergeant Ami Ponde distinguished herself by an act of heroism at or near Hampton, Virginia on 9 March 2025.');
    const none = openingSentence({ ...ponde, periodId: 'none' }, language);
    expect(none.endsWith('Virginia.')).toBe(true);
  });

  it('drops empty parts rather than leaving stray commas', () => {
    const bare = openingSentence({ ...ponde, duty: '', unit: '', location: 'Nellis Air Force Base, Nevada' }, language);
    expect(bare).toContain('as Nellis Air Force Base, Nevada, from');
    expect(bare).not.toContain(', ,');
  });

  it('uses the Space Force name when asked', () => {
    expect(closingSentence({ ...ponde, serviceId: 'ussf' }, language)).toContain('United States Space Force.');
  });

  it('assembles one paragraph with single spaces', () => {
    expect(assembleCitation('A.', '  B.  ', 'C.')).toBe('A. B. C.');
    expect(assembleCitation('A.', '', 'C.')).toBe('A. C.');
  });
});

describe('reviewCitation', () => {
  function review(text: string, columns = 74, input: CitationInput = ponde) {
    return reviewCitation(text, wrapMonospace(text, columns), input, language);
  }

  it('flags nothing on a clean citation', () => {
    const text = assembleCitation(
      openingSentence(ponde, language),
      'During this period, Sergeant Ponde led the flight through two inspections.',
      closingSentence(ponde, language),
    );
    expect(review(text)).toEqual([]);
  });

  it('flags a name split across a line break', () => {
    // 20 columns puts "Sergeant" at the end of one line and "Ponde" on the next.
    const text = 'xxxxxxxxxxx Sergeant Ponde led';
    const warnings = review(text, 20);
    expect(wrapMonospace(text, 20)).toEqual(['xxxxxxxxxxx Sergeant', 'Ponde led']);
    expect(warnings.some((w) => w.ref === 'A5.1.6' && w.text.includes('Sergeant Ponde'))).toBe(true);
  });

  it('flags the inclusive period split across lines', () => {
    const text = 'xxxxxxx from 1 January 2024 to 31 December 2025 yyy';
    const warnings = review(text, 30);
    expect(warnings.some((w) => w.ref === 'A5.1.4')).toBe(true);
  });

  it('flags small numerals, capitals and odd characters', () => {
    const warnings = review('Led 3 Airmen at USAF HQ — “quoted”.');
    expect(warnings.some((w) => w.ref === 'A5.1.10' && w.text.includes('3'))).toBe(true);
    expect(warnings.some((w) => w.ref === 'A5.1.14' && w.text.includes('USAF'))).toBe(true);
    expect(warnings.some((w) => w.ref === null && w.text.includes('“'))).toBe(true);
  });

  it('leaves larger numbers, money and percentages alone', () => {
    const warnings = review('Saved $4 million, 12 aircraft and 8% of the budget.');
    expect(warnings.some((w) => w.ref === 'A5.1.10')).toBe(false);
  });
});
