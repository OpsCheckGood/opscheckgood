import type { Para, Run, TailField } from './types';

/**
 * Formatting rules from AFH 33-337 (The Tongue and Quill), in one place.
 *
 * Every renderer -- preview, print, PDF, Word -- calls these rather than
 * re-deriving them, because four copies of a numbering rule is four chances to
 * print "2nd Ind" instead of "2d Ind".
 */

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

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today, in the military date order a memorandum uses: "4 Sep 2026". */
export function memoDate(now: Date = new Date()): string {
  return `${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

/** An ISO date from a date input, spelled out: "2026-09-04" -> "4 September 2026". */
export function formatDate(iso: string): string {
  const parts = String(iso || '').split('-');
  if (parts.length !== 3) return iso || '';
  const month = MONTHS[Number(parts[1]) - 1];
  if (!month) return iso;
  return `${Number(parts[2])} ${month} ${parts[0]}`;
}

// ---------------------------------------------------------------------------
// Paragraph trees

/**
 * Sub-paragraphs, or null.
 *
 * The array check is not defensive noise. Every JavaScript string has a `.sub`
 * property -- `String.prototype.sub`, the legacy `<sub>` wrapper -- so testing
 * `p.sub` alone makes every plain-string paragraph look subdivided and throws
 * on the first `.map`.
 */
export function subOf(p: Para): Para[] | null {
  return p !== null && typeof p === 'object' && !Array.isArray(p) && Array.isArray(p.sub) ? p.sub : null;
}

/** The paragraph's own text, whatever shape it is stored in. */
export function bodyOf(p: Para): string | Run[] {
  const sub = subOf(p);
  return sub ? (p as { t: string | Run[] }).t : (p as string | Run[]);
}

/** Plain text of a paragraph, styling flattened. Used for emptiness checks. */
export function textOf(p: Para): string {
  const body = bodyOf(p);
  return typeof body === 'string' ? body : (body || []).map((r) => r.t).join('');
}

/**
 * Four levels, each a quarter inch further in: 1. -> a. -> (1) -> (a). Levels
 * five and six exist in the handbook as bare 1 / a and render if data ever goes
 * that deep, but the editor stops offering new levels at four.
 */
export const MAX_LEVEL = 4;

export function paraLabel(level: number, i: number): string {
  const num = String(i + 1);
  const letter = String.fromCharCode(97 + (i % 26));
  if (level === 0) return `${num}.`;
  if (level === 1) return `${letter}.`;
  if (level === 2) return `(${num})`;
  if (level === 3) return `(${letter})`;
  return level === 4 ? num : letter;
}

/** Collapses a parent whose children were all removed back to plain text. */
export function normalizeParas(list: Para[]): Para[] {
  return (list || []).map((p) => {
    const sub = subOf(p);
    if (!sub) return p;
    const kids = normalizeParas(sub);
    return kids.length ? { t: bodyOf(p) || '', sub: kids } : bodyOf(p) || '';
  });
}

// ---------------------------------------------------------------------------
// Indorsements

/** Indorsements are numbered the military way -- 1st, 2d, 3d, 4th. */
export function indOrdinal(i: number): string {
  const n = i + 1;
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  const d = n % 10;
  return `${n}${d === 1 ? 'st' : d === 2 || d === 3 ? 'd' : 'th'}`;
}

// ---------------------------------------------------------------------------
// The elements below a signature block

export interface TailBlock {
  head: string;
  items: string[];
}

/**
 * Attachments, courtesy copies and distribution, in the template's order.
 *
 * One attachment is listed unnumbered under "Attachment:"; two or more are
 * numbered under "<n> Attachments:". The first element present begins on the
 * third line below the duty title and each one after it on the second line
 * below the one before -- that spacing is the renderers' job; the order and
 * the headings are this one's.
 */
export function tailBlocks(o: Partial<Record<TailField, string[]>>): TailBlock[] {
  const out: TailBlock[] = [];
  const clean = (list?: string[]) => (list || []).map((x) => String(x || '').trim()).filter(Boolean);

  const atch = clean(o.atch);
  if (atch.length) {
    out.push({
      head: atch.length === 1 ? 'Attachment:' : `${atch.length} Attachments:`,
      items: atch.length === 1 ? atch.slice() : atch.map((x, i) => `${i + 1}.  ${x}`),
    });
  }
  const cc = clean(o.cc);
  if (cc.length) out.push({ head: 'cc:', items: cc });
  const distro = clean(o.distro);
  if (distro.length) out.push({ head: 'DISTRIBUTION:', items: distro });
  return out;
}

// ---------------------------------------------------------------------------
// Names, ranks, titles

const RANKS: Record<string, string> = {
  AB: 'AB',
  AMN: 'Amn',
  A1C: 'A1C',
  SRA: 'SrA',
  SGT: 'Sgt',
  SSG: 'SSgt',
  SSGT: 'SSgt',
  TSG: 'TSgt',
  TSGT: 'TSgt',
  MSG: 'MSgt',
  MSGT: 'MSgt',
  SMS: 'SMSgt',
  SMSGT: 'SMSgt',
  CMS: 'CMSgt',
  CMSGT: 'CMSgt',
  CCM: 'CCM',
  '2LT': '2d Lt',
  '2DLT': '2d Lt',
  '1LT': '1st Lt',
  '1STLT': '1st Lt',
  CPT: 'Capt',
  CAPT: 'Capt',
  MAJ: 'Maj',
  LTC: 'Lt Col',
  LTCOL: 'Lt Col',
  COL: 'Col',
  BG: 'Brig Gen',
  BRIGGEN: 'Brig Gen',
  MG: 'Maj Gen',
  MAJGEN: 'Maj Gen',
  LTG: 'Lt Gen',
  LTGEN: 'Lt Gen',
  GEN: 'Gen',
};

/** "MSGT" -> "MSgt". An unrecognised spelling is left exactly as typed. */
export function sigRank(grade: string): string {
  const raw = String(grade || '').trim();
  if (!raw) return '';
  return RANKS[raw.toUpperCase().replace(/[^A-Z0-9]/g, '')] || raw;
}

const SUFFIX = /^(JR|SR|II|III|IV|V)\.?$/i;

/**
 * A signature block carries the middle INITIAL, never the whole middle name,
 * and shouts the result.
 *
 * Both input orders have to work, because a public tool gets both:
 *   "ELLSWORTH, MICHAEL ANTHONY" -> MICHAEL A. ELLSWORTH
 *   "Michael Anthony Ellsworth"  -> MICHAEL A. ELLSWORTH
 * Idempotent, so an already-correct block passes through unchanged.
 */
export function sigName(full: string): string {
  const s = String(full || '').trim();
  if (!s) return '';
  let first = '';
  let mids: string[] = [];
  let last = '';
  const suffixes: string[] = [];

  if (s.indexOf(',') >= 0) {
    const parts = s.split(',');
    last = parts[0]!.trim();
    const rest = parts.slice(1).join(',').trim().split(/\s+/).filter(Boolean);
    while (rest.length && SUFFIX.test(rest[rest.length - 1]!)) {
      suffixes.unshift(rest.pop()!.replace(/\.$/, ''));
    }
    first = rest.shift() || '';
    mids = rest;
  } else {
    const parts = s.split(/\s+/).filter(Boolean);
    while (parts.length && SUFFIX.test(parts[parts.length - 1]!)) {
      suffixes.unshift(parts.pop()!.replace(/\.$/, ''));
    }
    if (parts.length < 2) return s.toUpperCase();
    last = parts.pop()!;
    first = parts.shift() || '';
    mids = parts;
  }

  const mid = mids.map((x) => `${x.charAt(0)}.`).join(' ');
  if (suffixes.length) last = `${last} ${suffixes.join(' ')}`;
  return `${`${first} ${mid}`.trim()} ${last}`.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** The signature-block name re-cased for prose: "MSgt Michael A. Ellsworth". */
export function nameTitleCase(full: string): string {
  const s = sigName(full);
  if (!s) return '';
  const cap = (w: string) =>
    w
      .split(/([-'])/)
      .map((x) => (x === '-' || x === "'" ? x : x.charAt(0) + x.slice(1).toLowerCase()))
      .join('');
  return s
    .split(' ')
    .map((w) => {
      if (/^[A-Z]\.$/.test(w)) return w; // middle initial keeps its capital
      if (/^(II|III|IV|V)$/.test(w)) return w; // generational suffixes are numerals
      return cap(w);
    })
    .join(' ');
}

/**
 * Words a duty title may safely lower-case. Anything not listed stays UPPER,
 * which is the safe default: an unrecognised short token in a duty title is far
 * more often an acronym than a word, and a mangled acronym in a signature block
 * is worse than a shouted word, which is obvious and a one-line fix.
 */
const TITLE_WORDS = new Set(
  (
    'assistant,assurance,aircraft,airman,analyst,apprentice,armament,avionics,chief,' +
    'commander,control,controller,craftsman,deputy,director,electrical,electronic,engineer,enlisted,environmental,' +
    'equipment,expediter,first,flight,group,hydraulic,inspector,instructor,journeyman,lead,leader,maintenance,' +
    'manager,master,mechanic,member,monitor,noncommissioned,officer,operations,planner,production,propulsion,' +
    'quality,resource,safety,scheduler,section,senior,sergeant,shop,specialist,squadron,staff,superintendent,' +
    'supervisor,support,systems,system,technical,technician,training,weapons,wing,work,center,centre,' +
    'programs,program,plans,readiness,logistics,materiel,munitions,fabrication,structural,repair,welder,' +
    'inspection,standardization,evaluation,evaluator,advisor,administrator,coordinator,custodian,driver,' +
    'operator'
  ).split(','),
);

const TITLE_KEEP = new Set([
  'QA', 'NCOIC', 'OIC', 'NCO', 'SNCO', 'CC', 'CCF', 'DO', 'MX', 'MXA', 'AMU', 'AGE', 'TMDE', 'POC', 'CBRN',
  'C4ISR', 'ISR', 'EOD', 'SF', 'CE', 'LRS', 'FSS', 'MXG', 'MXS', 'AMXS', 'CMS', 'EMS', 'RS', 'BS', 'OSS',
  'IT', 'IMDS', 'TBA', 'UDM', 'ADO', 'SEL', 'FS', 'EWO', 'RSO', 'APG', 'HYD', 'E&E', 'JETS', 'AVI', 'CTK',
  'CSS', 'PROD', 'SCR', 'TMA', 'US', 'USAF', 'AFSC', 'DAFSC',
]);

const TITLE_SMALL = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'a', 'an', 'at', 'by', 'on', 'with']);

/**
 * Duty titles print title case with acronyms intact: "NCOIC, Production",
 * "C4ISR Technician". A title that already contains a lower-case letter was
 * typed by a person, and their wording stands untouched.
 */
export function dutyTitle(t: string): string {
  const s = String(t || '').trim();
  if (!s || /[a-z]/.test(s)) return s;
  const cap = (w: string) =>
    w
      .split('-')
      .map((part) => {
        const bare = part.replace(/[^A-Za-z&/]/g, '').toLowerCase();
        return TITLE_WORDS.has(bare) ? part.charAt(0) + part.slice(1).toLowerCase() : part;
      })
      .join('-');
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (/\d/.test(w)) return w; // RC-135, F108, 2A9X4
      const bare = w.replace(/[^A-Za-z&/]/g, '');
      if (TITLE_KEEP.has(bare)) return w;
      if (i && TITLE_SMALL.has(bare.toLowerCase())) return w.toLowerCase();
      return cap(w);
    })
    .join(' ');
}

const SUBJ_SMALL = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'at', 'by', 'in', 'of', 'off', 'on', 'to', 'up', 'via', 'with', 'from', 'into', 'onto', 'over', 'per',
  'as', 'if',
]);

/**
 * Subject lines are title case -- only the "SUBJECT:" label is capitals.
 *
 * A wholly upper-case line is shouted, not a line of acronyms, so it is
 * re-cased. In a mixed-case line an all-caps word IS an acronym and survives
 * exactly as typed, which is what keeps "UIF" and "IN TURN" intact.
 */
export function subjectCase(str: string): string {
  const s = String(str || '').trim();
  if (!s) return '';
  const shouted = s === s.toUpperCase();
  const words = s.split(/\s+/);
  const one = (word: string, first: boolean, last: boolean) =>
    word
      .split('-')
      .map((part, pi) => {
        const bare = part.replace(/[^A-Za-z]/g, '');
        if (!bare) return part;
        if (!shouted && bare.length > 1 && bare === bare.toUpperCase()) return part;
        if ((!first || pi) && !last && SUBJ_SMALL.has(bare.toLowerCase())) return part.toLowerCase();
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join('-');
  return words.map((w, i) => one(w, i === 0, i === words.length - 1)).join(' ');
}

/**
 * The signature block's first line: "JOHN D. SMITH, MSgt, USAF".
 *
 * With no name there is nothing to sign, so the line is empty rather than the
 * ", SSgt, USAF" that a rank on its own would print. That case is real: a LOCAR
 * carries the recipient's signature block from the moment their rank is picked,
 * which is before their name has been typed.
 */
export function sigLine(name: string, rank: string): string {
  const n = sigName(name);
  if (!n) return '';
  const r = sigRank(rank);
  return `${n}${r ? `, ${r}` : ''}, USAF`;
}

/** Filenames come from the subject, so a download is identifiable in a folder. */
export function slugify(s: string, fallback: string): string {
  const out = String(s || '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return out || fallback;
}
