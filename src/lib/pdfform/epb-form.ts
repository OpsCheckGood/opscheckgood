import type { EpbData } from '../data/epb';
import { characterLabel, count, normalizeText, type Draft } from '../epb/worksheet';
import {
  HEADER_BAND,
  MUTED,
  PANEL,
  branding,
  buildFormPdf,
  measure,
  standardHeader,
  type Field,
  type FormDocument,
  type FormPage,
  type StaticText,
} from './writer';
import { documentTitle } from './version';

/**
 * The EPB Worksheet as a fillable PDF.
 *
 * One page of boxes in the order myEval takes them -- the duty description,
 * the four major performance areas with their definitions and the Airman
 * Leadership Qualities printed under each, and the higher level reviewer
 * assessment -- with a counter beside every box that reads "n remaining"
 * as you type and "n over" once you pass the limit. Page 2 is the
 * workbench: an open scratch area with a running character count, for
 * drafting before a statement is cut to fit.
 *
 * The counters are driven from a keystroke action, so they move with every
 * key rather than waiting for the box to lose focus, and from a calculate
 * action so they are right after a paste, a fill, or a reopened file.
 */

const TOOL = 'EPB Worksheet';
const SUBTITLE = 'Enlisted Performance Brief drafting worksheet: every box counted to the limit myEval enforces';

/** The field that counts a box. */
export const counterName = (id: string) => `${id}_count`;
export const WORKBENCH = 'workbench';
export const WORKBENCH_COUNT = counterName(WORKBENCH);

/** The page's draft as the form's field values, counters included so a filled file opens already counted. */
export function epbFieldValues(draft: Draft, data: EpbData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const s of data.sections) {
    const text = normalizeText(draft[s.id] ?? '');
    values[s.id] = text;
    values[counterName(s.id)] = count(text, s.limit).label;
  }
  values[WORKBENCH] = normalizeText(draft[WORKBENCH] ?? '');
  values[WORKBENCH_COUNT] = characterLabel(values[WORKBENCH]);
  return values;
}

/**
 * The document-level script. ES5 only: Acrobat's engine.
 *
 * `merge` is what the value will be once the keystroke lands: the field's
 * value with the typed or pasted text put over the selection. Acrobat's
 * form library has a function for this, but a file should not depend on
 * one being loaded.
 */
export function epbEngineSource(data: EpbData): string {
  const limits = JSON.stringify(Object.fromEntries(data.sections.map((s) => [s.id, s.limit])));
  return `
var OCG = (function () {
  var LIMITS = ${limits};
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function normalize(s) { return str(s).replace(/\\r\\n?/g, '\\n'); }
  function length(s) { return normalize(s).length; }
  function label(text, limit) {
    var left = limit - length(text);
    return left >= 0 ? left + ' remaining' : (-left) + ' over';
  }
  function characters(text) {
    var n = length(text);
    return n + ' character' + (n === 1 ? '' : 's');
  }
  function merge(e) {
    if (e.willCommit) return str(e.value);
    var v = str(e.value), s = e.selStart, t = e.selEnd;
    if (typeof s !== 'number' || typeof t !== 'number') return v + str(e.change);
    return v.substring(0, s) + str(e.change) + v.substring(t);
  }
  function text(doc, name) {
    var f = doc.getField(name);
    return f ? str(f.value) : '';
  }
  function set(doc, name, value) {
    var f = doc.getField(name);
    if (f && str(f.value) !== value) f.value = value;
  }
  /** Keystroke action of a counted box: the counter moves with the key. */
  function live(doc, e, id) {
    var limit = LIMITS[id];
    set(doc, id + '_count', limit ? label(merge(e), limit) : characters(merge(e)));
  }
  /** Calculate action of a counter: right after a paste, a fill or a reopen. */
  function calc(doc, id) {
    var limit = LIMITS[id];
    return limit ? label(text(doc, id), limit) : characters(text(doc, id));
  }
  return { label: label, characters: characters, merge: merge, live: live, calc: calc, length: length };
})();
try { this.calculateNow(); } catch (e) {}
`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 54;
const WIDTH = PAGE_W - 2 * LEFT;
const BAND_H = 15;
const COUNTER_W = 92;
const BOTTOM = 48;

/** Greedy wrap by measured width. */
function wrap(text: string, font: StaticText['font'], size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(font, candidate, size) <= width || line === '') line = candidate;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Lines the box needs for its limit at the field's size, with one to spare for going over. */
function boxHeight(limit: number, size: number): number {
  const perLine = Math.floor(WIDTH / (size * 0.5));
  const lines = Math.ceil(limit / perLine) + 1;
  return Math.round(lines * size * 1.15 + 6);
}

function heading(page: FormPage, y: number, note: string) {
  page.texts.push({ x: LEFT, y, text: TOOL.toUpperCase(), font: 'HeBo', size: 9, gray: 0 });
  page.texts.push({ x: LEFT, y: y - 11, text: note, font: 'Helv', size: 7.5, color: MUTED });
}

/**
 * A counted box: its title band with the counter in it, the definition and
 * the qualities under the band, then the field. Returns the y it ends at.
 */
function box(page: FormPage, top: number, id: string, title: string, limit: number | null, description: string, qualities: { name: string; text: string }[], fieldH: number, tooltip: string): number {
  let y = top;
  page.fills!.push({ x: LEFT, y: y - BAND_H, w: WIDTH, h: BAND_H, color: PANEL });
  page.texts.push({ x: LEFT + 6, y: y - 10.5, text: title.toUpperCase(), font: 'HeBo', size: 7.5, gray: 0 });
  if (limit !== null) {
    page.texts.push({ x: LEFT + 6 + measure('HeBo', title.toUpperCase(), 7.5) + 6, y: y - 10.5, text: `${limit} CHARACTERS`, font: 'Helv', size: 6.5, color: MUTED });
  }
  page.fields.push({
    name: counterName(id),
    kind: 'output',
    rect: [LEFT + WIDTH - COUNTER_W - 2, y - BAND_H + 1.5, COUNTER_W, BAND_H - 3],
    font: 'HeBo',
    size: 7.5,
    align: 'right',
    plain: true,
    value: limit !== null ? `${limit} remaining` : '0 characters',
    calculate: `event.value = OCG.calc(this, '${id}');`,
  });
  y -= BAND_H + 3;
  if (description) {
    for (const line of wrap(description, 'Helv', 7, WIDTH - 4)) {
      page.texts.push({ x: LEFT + 2, y: y - 7, text: line, font: 'Helv', size: 7, gray: 0.15 });
      y -= 8.6;
    }
  }
  for (const q of qualities) {
    const name = `${q.name.toUpperCase()}: `;
    const nameW = measure('HeBo', name, 6.5);
    const lines = wrap(q.text, 'Helv', 6.5, WIDTH - 4 - nameW);
    page.texts.push({ x: LEFT + 2, y: y - 6.5, text: name, font: 'HeBo', size: 6.5, color: MUTED });
    for (const line of lines) {
      page.texts.push({ x: LEFT + 2 + nameW, y: y - 6.5, text: line, font: 'Helv', size: 6.5, color: MUTED });
      y -= 8;
    }
  }
  y -= 2;
  page.fields.push({
    name: id,
    kind: 'multiline',
    rect: [LEFT, y - fieldH, WIDTH, fieldH],
    font: 'Helv',
    size: 9,
    tooltip,
    maxLen: limit !== null ? limit + 100 : undefined,
    onKeystroke: `OCG.live(this, event, '${id}');`,
  });
  return y - fieldH;
}

export function buildEpbForm(data: EpbData): FormDocument {
  const mark = branding(PAGE_W);

  // ---- Page 1: the brief ---------------------------------------------------
  const p1: FormPage = { texts: [], rules: [], fields: [], links: [], fills: [] };
  standardHeader(p1, PAGE_W, PAGE_H, TOOL, SUBTITLE);
  heading(p1, PAGE_H - HEADER_BAND - 14, 'Draft each box to its limit. The counter beside it moves as you type and reads "over" once you pass the limit. Page 2 is a scratch area.');
  let y = PAGE_H - HEADER_BAND - 36;
  const calcOrder: string[] = [];
  const gap = 7;
  for (const s of data.sections) {
    const fieldH = boxHeight(s.limit, 9);
    y = box(p1, y, s.id, s.title, s.limit, s.description, s.qualities, fieldH, `${s.title}: up to ${s.limit} characters.`) - gap;
    calcOrder.push(counterName(s.id));
  }
  if (y < BOTTOM) throw new Error(`EPB Worksheet page 1 overflows by ${BOTTOM - y}pt`);
  p1.texts.push(...mark.texts);
  p1.links.push(...mark.links);

  // ---- Page 2: the workbench ------------------------------------------------
  const p2: FormPage = { texts: [], rules: [], fields: [], links: [], fills: [] };
  standardHeader(p2, PAGE_W, PAGE_H, TOOL, SUBTITLE);
  heading(p2, PAGE_H - HEADER_BAND - 14, 'Room to draft before a statement is cut to fit. Nothing here has a limit; the count is for reference.');
  const top = PAGE_H - HEADER_BAND - 36;
  box(p2, top, WORKBENCH, 'Workbench', null, '', [], top - BAND_H - 5 - BOTTOM, 'Scratch space: no limit.');
  calcOrder.push(WORKBENCH_COUNT);
  p2.texts.push(...mark.texts);
  p2.links.push(...mark.links);

  return {
    title: documentTitle(TOOL),
    subject: 'Enlisted Performance Brief drafting worksheet with a character counter on every box.',
    pages: [p1, p2],
    script: epbEngineSource(data),
    calcOrder,
  };
}

export function buildEpbFormPdf(data: EpbData): Uint8Array {
  return buildFormPdf(buildEpbForm(data));
}

/** Every field a filled download sets, in page order. */
export function epbFieldNames(data: EpbData): string[] {
  const names: string[] = [];
  for (const s of data.sections) names.push(s.id, counterName(s.id));
  names.push(WORKBENCH, WORKBENCH_COUNT);
  return names;
}

export type { Field };
