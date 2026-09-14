import type { CeremonyData, CeremonyGrade, CeremonyTier, Charge } from '../data/ceremony';

/**
 * Builds a promotion ceremony run of show from the people involved.
 *
 * The script is a list of blocks rather than a string: lines the emcee says,
 * cues nobody reads aloud, headings, and the charge's own paragraphs. The
 * screen, the print view and the clipboard each lay those out their own way
 * from the same list, so they cannot drift.
 *
 * Every role is optional. A blank role removes its lines rather than leaving
 * a sentence with a hole in it, which is what makes this usable outside the
 * one squadron the original form was written for: nothing here assumes a
 * chief, a first sergeant, a spouse, or a nickname for the unit.
 */

export interface DistinguishedVisitor {
  name: string;
  /** "his first supervisor", printed after the name. Optional. */
  role: string;
}

export interface CeremonyInput {
  unit: string;
  /** "Team 8-Deuce": how the emcee refers to everyone from the unit. */
  team: string;
  greeting: string;
  date: string;
  time: string;
  promoteeName: string;
  pronounId: string;
  currentGradeId: string;
  newGradeId: string;
  emcee: string;
  presiding: string;
  seniorEnlisted: string;
  firstSergeant: string;
  remarksBy: string;
  chargeReader: string;
  /** Set false to leave the charge out even when the tier has one. */
  readCharge: boolean;
  tackers: string[];
  spouseRelation: string;
  spouseName: string;
  children: string;
  mother: string;
  father: string;
  visitors: DistinguishedVisitor[];
  refreshments: string;
}

export type Block =
  | { kind: 'say'; text: string }
  | { kind: 'cue'; text: string }
  | { kind: 'title'; text: string }
  | { kind: 'para'; text: string };

export interface ScriptSection {
  id: 'opening' | 'charge' | 'closing';
  title: string;
  blocks: Block[];
}

export interface Pronouns {
  id: string;
  label: string;
  subject: string;
  possessive: string;
  /** Third-person singular verb ending: "promotes" versus "promote". */
  s: string;
}

export const PRONOUNS: Pronouns[] = [
  { id: 'he', label: 'he / him', subject: 'he', possessive: 'his', s: 's' },
  { id: 'she', label: 'she / her', subject: 'she', possessive: 'her', s: 's' },
  { id: 'they', label: 'they / them', subject: 'they', possessive: 'their', s: '' },
];

export const GREETINGS = ['Good morning', 'Good afternoon', 'Good evening'];

export function emptyInput(data: CeremonyData): CeremonyInput {
  return {
    unit: '',
    team: '',
    greeting: GREETINGS[1]!,
    date: '',
    time: '',
    promoteeName: '',
    pronounId: 'he',
    currentGradeId: data.grades.find((g) => g.id === 'sra')?.id ?? data.grades[0]!.id,
    newGradeId: data.grades.find((g) => g.id === 'ssgt')?.id ?? data.grades[0]!.id,
    emcee: '',
    presiding: '',
    seniorEnlisted: '',
    firstSergeant: '',
    remarksBy: '',
    chargeReader: '',
    readCharge: true,
    tackers: ['', ''],
    spouseRelation: '',
    spouseName: '',
    children: '',
    mother: '',
    father: '',
    visitors: [{ name: '', role: '' }],
    refreshments: '',
  };
}

const trim = (s: string | undefined): string => (s ?? '').trim();

/** Last word of the name, ignoring a Jr./Sr./II/III suffix. */
export function surname(name: string): string {
  const words = trim(name).split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^(jr\.?|sr\.?|i{2,3}|iv)$/i.test(words[words.length - 1]!)) {
    words.pop();
  }
  return words[words.length - 1] ?? '';
}

/** "a", "a and b", "a, b, and c". */
export function oxford(parts: string[]): string {
  const items = parts.map(trim).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function grade(data: CeremonyData, id: string): CeremonyGrade {
  return data.grades.find((g) => g.id === id) ?? data.grades[0]!;
}

function tier(data: CeremonyData, g: CeremonyGrade): CeremonyTier {
  return data.tiers.find((t) => t.id === g.tier) ?? data.tiers[0]!;
}

/**
 * The charge for this promotion, or null.
 *
 * A charge is read when the member enters a tier, so it keys off the new
 * grade being the first grade of its tier in the data's order. Promoting from
 * Master Sergeant to Senior Master Sergeant reads nothing.
 */
export function chargeFor(data: CeremonyData, input: CeremonyInput): Charge | null {
  const next = grade(data, input.newGradeId);
  const t = tier(data, next);
  if (!t.chargeId) return null;
  const first = data.grades.find((g) => g.tier === t.id);
  if (!first || first.id !== next.id) return null;
  return data.charges.find((c) => c.id === t.chargeId) ?? null;
}

export function isEmpty(input: CeremonyInput): boolean {
  const strings = [
    input.unit, input.team, input.promoteeName, input.emcee, input.presiding, input.seniorEnlisted,
    input.firstSergeant, input.remarksBy, input.chargeReader, input.refreshments,
    input.spouseRelation, input.spouseName, input.children, input.mother, input.father,
    ...input.tackers, ...input.visitors.map((v) => v.name),
  ];
  return strings.every((s) => trim(s) === '');
}

export function buildScript(data: CeremonyData, input: CeremonyInput): ScriptSection[] {
  const pr = PRONOUNS.find((p) => p.id === input.pronounId) ?? PRONOUNS[0]!;
  const last = surname(input.promoteeName) || '(promotee)';
  const cur = grade(data, input.currentGradeId).full;
  const next = grade(data, input.newGradeId);
  const newFull = next.full;
  const newTier = tier(data, next);
  const charge = input.readCharge ? chargeFor(data, input) : null;
  const team = trim(input.team) || (trim(input.unit) ? `the ${trim(input.unit)}` : 'our unit');
  const emcee = trim(input.emcee);
  const presiding = trim(input.presiding);
  const chief = trim(input.seniorEnlisted);
  const shirt = trim(input.firstSergeant);
  const remarks = trim(input.remarksBy);
  const reader = trim(input.chargeReader) || chief || presiding;
  const greeting = trim(input.greeting) || 'Good afternoon';

  // ---- Opening -----------------------------------------------------------
  const open: Block[] = [];
  const say = (list: Block[], text: string) => list.push({ kind: 'say', text });
  const cue = (list: Block[], text: string) => list.push({ kind: 'cue', text });

  cue(open, 'Approximately three minutes prior to start:');
  say(open, 'Ladies and gentlemen, the ceremony is about to begin.');
  cue(open, 'Slight pause.');
  say(
    open,
    `${greeting}, ladies and gentlemen. Welcome to today's promotion ceremony. Today we will recognize ${cur} ${last} as ${pr.subject} promote${pr.s} to the rank of ${newFull}.`,
  );
  cue(open, 'Slight pause.');
  if (emcee) {
    say(open, `I am ${emcee}, and I will be your emcee.`);
    cue(open, 'Slight pause.');
  }
  say(
    open,
    `Before we begin today's ceremony, we would like to extend a special welcome to the family, friends, peers, and all of ${team} here with us today. Without your patience, trust, and understanding, there would be a great void in the significance of this ceremony.`,
  );
  cue(open, 'Slight pause.');

  const visitors = input.visitors
    .map((v) => ({ name: trim(v.name), role: trim(v.role) }))
    .filter((v) => v.name)
    .map((v) => (v.role ? `${v.name}, ${v.role}` : v.name));
  if (visitors.length === 1) {
    say(open, `We would also like to recognize our distinguished visitor today, ${visitors[0]}.`);
    cue(open, 'Slight pause.');
  } else if (visitors.length > 1) {
    say(open, `We would also like to recognize our distinguished visitors today: ${oxford(visitors)}.`);
    cue(open, 'Slight pause.');
  }

  const leadership = oxford([presiding, chief]);
  if (leadership) {
    say(open, `We are also honored to be joined by ${leadership} today.`);
    cue(open, 'Slight pause.');
  }

  const family: string[] = [];
  const rel = trim(input.spouseRelation);
  const spouse = trim(input.spouseName);
  if (rel) family.push(`${pr.possessive} ${rel.toLowerCase()}${spouse ? `, ${spouse}` : ''}`);
  else if (spouse) family.push(`${pr.possessive} spouse, ${spouse}`);
  if (trim(input.mother)) family.push(`${pr.possessive} mother, ${trim(input.mother)}`);
  if (trim(input.father)) family.push(`${pr.possessive} father, ${trim(input.father)}`);
  if (trim(input.children)) family.push(`${pr.possessive} children, ${trim(input.children)}`);
  if (family.length) {
    say(open, `${cur} ${last} is also joined today by ${oxford(family)}.`);
    cue(open, 'Slight pause.');
  }

  say(
    open,
    "Promotion ceremonies are an age-old tradition in which leaders recognize their Airmen in front of their supervisors, peers, and subordinates. The promotion signifies the promotee's ability to handle increased responsibility and is a reflection of their dedication to the profession of arms.",
  );
  cue(open, 'Slight pause.');

  const corps = charge && newTier.corps ? `, and into ${newTier.corps}` : '';
  const forward = presiding ? `${presiding} and ${cur} ${last}, please come forward.` : `${cur} ${last}, please come forward.`;
  say(open, `We will now recognize ${cur} ${last} as ${pr.subject} transition${pr.s} to the next rank${corps}. ${forward}`);
  cue(open, 'Slight pause.');
  say(open, `Being promoted to the rank of ${newFull}... ${cur} ${last}!`);
  cue(open, 'Proffer: present the certificate toward the audience. Presiding official and promotee shake, take a photo, and salute.');
  if (presiding) cue(open, 'Presiding official steps to stage right, next to the podium.');
  cue(open, `${last} faces the audience and takes one step forward.`);

  const tackers = input.tackers.map(trim).filter(Boolean);
  if (tackers.length === 1) {
    say(open, `Assisting with tacking on ${last}'s new stripes is ${tackers[0]}.`);
    cue(open, 'Pause to allow for the tacking of the stripes.');
  } else if (tackers.length > 1) {
    say(open, `Assisting with tacking on ${last}'s new stripes are ${oxford(tackers)}.`);
    cue(open, 'Pause to allow for the tacking of the stripes.');
  }

  if (remarks) {
    say(open, `At this time, ${remarks} will give a few remarks about ${newFull} ${last}.`);
    cue(open, `${remarks} speaks, then returns to formation.`);
    say(open, `Thank you, ${remarks}.`);
  }

  // ---- Charge ------------------------------------------------------------
  const chargeBlocks: Block[] = [];
  if (charge) {
    if (reader) {
      say(open, `Following Air Force tradition, ${reader} will now come forward to deliver the ${charge.title}. ${charge.standFor}`);
    } else {
      say(open, `Following Air Force tradition, we will now deliver the ${charge.title}. ${charge.standFor}`);
    }
    cue(chargeBlocks, 'Reader delivers the charge below verbatim, then returns to formation.');
    chargeBlocks.push({ kind: 'title', text: charge.title.toUpperCase() });
    for (const p of charge.paragraphs) chargeBlocks.push({ kind: 'para', text: p });
    cue(chargeBlocks, 'Reader returns to formation.');
    cue(chargeBlocks, 'Applause.');
  } else {
    cue(open, 'No formal charge is read for this promotion. Proceed to closing.');
  }

  // ---- Closing -----------------------------------------------------------
  const close: Block[] = [];
  say(close, `${newFull} ${last}, the floor is yours.`);
  cue(close, 'Promotee says a few words.');
  say(close, `Thank you, ${newFull} ${last}.`);
  cue(close, 'Promotee returns to formation.');

  const speakers: { name: string; why: string; applause: boolean }[] = [];
  if (shirt) speakers.push({ name: shirt, why: 'to share a few words', applause: false });
  if (chief) speakers.push({ name: chief, why: 'to share a few words', applause: false });
  if (presiding) speakers.push({ name: presiding, why: 'for closing remarks', applause: true });
  for (const sp of speakers) {
    say(close, `${sp.name}, please come forward ${sp.why}.`);
    cue(close, `${sp.name} speaks.`);
    say(close, `Thank you, ${sp.name}.`);
    if (sp.applause) cue(close, 'Lead applause.');
  }
  cue(close, 'Pause.');
  const refresh = trim(input.refreshments);
  say(
    close,
    `Thank you to everyone for attending and for showing your support and encouragement. This concludes today's ceremony. Please come forward to congratulate our newest ${newFull}.${refresh ? ` Light refreshments are in the ${refresh}.` : ''}`,
  );

  const sections: ScriptSection[] = [{ id: 'opening', title: 'Run of show', blocks: open }];
  if (chargeBlocks.length) sections.push({ id: 'charge', title: 'The charge', blocks: chargeBlocks });
  sections.push({ id: 'closing', title: 'Closing', blocks: close });
  return sections;
}

/** Plain text for the clipboard: cues marked with », a blank line before each spoken line. */
export function scriptToText(sections: ScriptSection[]): string {
  const out: string[] = [];
  for (const section of sections) {
    if (out.length) out.push('', '');
    out.push(section.title.toUpperCase(), '');
    let first = true;
    for (const block of section.blocks) {
      if (block.kind === 'say') {
        if (!first) out.push('');
        out.push(`EMCEE: ${block.text}`);
      } else if (block.kind === 'cue') {
        out.push(`» ${block.text}`);
      } else if (block.kind === 'title') {
        if (!first) out.push('');
        out.push(block.text);
      } else {
        out.push('', block.text);
      }
      first = false;
    }
  }
  return out.join('\n');
}
