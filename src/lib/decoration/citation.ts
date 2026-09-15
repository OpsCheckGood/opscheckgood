import type {
  AwardLanguage,
  CertificateDefinition,
  CitationLanguage,
  GradeTitle,
  HeaderLine,
  Phrase,
} from './types';

/**
 * Builds the sentences the manual fixes, and reviews the result against the
 * rules it states.
 *
 * Nothing in here knows what any sentence says. The patterns, the options and
 * the rule wording all come from citation-language.json; this file only fills
 * placeholders and checks where the wrapped lines fall.
 */

export interface CitationInput {
  awardId: string;
  serviceId: string;
  basisId: string;
  closingId: string;
  /** Retirement closing: 30 or more years of service earns "long and". */
  longCareer: boolean;
  /** The Bronze Star's engagement clause; empty for decorations without one. */
  circumstanceId: string;
  /** Which award of this decoration: 1 is the first, 2 the first oak leaf cluster. */
  awardNumber: number;
  gradeId: string;
  name: string;
  surname: string;
  pronounId: string;
  assignmentId: string;
  duty: string;
  /** The chain the certificate prints, each on its own: squadron, group, wing, base. */
  squadron: string;
  group: string;
  wing: string;
  base: string;
  periodId: string;
  /** ISO dates from the date inputs. */
  start: string;
  end: string;
  date: string;
  /** The approving official's signature block. */
  approver: string;
  approverTitle: string;
  signedDate: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "1 January 2024": no leading zero, month spelled out. Empty when unparseable. */
export function formatCitationDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}

/** Last word of the full name, ignoring a Jr./Sr./II/III suffix. */
export function guessSurname(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^(jr\.?|sr\.?|i{2,3}|iv)$/i.test(words[words.length - 1]!)) {
    words.pop();
  }
  return words[words.length - 1] ?? '';
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Citation template has no value for {${key}}`);
    return value;
  });
}

function byId<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((entry) => entry.id === id);
}

export function findAward(language: CitationLanguage, id: string): AwardLanguage {
  return byId(language.awards, id) ?? language.awards[0]!;
}

export function findGrade(language: CitationLanguage, id: string): GradeTitle {
  return byId(language.grades, id) ?? language.grades[0]!;
}

function pick(list: Phrase[], id: string): Phrase {
  return byId(list, id) ?? list[0]!;
}

/** Comma-joined, empty parts dropped, so a missing unit leaves no ", ,". */
function place(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(', ');
}

export function openingSentence(input: CitationInput, language: CitationLanguage): string {
  const award = findAward(language, input.awardId);
  const grade = findGrade(language, input.gradeId);
  const pronoun = byId(language.pronouns, input.pronounId) ?? language.pronouns[0]!;
  const basis = pick(award.bases, input.basisId);
  const assignment = pick(language.opening.assignments, input.assignmentId);
  const period = pick(language.opening.periods, input.periodId);

  const chain = [input.squadron, input.group, input.wing, input.base];
  const placeText =
    assignment.id === 'as'
      ? place([input.duty, ...chain])
      : assignment.id === 'while'
        ? place(chain)
        : place([input.base]);

  const circumstance =
    award.circumstances.length > 0 ? pick(award.circumstances, input.circumstanceId).text : '';

  return fill(award.pattern ?? language.opening.pattern, {
    rank: grade.full,
    name: input.name.trim(),
    shortRank: grade.short,
    surname: input.surname.trim(),
    reflexive: pronoun.reflexive,
    basis: basis.text,
    assignment: fill(assignment.text, { place: placeText }),
    circumstance,
    period: fill(period.text, {
      start: formatCitationDate(input.start),
      end: formatCitationDate(input.end),
      date: formatCitationDate(input.date),
    }),
  })
    .replace(/\s+/g, ' ')
    .replace(/ ([,.])/g, '$1');
}

// ---------------------------------------------------------------------------
// The certificate's own lines
// ---------------------------------------------------------------------------

/** "(FIRST OAK LEAF CLUSTER)", or nothing for a first award. */
export function clusterLine(awardNumber: number, clusters: readonly string[]): string {
  const n = Math.max(1, Math.floor(awardNumber));
  if (n <= 1) return '';
  const word = clusters[n - 1];
  return word ? `(${word} OAK LEAF CLUSTER)` : `(${n - 1} OAK LEAF CLUSTERS)`;
}

/**
 * The member's line: full grade and full name in capitals, initials without
 * their periods, the way myDecs prints "STAFF SERGEANT QUINN H BRENNER".
 */
export function memberLine(input: CitationInput, language: CitationLanguage): string {
  const grade = findGrade(language, input.gradeId);
  const name = input.name.trim().replace(/\b([A-Za-z])\./g, '$1');
  return `${grade.full} ${name}`.trim().toUpperCase();
}

/** "8 November 2022 to 8 November 2025", or the single date, or nothing. */
export function periodLine(input: CitationInput): string {
  if (input.periodId === 'range') {
    const start = formatCitationDate(input.start);
    const end = formatCitationDate(input.end);
    return start && end ? `${start} to ${end}` : start || end;
  }
  if (input.periodId === 'on') return formatCitationDate(input.date);
  return '';
}

export interface CertificateText {
  style: 'daf' | 'presidential';
  /** Header lines above the citation, placeholders filled, empty ones dropped. */
  header: HeaderLine[];
  /** Lines below the citation: GIVEN UNDER MY HAND and the date. */
  closing: HeaderLine[];
  /** The signature block, left column. */
  signature: string[];
}

/**
 * Everything the certificate prints besides the citation, with the
 * decoration's own words filled into the page layout.
 */
export function certificateText(
  input: CitationInput,
  language: CitationLanguage,
  certificate: CertificateDefinition,
): CertificateText | null {
  const page = certificate.page;
  if (!page) return null;
  const award = findAward(language, input.awardId);
  const basis = pick(award.bases, input.basisId);
  const vars: Record<string, string> = {
    decoration: award.certificate.title,
    cluster: clusterLine(input.awardNumber, page.clusters),
    member: memberLine(input, language),
    basis: basis.forLine ?? basis.label.toUpperCase(),
    period: periodLine(input),
    authority: award.certificate.authority,
    signed: formatCitationDate(input.signedDate),
  };
  const render = (lines: HeaderLine[]): HeaderLine[] =>
    lines.flatMap((line) => {
      const keys = [...line.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      if (keys.length > 0 && keys.every((k) => (vars[k] ?? '') === '')) return [];
      const text = line.text
        .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return [{ ...line, text }];
    });
  return {
    style: award.certificate.style,
    header: render(page.headers[award.certificate.style].lines),
    closing: render(page.closing),
    signature: [input.approver.trim(), input.approverTitle.trim()].filter(Boolean),
  };
}

export function closingSentence(input: CitationInput, language: CitationLanguage): string {
  const award = findAward(language, input.awardId);
  const grade = findGrade(language, input.gradeId);
  const pronoun = byId(language.pronouns, input.pronounId) ?? language.pronouns[0]!;
  const service = byId(language.services, input.serviceId) ?? language.services[0]!;
  const closing = pick(award.closings, input.closingId);
  return fill(closing.text, {
    shortRank: grade.short,
    surname: input.surname.trim(),
    reflexive: pronoun.reflexive,
    possessive: pronoun.possessive,
    service: service.text,
    longAnd: input.longCareer ? 'long and ' : '',
  }).replace(/\s+/g, ' ');
}

/** One paragraph: the three parts with single spaces between the ones present. */
export function assembleCitation(opening: string, narrative: string, closing: string): string {
  return [opening, narrative, closing]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface Warning {
  /** Manual paragraph, when the rule has one. */
  ref: string | null;
  text: string;
}

/** True when any occurrence of the phrase crosses a line break. */
function straddles(lines: string[], phrase: string): boolean {
  if (phrase.trim() === '') return false;
  const joined = lines.join('\n');
  // Across a break the phrase's space has become a newline, so match either.
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped.replace(/ /g, '[ \\n]'), 'g');
  for (const match of joined.matchAll(pattern)) {
    if (match[0].includes('\n')) return true;
  }
  return false;
}

export function reviewCitation(
  text: string,
  lines: string[],
  input: CitationInput,
  language: CitationLanguage,
): Warning[] {
  const warnings: Warning[] = [];
  const grade = findGrade(language, input.gradeId);

  // Anything off a US keyboard may not survive the trip through myDecs, and a
  // curly quote is the usual way a pasted draft carries one in.
  const odd = [...new Set([...text].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32))];
  if (odd.length > 0) {
    warnings.push({
      ref: null,
      text: `Characters not on a standard keyboard: ${odd.map((c) => `"${c}"`).join(' ')}. Replace them with plain quotes, hyphens and spaces.`,
    });
  }

  if (/ {2,}/.test(text)) {
    warnings.push({ ref: null, text: 'Two spaces in a row. Each one counts against 1350.' });
  }

  const fullName = `${grade.full} ${input.name.trim()}`.trim();
  if (input.name.trim() && straddles(lines, fullName)) {
    warnings.push({ ref: 'A5.1.6', text: `"${fullName}" is split across two lines.` });
  }
  const shortName = `${grade.short} ${input.surname.trim()}`.trim();
  if (input.surname.trim() && straddles(lines, shortName)) {
    warnings.push({ ref: 'A5.1.6', text: `"${shortName}" is split across two lines.` });
  }

  const start = formatCitationDate(input.start);
  const end = formatCitationDate(input.end);
  if (start && end && straddles(lines, `from ${start} to ${end}`)) {
    warnings.push({ ref: 'A5.1.4', text: 'The inclusive period is split across two lines.' });
  }

  // A lone digit, except a day of the month: "1 January 2024" is how the
  // manual itself writes a date.
  const months = MONTHS.join('|');
  const smallNumbers = [
    ...new Set(
      text.match(new RegExp(`(?<![\\d,.$])\\b[0-9]\\b(?![\\d,.%])(?! (?:${months})\\b)`, 'g')) ?? [],
    ),
  ];
  if (smallNumbers.length > 0) {
    warnings.push({
      ref: 'A5.1.10',
      text: `Spell out ${smallNumbers.join(', ')} unless space is limited.`,
    });
  }

  const caps = [...new Set(text.match(/\b[A-Z]{2,}[A-Z0-9]*\b/g) ?? [])];
  if (caps.length > 0) {
    warnings.push({
      ref: 'A5.1.14',
      text: `${caps.join(', ')}: fine if it is a code name or on the approved DAF abbreviations list, otherwise spell it out.`,
    });
  }

  return warnings;
}
