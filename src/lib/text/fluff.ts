import type { AbbreviationTable } from '../data/abbreviations';
import type { FluffData, FluffSeverity, WeakOpener } from '../data/types';
import { findAcronyms } from './analyze';
import { splitLines } from './tokenize';

/**
 * Fluff Patrol: the performance-statement quality checks.
 *
 * Reads the draft the shaper reads, one bullet per line, and comes back with
 * questions rather than verdicts. Everything here is deterministic pattern
 * matching against the rule set in src/data/vocab/fluff.json: no model, no
 * network, no guess about whether a claim is true. A finding says what was
 * matched, why that wording tends to weaken a statement, and what to ask
 * yourself; the writer decides.
 *
 * Six checks, all configurable through the data file:
 *
 *   - fluff words and phrases, by category and severity, longest match first
 *     so "participated in" is one finding and not two;
 *   - duty language, which is a category of the same dictionary;
 *   - Action-Result-Impact-Scope signals per bullet: heuristic indicators,
 *     never a score, and never all four required;
 *   - number style: a bare number with nothing it counts, a number glued to
 *     its unit, a dollar figure without separators, doubled symbols, and
 *     mixed percent or currency styles across the package;
 *   - readability: sentence length, semicolons, slashes, parentheticals,
 *     acronym density and a passive-voice heuristic;
 *
 * The Review panel already covers repeats, weak openers, missing numbers and
 * unknown acronyms, so none of those are repeated here.
 */

export type PatrolKind = 'fluff' | 'number' | 'readability';

export interface PatrolFinding {
  kind: PatrolKind;
  /** Category id from the rule set, or a check id for number/readability. */
  category: string;
  /** Human label for the category. */
  label: string;
  severity: FluffSeverity;
  /** The matched text as it appears in the draft. */
  token: string;
  /** Zero-based draft line. */
  line: number;
  /** Character offsets into the whole draft. */
  start: number;
  end: number;
  /** Why this wording tends to weaken a statement. */
  why: string;
  /** The question to ask, or the change to consider. */
  ask: string;
  /** Alternatives, when the rule set names any. */
  try: string[];
  /** Stable across edits elsewhere in the draft; used to dismiss. */
  key: string;
}

export type Indicator = 'detected' | 'possibly-missing';

export interface LineSignals {
  line: number;
  action: Indicator;
  result: Indicator;
  impact: Indicator;
  scope: Indicator;
  /** What each detected indicator matched, for a tooltip. */
  evidence: { action?: string; result?: string; impact?: string; scope?: string };
  words: number;
  acronyms: number;
}

export interface PatrolReport {
  findings: PatrolFinding[];
  lines: LineSignals[];
}

export interface PatrolSources {
  fluff: FluffData;
  hq: AbbreviationTable;
  common: AbbreviationTable;
  weakOpeners: readonly WeakOpener[];
  /** Base -> past for irregular verbs, so "led" and "drove" read as actions. */
  irregularPast: Readonly<Record<string, string>>;
}

const LEAD = /^\s*(?:--|-|–|—|•|\*)?\s*/;
const WORD = /[A-Za-z][A-Za-z'’-]*/g;

export const SEVERITY_LABEL: Record<FluffSeverity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_RANK: Record<FluffSeverity, number> = { high: 0, medium: 1, low: 2 };

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A phrase as a word-boundary pattern, with any whitespace or hyphen between its words. */
function phrasePattern(term: string): RegExp {
  const parts = term.split(/[\s-]+/).map(escapeRegExp);
  return new RegExp(`(?<![A-Za-z])${parts.join('[\\s-]+')}(?![A-Za-z])`, 'gi');
}

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

interface Compiled {
  term: string;
  words: number;
  pattern: RegExp;
  category: string;
  severity: FluffSeverity;
  try: string[];
}

const compiledCache = new WeakMap<FluffData, Compiled[]>();

/** Longest phrases first, so a phrase claims its span before its words can. */
function compile(data: FluffData): Compiled[] {
  let list = compiledCache.get(data);
  if (!list) {
    list = data.terms
      .map((t) => ({
        term: t.term,
        words: t.term.split(/[\s-]+/).length,
        pattern: phrasePattern(t.term),
        category: t.category,
        severity: t.severity ?? data.categories[t.category]!.severity,
        try: t.try ?? [],
      }))
      .sort((a, b) => b.words - a.words || b.term.length - a.term.length);
    compiledCache.set(data, list);
  }
  return list;
}

function overlaps(taken: Array<[number, number]>, start: number, end: number): boolean {
  return taken.some(([s, e]) => start < e && end > s);
}

// ---------------------------------------------------------------------------
// Fluff dictionary
// ---------------------------------------------------------------------------

function fluffFindings(
  line: string,
  index: number,
  base: number,
  data: FluffData,
): PatrolFinding[] {
  const out: PatrolFinding[] = [];
  const taken: Array<[number, number]> = [];
  for (const rule of compile(data)) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (overlaps(taken, start, end)) continue;
      taken.push([start, end]);
      const category = data.categories[rule.category]!;
      out.push({
        kind: 'fluff',
        category: rule.category,
        label: category.label,
        severity: rule.severity,
        token: match[0],
        line: index,
        start: base + start,
        end: base + end,
        why: category.why,
        ask: category.ask,
        try: rule.try,
        key: `fluff:${rule.term}:${index}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Action - Result - Impact - Scope
// ---------------------------------------------------------------------------

/** Whether a word reads as a past-tense action: -ed, or a known irregular past. */
function looksLikeAction(word: string, sources: PatrolSources): boolean {
  const lower = word.toLowerCase();
  if (sources.weakOpeners.some((w) => w.word === lower)) return false;
  if (/[a-z]ed$/.test(lower) && lower.length > 3) return true;
  return Object.values(sources.irregularPast).includes(lower);
}

function firstMatch(line: string, words: readonly string[]): string | undefined {
  for (const word of words) {
    const m = phrasePattern(word).exec(line);
    if (m) return m[0];
  }
  return undefined;
}

function signalsFor(line: string, index: number, sources: PatrolSources): LineSignals {
  const { signals } = sources.fluff;
  const lead = LEAD.exec(line)?.[0].length ?? 0;
  const body = line.slice(lead);
  const opener = /^[A-Za-z][A-Za-z'’-]*/.exec(body)?.[0];

  const evidence: LineSignals['evidence'] = {};
  if (opener && looksLikeAction(opener, sources)) evidence.action = opener;

  const number = /\d[\d,.]*%?|\$[\d,.]+[KMB]?\b/.exec(body)?.[0];
  const resultWord = firstMatch(body, signals.result);
  if (number) evidence.result = number;
  else if (resultWord) evidence.result = resultWord;

  const impact = firstMatch(body, signals.impact);
  if (impact) evidence.impact = impact;

  // Scope: a number followed within two words by something it counts, a
  // scope noun anywhere, or a money figure.
  const counted = /\d[\d,.]*\+?\s*(?:[A-Za-z-]+\s+)?([A-Za-z][A-Za-z-]+)/g;
  let scope: string | undefined;
  for (const m of body.matchAll(counted)) {
    if (signals.scope.includes(m[1]!.toLowerCase())) {
      scope = m[0];
      break;
    }
  }
  scope ??= /\$[\d,.]+[KMB]?\b|\b\d[\d,.]*[KMB]\b/.exec(body)?.[0] ?? firstMatch(body, signals.scope);
  if (scope) evidence.scope = scope;

  const words = (body.match(WORD) ?? []).length;
  const acronyms = findAcronyms(body, sources.hq, sources.common).length;

  const flag = (v: string | undefined): Indicator => (v ? 'detected' : 'possibly-missing');
  return {
    line: index,
    action: flag(evidence.action),
    result: flag(evidence.result),
    impact: flag(evidence.impact),
    scope: flag(evidence.scope),
    evidence,
    words,
    acronyms,
  };
}

// ---------------------------------------------------------------------------
// Number style
// ---------------------------------------------------------------------------

function numberFindings(
  line: string,
  index: number,
  base: number,
  data: FluffData,
): PatrolFinding[] {
  const out: PatrolFinding[] = [];
  const push = (
    category: string,
    label: string,
    severity: FluffSeverity,
    m: RegExpMatchArray,
    why: string,
    ask: string,
  ) =>
    out.push({
      kind: 'number',
      category,
      label,
      severity,
      token: m[0],
      line: index,
      start: base + m.index!,
      end: base + m.index! + m[0].length,
      why,
      ask,
      try: [],
      key: `number:${category}:${m[0].toLowerCase()}:${index}`,
    });

  // A number with nothing after it: end of line, or punctuation next.
  for (const m of line.matchAll(/(?<![\w$.,])(\d[\d,]*(?:\.\d+)?)(?=\s*(?:[;:,.)]|--|$))/g)) {
    push('bare-number', 'Bare number', 'medium', m,
      'a number with nothing it counts',
      `${m[0]} of what? Name what was counted.`);
  }
  // A number glued to a unit: 24hrs.
  const units = data.units.map(escapeRegExp).join('|');
  for (const m of line.matchAll(new RegExp(`\\b\\d[\\d,.]*(?:${units})\\b`, 'gi'))) {
    push('unit-spacing', 'Unit spacing', 'low', m,
      'a number run into its unit',
      `Consider a space between the number and the unit, e.g. "${m[0].replace(/^(\d[\d,.]*)/, '$1 ')}".`);
  }
  // $120000: five or more digits with no separator.
  for (const m of line.matchAll(/\$\d{5,}(?![\d,])/g)) {
    const digits = m[0].slice(1);
    push('currency-separators', 'Currency style', 'low', m,
      'a dollar figure without separators',
      `Consider "$${Number(digits).toLocaleString('en-US')}" or a K/M form.`);
  }
  // Doubled symbols.
  for (const m of line.matchAll(/\${2,}\d|\d%{2,}/g)) {
    push('doubled-symbol', 'Doubled symbol', 'medium', m,
      'a repeated currency or percent sign',
      'Keep one symbol.');
  }
  return out;
}

/** Style choices that only show as inconsistent across the whole draft. */
function packageNumberFindings(
  lines: readonly string[],
  starts: readonly number[],
): PatrolFinding[] {
  const out: PatrolFinding[] = [];
  const first = (re: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]!);
      if (m) return { m, i };
    }
    return null;
  };
  const percentWord = first(/\b\d[\d,.]*\s*percent\b/i);
  const percentSign = first(/\d%/);
  if (percentWord && percentSign) {
    out.push({
      kind: 'number',
      category: 'percent-style',
      label: 'Percent style',
      severity: 'low',
      token: percentWord.m[0],
      line: percentWord.i,
      start: starts[percentWord.i]! + percentWord.m.index!,
      end: starts[percentWord.i]! + percentWord.m.index! + percentWord.m[0].length,
      why: 'both "percent" and "%" appear in this draft',
      ask: 'Use one percent style throughout.',
      try: [],
      key: `number:percent-style:${percentWord.i}`,
    });
  }
  const dollar = first(/\$\d/);
  const bareK = first(/(?<![$\d])\b\d[\d,.]*[KMB]\b/);
  if (dollar && bareK) {
    out.push({
      kind: 'number',
      category: 'currency-style',
      label: 'Currency style',
      severity: 'low',
      token: bareK.m[0],
      line: bareK.i,
      start: starts[bareK.i]! + bareK.m.index!,
      end: starts[bareK.i]! + bareK.m.index! + bareK.m[0].length,
      why: 'dollar figures and bare K/M figures are both used in this draft',
      ask: 'Use one currency style throughout, e.g. "$125K".',
      try: [],
      key: `number:currency-style:${bareK.i}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------

function readabilityFindings(
  line: string,
  index: number,
  base: number,
  signals: LineSignals,
  data: FluffData,
): PatrolFinding[] {
  const out: PatrolFinding[] = [];
  const t = data.thresholds;
  const lead = LEAD.exec(line)?.[0].length ?? 0;
  const whole = (category: string, label: string, severity: FluffSeverity, token: string, why: string, ask: string) =>
    out.push({
      kind: 'readability',
      category,
      label,
      severity,
      token,
      line: index,
      start: base + lead,
      end: base + line.length,
      why,
      ask,
      try: [],
      key: `readability:${category}:${index}`,
    });

  if (signals.words >= t.sentenceWords) {
    whole('long-sentence', 'Length', 'low', `${signals.words} words`,
      'a long run of words in one statement', 'Consider splitting this statement.');
  }
  const semicolons = (line.match(/;/g) ?? []).length;
  if (semicolons >= t.semicolons) {
    whole('semicolons', 'Punctuation', 'low', `${semicolons} semicolons`,
      'stacked clauses', `This statement contains ${semicolons} semicolons; simplify if possible.`);
  }
  const slashes = (line.match(/\//g) ?? []).length;
  if (slashes >= t.slashes) {
    whole('slashes', 'Punctuation', 'low', `${slashes} slashes`,
      'slashes stand in for words', 'Consider spelling out what each slash joins.');
  }
  const parens = (line.match(/\(/g) ?? []).length;
  if (parens >= t.parentheticals) {
    whole('parentheticals', 'Punctuation', 'low', `${parens} parentheticals`,
      'asides interrupt the statement', 'Consider folding the asides into the sentence or dropping them.');
  }
  if (signals.acronyms >= t.acronyms) {
    whole('acronym-density', 'Acronyms', 'medium', `${signals.acronyms} acronyms`,
      'acronym-heavy statements read slowly', `This statement contains ${signals.acronyms} acronyms. Consider whether each earns its place.`);
  }
  const passive = /\b(?:was|were|is|are|been|being)\s+(?:[a-z]+ly\s+)?[a-z]+(?:ed|en)\b/i.exec(line);
  if (passive) {
    out.push({
      kind: 'readability',
      category: 'passive',
      label: 'Passive voice',
      severity: 'low',
      token: passive[0],
      line: index,
      start: base + passive.index,
      end: base + passive.index + passive[0].length,
      why: 'may be passive voice, which hides who acted (a heuristic, not a parse)',
      ask: 'Consider leading with the member and the action.',
      try: [],
      key: `readability:passive:${index}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

export function patrol(text: string, sources: PatrolSources): PatrolReport {
  const lines = splitLines(text);
  const starts = lineStarts(lines);
  const findings: PatrolFinding[] = [];
  const signals: LineSignals[] = [];

  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const base = starts[i]!;
    const lineSignals = signalsFor(line, i, sources);
    signals.push(lineSignals);
    findings.push(
      ...fluffFindings(line, i, base, sources.fluff),
      ...numberFindings(line, i, base, sources.fluff),
      ...readabilityFindings(line, i, base, lineSignals, sources.fluff),
    );
  });
  findings.push(...packageNumberFindings(lines, starts));

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.start - b.start,
  );
  return { findings, lines: signals };
}

/** Counts by severity, for the panel header. */
export function tally(findings: readonly PatrolFinding[]): Record<FluffSeverity, number> {
  const counts: Record<FluffSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
