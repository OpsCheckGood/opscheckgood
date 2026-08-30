import { LOCAR_LANGUAGE } from '@/lib/data/memoLanguage';
import {
  formatDate,
  indOrdinal,
  memoDate,
  sigName,
  sigRank,
  slugify,
  subjectCase,
} from './format';
import type {
  Indorsement,
  MemoDoc,
  MemoSpec,
  Para,
  SpecIndorsement,
  TemplateId,
} from './types';

/**
 * Templates: document state in, `MemoSpec` out.
 *
 * A template is the only thing that knows what kind of memorandum this is. Once
 * it returns a spec, the preview, print view, PDF and Word exporters all see
 * the same document, which is why LOCAR's fixed paragraphs and indorsements
 * cannot go missing from one export and not another.
 */

const LOCAR = LOCAR_LANGUAGE.data;

// ---------------------------------------------------------------------------
// Indorsement headers

export interface IndHead {
  head: string;
  headRight?: string;
  line2?: string;
  line2Right?: string;
}

/**
 * AFH 33-337 gives an indorsement two forms, and which one applies depends only
 * on where it lands.
 *
 * `own` -- same page, used when space remains:
 *     1st Ind, ACSC/DEO                                        5 Apr 04
 *
 * `ref` -- separate page, used when it does not fit. Two lines: the first cites
 * the original memorandum (its office, date and subject), the second the
 * indorsing office and the date IT signed:
 *     2d Ind to ACSC/DEOP, 2 Nov 04, Indorsement Memo Format
 *     ACSC/DEOP                                                11 December 2004
 *
 * Everything auto-fills from the basic memorandum and stays overridable.
 */
export function indHead(d: Indorsement, i: number, base: { from: string; date: string; subject: string }): IndHead {
  const ord = indOrdinal(i);
  const pick = (v: string | undefined, fallback: string) => String(v || '').trim() || fallback;
  if ((d.form || 'ref') === 'ref') {
    return {
      head: `${ord} Ind to ${pick(d.refOffice, base.from)}, ${pick(d.refDate, base.date)}, ${pick(
        d.refSubject,
        base.subject,
      )}`,
      line2: pick(d.office, base.from),
      line2Right: pick(d.date, base.date),
    };
  }
  return {
    head: `${ord} Ind, ${pick(d.office, base.from)}`,
    headRight: pick(d.date, '________________ (date)'),
  };
}

function indSpec(d: Indorsement, i: number, base: { from: string; date: string; subject: string }): SpecIndorsement {
  const h = indHead(d, i, base);
  const own = String(d.line2 || '').trim();
  return {
    head: h.head,
    headRight: h.headRight,
    line2: own || h.line2 || '',
    line2Right: own ? '' : h.line2Right || '',
    memoFor: String(d.memoFor || '').trim() ? `MEMORANDUM FOR  ${String(d.memoFor).trim()}` : '',
    subj: String(d.subj || '').trim(),
    numbered: true,
    paras: d.paras && d.paras.length ? d.paras : [''],
    atch: d.atch || [],
    cc: d.cc || [],
    sig: { name: d.sigName || '', rank: d.sigRank || '', title: d.sigTitle || '' },
  };
}

// ---------------------------------------------------------------------------
// Custom MFR

export function customSpec(doc: MemoDoc, now: Date = new Date()): MemoSpec {
  const base = {
    date: memoDate(now),
    memoFor: doc.memoFor || 'RECORD',
    from: doc.from || '',
    subject: doc.subject || '',
    paras: doc.paras && doc.paras.length ? doc.paras : [''],
    atch: doc.atch || [],
    cc: doc.cc || [],
    distro: doc.distro || [],
    sig: { name: doc.prepName, rank: doc.prepRank, title: doc.prepTitle },
    filename: slugify(doc.subject, 'Memorandum'),
  };
  return { ...base, inds: (doc.inds || []).map((d, i) => indSpec(d, i, base)) };
}

// ---------------------------------------------------------------------------
// LOCAR

export function locarAbbr(type: string): string {
  return LOCAR.abbreviations[type] || 'LOC';
}

export function locarVerb(type: string): string {
  return LOCAR.verbs[type] || 'counseled';
}

/** The wording "Load standard wording" drops into paragraphs 1 and 2. */
export function locarSkeleton(): { offense: string; corrective: string } {
  return {
    offense:
      'Investigation has disclosed that on ____________ (date), (describe the specific facts and ' +
      'circumstances of the misconduct \u2014 what occurred, including relevant dates, times, and places).',
    corrective:
      '(State the impact of this misconduct on the good order and discipline of the unit and your ' +
      'expectations for the member\u2019s future conduct.)',
  };
}

/**
 * A LOCAR is four paragraphs and three indorsements, of which the user writes
 * two paragraphs. Paragraph 2 always opens with the fixed sentence, paragraphs
 * 3 and 4 are boilerplate, and the indorsements are the acknowledgment,
 * decision and final acknowledgment cycle -- all of it from the data file.
 */
export function locarSpec(doc: MemoDoc, now: Date = new Date()): MemoSpec {
  const type = doc.locarType || 'Counseling';
  const noun = type.toLowerCase();
  const verb = locarVerb(type);

  const rank = doc.locarRecipRank || '';
  const name = doc.locarRecipName || '';
  // A rank with no name behind it addresses the letter to "SSGT", so the whole
  // element falls back rather than printing half of one.
  const named = name.trim()
    ? `${rank ? `${rank.toUpperCase()} ` : ''}${name.toUpperCase()}`.trim()
    : '(RECIPIENT)';
  const recipient = named + (doc.locarOtherInfo ? `, ${doc.locarOtherInfo}` : '');

  const office = doc.locarFrom || '';
  // The AFJAGS letter shows the issuer in capitals, but the name ORDER still
  // comes from sigName -- upper-casing the raw field prints "DOE, JANE Q"
  // whenever the box holds a roster-order name.
  const issuer = `${office} (${`${doc.prepRank ? `${sigRank(doc.prepRank).toUpperCase()} ` : ''}${sigName(
    doc.prepName,
  )}`.trim()})`;
  const subject = subjectCase(`Letter of ${type}`);

  const offense =
    (doc.locarOffense || '').trim() ||
    'Investigation has disclosed that on or about ____________ (date), (describe the offense).';
  const corrective = (doc.locarCorrective || '').trim();
  const para2 = `You are hereby ${verb}.${corrective ? `  ${corrective}` : ''}`;

  const rights =
    doc.locarUif === 'recommend' ? `${LOCAR.rights} ${LOCAR.uifSentence}` : LOCAR.rights;

  const paras: Para[] = [offense, para2, LOCAR.privacyActRuns as Para, rights];

  const memberSig = { name, rank, title: doc.prepPost || '' };
  const issuerSig = { name: doc.prepName, rank: doc.prepRank, title: doc.prepTitle };

  // The 1st Ind names the basic letter by office, date and subject. The date of
  // the letter is the date it is served, which is already a field -- printing a
  // blank for something we know is just a second place for the two to disagree.
  const letterDate = formatDate(doc.locarDayServed) || '________________ (date)';
  const fill = (lines: readonly string[]) => lines.map((l) => l.replace(/\{\{noun\}\}/g, noun));

  const inds: SpecIndorsement[] = [
    {
      head: `1st Ind to ${office}, ${letterDate}, ${subject}`,
      line2: recipient,
      subj: 'ACKNOWLEDGEMENT',
      numbered: true,
      sig: memberSig,
      paras: fill(LOCAR.acknowledgement.memberFirst),
    },
    {
      head: `2d Ind, ${issuer}`,
      headRight: '________________ (date)',
      memoFor: `MEMORANDUM FOR  ${recipient}`,
      numbered: true,
      sig: issuerSig,
      paras: fill(LOCAR.acknowledgement.issuerDecision),
    },
    {
      head: `3d Ind, ${recipient}`,
      headRight: '________________ (date)',
      memoFor: `MEMORANDUM FOR  ${issuer}`,
      numbered: false,
      sig: memberSig,
      paras: fill(LOCAR.acknowledgement.memberFinal),
    },
  ];

  return {
    date: formatDate(doc.locarDayServed) || memoDate(now),
    memoFor: recipient,
    from: office,
    subject,
    paras,
    inds,
    sig: issuerSig,
    filename: `${locarAbbr(type)}_${slugify(sigName(name), 'Recipient')}`,
  };
}

export function buildSpec(doc: MemoDoc, now: Date = new Date()): MemoSpec {
  return doc.template === 'locar' ? locarSpec(doc, now) : customSpec(doc, now);
}

// ---------------------------------------------------------------------------
// CUI

/**
 * CUI marking is remembered per template: a LOCAR names a member and carries
 * misconduct, so it defaults on; a Custom MFR could be anything, so it does
 * not. A user's choice overrides the default and persists for that template.
 */
export function cuiOn(doc: MemoDoc): boolean {
  const t: TemplateId = doc.template;
  const v = doc.cuiMap?.[t];
  return v !== undefined ? !!v : t === 'locar';
}

export function cuiDesOn(doc: MemoDoc): boolean {
  return !!doc.cuiDesMap?.[doc.template];
}

/**
 * The designation indicator (DoDI 5200.48, para 3.4(f)) -- distinct from the
 * banner. The banner is the word CUI on every page; this is a block that
 * appears only on the first page, at the bottom right, naming who controls the
 * information, its categories, any dissemination control, and a point of
 * contact. A blank field drops its line rather than printing an empty label.
 */
export function cuiDesLines(doc: MemoDoc, spec: { from?: string }): string[] {
  if (!cuiDesOn(doc)) return [];
  const office = String(doc.cuiDesOffice || '').trim() || String(spec.from || '').trim();
  const poc = String(doc.cuiDesPoc || '').trim() || sigName(doc.prepName);
  const out: string[] = [];
  const add = (label: string, v: string) => {
    const value = String(v || '').trim();
    if (value) out.push(`${label}  ${value}`);
  };
  add('Controlled by:', doc.cuiDesComp);
  add('Controlled by:', office);
  add('CUI Category(ies):', String(doc.cuiDesCat || '').trim() || 'PRVCY');
  add('Distribution/Limited Dissemination Control:', doc.cuiDesDist);
  add('POC:', poc);
  return out;
}

/**
 * Categories and controls offered in the pickers. These are the values the
 * source deck actually uses -- the complete sets live in the DoD CUI Registry
 * (categories) and DoDI 5200.48 Table 2 (limited dissemination controls), and
 * both fields stay free text so anything else can be typed.
 */
export const CUI_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['PRVCY', 'Privacy — PII, e.g. an SSAN or home address'],
  ['OPSEC', 'Operations Security'],
  ['CTI', 'Controlled Technical Information'],
  ['NNPI', 'Naval Nuclear Propulsion Information'],
];

export const CUI_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['FEDCON', 'LDC — federal employees and contractors'],
  ['NOFORN', 'LDC — not releasable to foreign nationals'],
  ['REL TO USA, FVEY', 'LDC — releasable as stated'],
  ['Distribution Statement A', 'Approved for public release; distribution unlimited'],
  ['Distribution Statement B', 'US Government agencies only'],
  ['Distribution Statement C', 'US Government agencies and their contractors'],
  ['Distribution Statement D', 'DoD and US DoD contractors only'],
  ['Distribution Statement E', 'DoD Components only'],
  ['Distribution Statement F', 'Further dissemination only as directed'],
];
