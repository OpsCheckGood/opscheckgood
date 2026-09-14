import { describe, it, expect } from 'vitest';
import { CEREMONY } from '@/lib/data/ceremony';
import {
  buildScript,
  chargeFor,
  emptyInput,
  isEmpty,
  oxford,
  scriptToText,
  surname,
  type CeremonyInput,
} from '@/lib/promotion/ceremony';
import { printScript } from '@/lib/promotion/ceremony-print';

const data = CEREMONY.data;

/** The worked example the original 82 RS form shipped with. */
const kugelman: CeremonyInput = {
  ...emptyInput(data),
  unit: '82 RS',
  team: 'Team 8-Deuce',
  greeting: 'Good afternoon',
  date: '31 October 2025',
  time: '1230',
  promoteeName: 'John D. Kugelman',
  pronounId: 'he',
  currentGradeId: 'tsgt',
  newGradeId: 'msgt',
  emcee: 'SSgt Kidman',
  presiding: 'Colonel Ellsworth',
  seniorEnlisted: 'Chief Master Sergeant Holt',
  firstSergeant: 'First Sergeant Diaz',
  remarksBy: 'Senior Master Sergeant Stewart',
  chargeReader: 'Senior Master Sergeant Berkshire',
  tackers: ['Senior Master Sergeant Stewart', 'Mrs. Kugelman'],
  spouseRelation: 'Wife',
  spouseName: 'Jane',
  children: 'Sam and Lily',
  visitors: [{ name: 'Chief Master Sergeant (Ret.) Vance', role: 'his first supervisor' }],
  refreshments: 'small break room',
};

const said = (input: CeremonyInput) =>
  buildScript(data, input)
    .flatMap((s) => s.blocks)
    .filter((b) => b.kind === 'say')
    .map((b) => b.text);

describe('the ceremony data', () => {
  it('loads with both charges and is marked stub', () => {
    expect(CEREMONY.isStub).toBe(true);
    expect(data.charges.map((c) => c.id).sort()).toEqual(['nco', 'snco']);
    expect(data.grades).toHaveLength(9);
  });

  it('reads a charge only on entry to a tier', () => {
    const charge = (newGradeId: string) => chargeFor(data, { ...kugelman, newGradeId })?.id ?? null;
    expect(charge('ssgt')).toBe('nco');
    expect(charge('msgt')).toBe('snco');
    expect(charge('tsgt')).toBeNull();
    expect(charge('smsgt')).toBeNull();
    expect(charge('cmsgt')).toBeNull();
    expect(charge('sra')).toBeNull();
  });
});

describe('helpers', () => {
  it('finds the surname past a suffix', () => {
    expect(surname('John D. Kugelman')).toBe('Kugelman');
    expect(surname('Robert Smith Jr.')).toBe('Smith');
    expect(surname('')).toBe('');
  });
  it('joins with an Oxford comma', () => {
    expect(oxford(['a'])).toBe('a');
    expect(oxford(['a', 'b'])).toBe('a and b');
    expect(oxford(['a', '', 'b', 'c'])).toBe('a, b, and c');
    expect(oxford([])).toBe('');
  });
  it('knows an untouched form is empty', () => {
    expect(isEmpty(emptyInput(data))).toBe(true);
    expect(isEmpty(kugelman)).toBe(false);
  });
});

describe('buildScript against the original form', () => {
  const lines = said(kugelman);

  it('reproduces the opening lines the 82 RS form printed', () => {
    expect(lines).toContain(
      "Good afternoon, ladies and gentlemen. Welcome to today's promotion ceremony. Today we will recognize Technical Sergeant Kugelman as he promotes to the rank of Master Sergeant.",
    );
    expect(lines).toContain('I am SSgt Kidman, and I will be your emcee.');
    expect(lines.some((l) => l.includes('all of Team 8-Deuce here with us today'))).toBe(true);
    expect(lines).toContain(
      'We would also like to recognize our distinguished visitor today, Chief Master Sergeant (Ret.) Vance, his first supervisor.',
    );
    expect(lines).toContain('We are also honored to be joined by Colonel Ellsworth and Chief Master Sergeant Holt today.');
    expect(lines).toContain('Technical Sergeant Kugelman is also joined today by his wife, Jane and his children, Sam and Lily.');
    expect(lines).toContain(
      'We will now recognize Technical Sergeant Kugelman as he transitions to the next rank, and into the Senior Noncommissioned Officer Corps. Colonel Ellsworth and Technical Sergeant Kugelman, please come forward.',
    );
    expect(lines).toContain('Being promoted to the rank of Master Sergeant... Technical Sergeant Kugelman!');
    expect(lines).toContain("Assisting with tacking on Kugelman's new stripes are Senior Master Sergeant Stewart and Mrs. Kugelman.");
    expect(lines).toContain(
      'Following Air Force tradition, Senior Master Sergeant Berkshire will now come forward to deliver the Senior Noncommissioned Officer Charge. All past and present Senior NCOs, please stand at attention for the reading:',
    );
  });

  it('puts the charge on its own section with every paragraph', () => {
    const sections = buildScript(data, kugelman);
    const charge = sections.find((s) => s.id === 'charge')!;
    expect(charge).toBeDefined();
    expect(charge.blocks.filter((b) => b.kind === 'para')).toHaveLength(
      data.charges.find((c) => c.id === 'snco')!.paragraphs.length,
    );
    expect(charge.blocks.some((b) => b.kind === 'title' && b.text === 'SENIOR NONCOMMISSIONED OFFICER CHARGE')).toBe(true);
  });

  it('reproduces the closing', () => {
    expect(lines).toContain('Master Sergeant Kugelman, the floor is yours.');
    expect(lines).toContain('First Sergeant Diaz, please come forward to share a few words.');
    expect(lines).toContain('Chief Master Sergeant Holt, please come forward to share a few words.');
    expect(lines).toContain('Colonel Ellsworth, please come forward for closing remarks.');
    expect(lines[lines.length - 1]).toBe(
      "Thank you to everyone for attending and for showing your support and encouragement. This concludes today's ceremony. Please come forward to congratulate our newest Master Sergeant. Light refreshments are in the small break room.",
    );
  });
});

describe('buildScript for any unit', () => {
  it('falls back to the unit name, then a neutral phrase, when there is no nickname', () => {
    expect(said({ ...kugelman, team: '' }).some((l) => l.includes('all of the 82 RS here'))).toBe(true);
    expect(said({ ...kugelman, team: '', unit: '' }).some((l) => l.includes('all of our unit here'))).toBe(true);
  });

  it('drops the lines of every blank role instead of leaving holes', () => {
    const bare: CeremonyInput = {
      ...emptyInput(data),
      promoteeName: 'Pat Q. Doe',
      pronounId: 'they',
      currentGradeId: 'a1c',
      newGradeId: 'sra',
    };
    const lines = said(bare);
    const text = scriptToText(buildScript(data, bare));
    expect(lines.some((l) => l.includes('as they promote to the rank of Senior Airman'))).toBe(true);
    expect(lines.some((l) => l.startsWith('I am '))).toBe(false);
    expect(lines.some((l) => l.includes('honored to be joined'))).toBe(false);
    expect(lines.some((l) => l.includes('joined today by'))).toBe(false);
    expect(lines.some((l) => l.includes('tacking on'))).toBe(false);
    expect(lines.some((l) => l.includes('few remarks'))).toBe(false);
    expect(lines.some((l) => l.endsWith('to the next rank. Airman First Class Doe, please come forward.'))).toBe(true);
    expect(text).toContain('» No formal charge is read for this promotion. Proceed to closing.');
    expect(text).not.toContain('undefined');
    expect(text).not.toMatch(/ {2}|\bthe \./);
    expect(lines[lines.length - 1]!.endsWith('our newest Senior Airman.')).toBe(true);
  });

  it('agrees the verb with the pronouns', () => {
    expect(said({ ...kugelman, pronounId: 'she' }).some((l) => l.includes('as she promotes'))).toBe(true);
    expect(said({ ...kugelman, pronounId: 'they' }).some((l) => l.includes('as they transition to'))).toBe(true);
  });

  it('defaults the charge reader to the chief, then the presiding official', () => {
    expect(said({ ...kugelman, chargeReader: '' }).some((l) => l.startsWith('Following Air Force tradition, Chief Master Sergeant Holt'))).toBe(true);
    expect(
      said({ ...kugelman, chargeReader: '', seniorEnlisted: '' }).some((l) => l.startsWith('Following Air Force tradition, Colonel Ellsworth')),
    ).toBe(true);
  });

  it('lists several distinguished visitors and skips blank ones', () => {
    const lines = said({
      ...kugelman,
      visitors: [
        { name: 'A', role: '' },
        { name: '', role: 'ignored' },
        { name: 'B', role: 'her mentor' },
        { name: 'C', role: '' },
      ],
    });
    expect(lines).toContain('We would also like to recognize our distinguished visitors today: A, B, her mentor, and C.');
  });

  it('can leave the charge out on request', () => {
    const sections = buildScript(data, { ...kugelman, readCharge: false });
    expect(sections.some((s) => s.id === 'charge')).toBe(false);
    expect(said({ ...kugelman, readCharge: false }).some((l) => l.includes('into the Senior Noncommissioned'))).toBe(false);
  });

  it('reads the NCO charge for a new Staff Sergeant', () => {
    const lines = said({ ...kugelman, currentGradeId: 'sra', newGradeId: 'ssgt' });
    expect(lines.some((l) => l.includes('deliver the Noncommissioned Officer Charge. All past and present NCOs'))).toBe(true);
    expect(lines.some((l) => l.includes('into the Noncommissioned Officer Corps'))).toBe(true);
  });
});

describe('outputs', () => {
  it('renders the print document with one page per section and escaped text', () => {
    const html = printScript({ ...kugelman, unit: 'A & B' }, buildScript(data, kugelman));
    expect(html.match(/<section class="pg">/g)).toHaveLength(3);
    expect(html).toContain('A &amp; B Promotion Script');
    expect(html).toContain('<b>EMCEE:</b>');
    expect(html).not.toContain('<script');
  });

  it('marks cues in the plain-text copy', () => {
    const text = scriptToText(buildScript(data, kugelman));
    expect(text.startsWith('RUN OF SHOW\n\n» Approximately three minutes prior to start:')).toBe(true);
    expect(text).toContain('\nEMCEE: Ladies and gentlemen, the ceremony is about to begin.');
    expect(text).toContain('THE CHARGE');
  });
});
