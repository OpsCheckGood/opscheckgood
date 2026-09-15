import { describe, it, expect } from 'vitest';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';
import {
  assembleCitation,
  certificateText,
  closingSentence,
  clusterLine,
  formatCitationDate,
  guessSurname,
  memberLine,
  openingSentence,
  periodLine,
  reviewCitation,
  type CitationInput,
} from '@/lib/decoration/citation';
import { wrapMonospace } from '@/lib/decoration/fit';

const language = CITATION_LANGUAGE.data;
const certificate = CERTIFICATE.data;

const ponde: CitationInput = {
  awardId: 'ascom',
  serviceId: 'usaf',
  basisId: 'service',
  circumstanceId: '',
  closingId: 'standard',
  longCareer: false,
  awardNumber: 1,
  gradeId: 'tsgt',
  name: 'Ami Ponde',
  surname: 'Ponde',
  pronounId: 'she',
  assignmentId: 'as',
  duty: 'Flight Chief',
  squadron: '1st Maintenance Squadron',
  group: '',
  wing: '',
  base: 'Joint Base Langley-Eustis, Virginia',
  periodId: 'range',
  start: '2024-01-01',
  end: '2025-12-31',
  date: '',
  periodInOpening: true,
  approver: 'JANE Q. PUBLIC, Lt Col, USAF',
  approverTitle: 'Commander, 1st Maintenance Squadron',
  signedDate: '2026-07-31',
};

describe('the datasets', () => {
  it('load: the certificate verified off printed certificates, the wording still a stub', () => {
    expect(CERTIFICATE.isStub).toBe(false);
    expect(CITATION_LANGUAGE.isStub).toBe(true);
    expect(certificate.maxChars).toBe(1350);
    expect(certificate.box.columns).toBe(70);
    expect(certificate.box.lines).toBe(20);
    expect(certificate.box.justified).toBe(true);
    expect(certificate.font.file).toBe('/fonts/LiberationMono-Regular.ttf');
    expect(certificate.page?.headers.daf.lines.length).toBeGreaterThan(5);
    expect(certificate.page?.headers.presidential.lines.length).toBeGreaterThan(5);
  });

  it('covers every decoration Attachment 5 gives a citation for', () => {
    const refs = language.awards.map((a) => a.ref).sort();
    // A5.2.6 is the Purple Heart, which has no citation.
    expect(refs).toEqual(
      ['A5.2.1', 'A5.2.2', 'A5.2.3', 'A5.2.4', 'A5.2.5', 'A5.2.7', 'A5.2.8', 'A5.2.9', 'A5.2.10', 'A5.2.11'].sort(),
    );
  });

  it('gives every award at least one basis, a standard closing and a certificate title', () => {
    for (const award of language.awards) {
      expect(award.bases.length, award.id).toBeGreaterThan(0);
      expect(award.closings.some((c) => c.id === 'standard'), award.id).toBe(true);
      expect(award.ref).toMatch(/^A5\.2\.\d+$/);
      expect(award.certificate.title, award.id).toMatch(/^THE /);
    }
  });

  it('uses only placeholders the builder fills', () => {
    const known = new Set([
      'rank', 'name', 'reflexive', 'basis', 'assignment', 'circumstance', 'period', 'place',
      'start', 'end', 'date', 'shortRank', 'surname', 'possessive', 'service', 'longAnd',
    ]);
    const texts = [
      language.opening.pattern,
      ...language.opening.assignments.map((a) => a.text),
      ...language.opening.periods.map((p) => p.text),
      ...language.awards.flatMap((a) => [
        ...(a.pattern ? [a.pattern] : []),
        ...[...a.bases, ...a.circumstances, ...a.closings].map((p) => p.text),
      ]),
    ];
    for (const text of texts) {
      for (const [, key] of text.matchAll(/\{(\w+)\}/g)) {
        expect(known.has(key!), `{${key}} in "${text}"`).toBe(true);
      }
    }
  });

  it('only "singularly" and "great credit" where the manual has them', () => {
    const standard = (id: string) => language.awards.find((a) => a.id === id)!.closings[0]!.text;
    expect(standard('asam')).not.toContain('singularly');
    expect(standard('ascom')).not.toContain('singularly');
    expect(standard('asam')).toContain('reflect credit upon');
    expect(standard('msm')).toContain('singularly distinctive');
    expect(standard('msm')).toContain('great credit');
    expect(standard('dsm')).toContain('the highest credit');
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

  it('keeps the dates out of the opening by default, the way myDecs prints it', () => {
    const printed = openingSentence({ ...ponde, periodInOpening: false }, language);
    expect(printed).toBe(
      'Technical Sergeant Ami Ponde distinguished herself by meritorious service as Flight Chief, ' +
        '1st Maintenance Squadron, Joint Base Langley-Eustis, Virginia.',
    );
    // The header still carries them.
    expect(periodLine({ ...ponde, periodInOpening: false })).toBe('1 January 2024 to 31 December 2025');
  });

  it('prints the chain the certificate does: squadron, group, wing, base', () => {
    const chain = openingSentence(
      { ...ponde, duty: 'a Hydraulics Journeyman', squadron: '82d Reconnaissance Squadron', group: '55th Operations Group', wing: '55th Wing', base: 'Kadena Air Base, Japan' },
      language,
    );
    expect(chain).toContain(
      'as a Hydraulics Journeyman, 82d Reconnaissance Squadron, 55th Operations Group, 55th Wing, Kadena Air Base, Japan,',
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
      squadron: '',
      wing: 'the 1st Special Operations Wing',
      base: 'Hurlburt Field, Florida',
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

  it('builds the Distinguished Service Medal opening from its own pattern', () => {
    const rose: CitationInput = {
      ...ponde,
      awardId: 'dsm',
      basisId: 'responsibility',
      closingId: 'standard',
      gradeId: 'ltgen',
      name: 'Aurora Rose',
      surname: 'Rose',
      duty: 'Commander, United States Forces Japan',
      squadron: '',
      base: '',
    };
    expect(openingSentence(rose, language)).toBe(
      'The President of the United States of America, authorized by Act of Congress July 9, 1918, awards ' +
        'the Distinguished Service Medal to Lieutenant General Aurora Rose for exceptionally meritorious ' +
        'service in a duty of great responsibility. General Rose distinguished herself as Commander, ' +
        'United States Forces Japan, from 1 January 2024 to 31 December 2025.',
    );
    expect(closingSentence(rose, language)).toContain('reflect the highest credit upon herself');
  });

  it('adds the Bronze Star engagement clause after the assignment', () => {
    const tyler = openingSentence(
      { ...ponde, awardId: 'bsm', basisId: 'service', circumstanceId: 'enemy', name: 'Rose A. Tyler', surname: 'Tyler', gradeId: 'msgt' },
      language,
    );
    expect(tyler).toContain(
      'by meritorious service as Flight Chief, 1st Maintenance Squadron, Joint Base Langley-Eustis, Virginia ' +
        'while engaged in action against an enemy of the United States, from 1 January 2024',
    );
  });

  it('offers the Air National Guard closing of A5.1.5 at the decoration\'s level of credit', () => {
    expect(closingSentence({ ...ponde, closingId: 'guard' }, language)).toBe(
      'The singularly distinctive accomplishments of Sergeant Ponde reflect credit on herself, the Air National Guard, and the U.S. Air Force.',
    );
    expect(closingSentence({ ...ponde, awardId: 'msm', closingId: 'guard' }, language)).toContain('great credit on herself, the Air National Guard');
  });

  it('handles the single-date and no-date forms', () => {
    const on = openingSentence({ ...ponde, basisId: 'heroism', assignmentId: 'near', base: 'Hampton, Virginia', periodId: 'on', date: '2025-03-09' }, language);
    expect(on).toBe('Technical Sergeant Ami Ponde distinguished herself by an act of heroism at or near Hampton, Virginia on 9 March 2025.');
    const none = openingSentence({ ...ponde, periodId: 'none' }, language);
    expect(none.endsWith('Virginia.')).toBe(true);
  });

  it('drops empty parts rather than leaving stray commas', () => {
    const bare = openingSentence({ ...ponde, duty: '', squadron: '', base: 'Nellis Air Force Base, Nevada' }, language);
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

describe('the certificate lines', () => {
  it('names the oak leaf cluster the way the certificate prints it', () => {
    const clusters = certificate.page!.clusters;
    expect(clusterLine(1, clusters)).toBe('');
    expect(clusterLine(2, clusters)).toBe('(FIRST OAK LEAF CLUSTER)');
    expect(clusterLine(4, clusters)).toBe('(THIRD OAK LEAF CLUSTER)');
  });

  it('prints the member in capitals with the full grade and no period on an initial', () => {
    expect(memberLine({ ...ponde, gradeId: 'ssgt', name: 'Quinn H. Brenner' }, language)).toBe(
      'STAFF SERGEANT QUINN H BRENNER',
    );
  });

  it('prints the period line as the certificate does', () => {
    expect(periodLine(ponde)).toBe('1 January 2024 to 31 December 2025');
    expect(periodLine({ ...ponde, periodId: 'on', date: '2025-03-09' })).toBe('9 March 2025');
    expect(periodLine({ ...ponde, periodId: 'none' })).toBe('');
  });

  it('fills the Department of the Air Force header for the Commendation Medal', () => {
    const page = certificateText({ ...ponde, awardNumber: 2 }, language, certificate)!;
    expect(page.style).toBe('daf');
    const texts = page.header.map((l) => l.text);
    expect(texts).toEqual([
      'DEPARTMENT OF THE AIR FORCE',
      'THIS IS TO CERTIFY THAT',
      'THE AIR AND SPACE COMMENDATION MEDAL',
      '(FIRST OAK LEAF CLUSTER)',
      'HAS BEEN AWARDED TO',
      'TECHNICAL SERGEANT AMI PONDE',
      'FOR',
      'MERITORIOUS SERVICE',
      '1 January 2024 to 31 December 2025',
      'ACCOMPLISHMENTS',
    ]);
    expect(page.closing.map((l) => l.text)).toEqual(['GIVEN UNDER MY HAND', '31 July 2026']);
    expect(page.signature).toEqual(['JANE Q. PUBLIC, Lt Col, USAF', 'Commander, 1st Maintenance Squadron']);
  });

  it('fills the Presidential header with the Executive Order for the MSM, and drops empty lines', () => {
    const page = certificateText({ ...ponde, awardId: 'msm', basisId: 'service', awardNumber: 1, signedDate: '' }, language, certificate)!;
    expect(page.style).toBe('presidential');
    const texts = page.header.map((l) => l.text);
    expect(texts[0]).toBe('THE UNITED STATES OF AMERICA');
    expect(texts).toContain('AMERICA AUTHORIZED BY EXECUTIVE ORDER, 16 JANUARY 1969');
    expect(texts).toContain('THE MERITORIOUS SERVICE MEDAL');
    expect(texts).toContain('MERITORIOUS SERVICE');
    expect(texts.some((t) => t.includes('OAK LEAF'))).toBe(false);
    expect(page.closing.map((l) => l.text)).toEqual(['GIVEN UNDER MY HAND']);
  });
});

describe('reviewCitation', () => {
  function review(text: string, columns = 70, input: CitationInput = ponde) {
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
