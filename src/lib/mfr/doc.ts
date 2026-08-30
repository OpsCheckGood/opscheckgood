import { MEMO_FORMAT } from '@/lib/data/memoLanguage';
import { DEFAULT_SEAL } from './assets/seal';
import { normalizeParas, subOf, bodyOf, MAX_LEVEL } from './format';
import type { Indorsement, MemoDoc, Para, TailField } from './types';

/**
 * The document: its defaults, its persistence, and the small set of edits the
 * paragraph tree needs.
 *
 * Persistence is `localStorage` and nothing else. People paste real names and
 * real misconduct into this tool; none of it leaves the browser, and the UI
 * says so where they can see it (constraint 2).
 */

export const STORAGE_KEY = 'ocg.mfr.draft';

export function emptyDoc(): MemoDoc {
  return {
    template: 'custom',

    // Letterhead defaults to the one line every DAF memorandum shares. The unit
    // and installation lines start empty because this is a public tool -- there
    // is no "your unit" to prefill, and a wrong one printed on a signed memo is
    // worse than a blank the user has to fill.
    lh1: 'DEPARTMENT OF THE AIR FORCE',
    lh2: '',
    lh3: '',
    lhColor: '#000099',
    // The seal is part of the letterhead, so it is on by default. Clear it and
    // the letterhead prints as three lines of text; upload one and it wins.
    seal: DEFAULT_SEAL,

    font: 'times',
    fontSize: 12,

    prepRank: '',
    prepName: '',
    prepTitle: '',
    prepPost: '',

    memoFor: 'RECORD',
    from: '',
    subject: MEMO_FORMAT.data.sampleSubject,
    paras: MEMO_FORMAT.data.sampleParagraphs.slice(),
    atch: [],
    cc: [],
    distro: [],
    inds: [],

    locarType: 'Counseling',
    locarCat: 'Enlisted',
    locarRecipRank: 'SSgt',
    locarRecipName: '',
    locarDayServed: '',
    locarOtherInfo: '',
    locarOffense: '',
    locarCorrective: '',
    locarUif: 'none',
    locarFrom: '',

    cuiMap: {},
    cuiDesMap: {},
    cuiDesComp: '',
    cuiDesOffice: '',
    cuiDesCat: '',
    cuiDesDist: '',
    cuiDesPoc: '',
  };
}

/**
 * Reads a stored draft over the defaults.
 *
 * Merged key by key rather than replaced wholesale: a draft saved before a
 * field existed still opens, and a corrupted value cannot delete a default the
 * renderers rely on. A blocked or unparseable store just yields the defaults.
 */
export function loadDoc(): MemoDoc {
  const base = emptyDoc();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<MemoDoc>;
    if (!stored || typeof stored !== 'object') return base;
    const merged = { ...base } as Record<string, unknown>;
    for (const [k, v] of Object.entries(stored)) {
      if (v !== undefined && v !== null && k in merged) merged[k] = v;
    }
    return merged as unknown as MemoDoc;
  } catch {
    return base;
  }
}

export function saveDoc(doc: MemoDoc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    /* Private mode, or a full quota: the tool still works, it just forgets. */
  }
}

export function clearDoc(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Nothing to clear if the store is unavailable. */
  }
}

// ---------------------------------------------------------------------------
// Paragraph tree edits
//
// A node is addressed by a path of indices from the root list -- [2] is the
// third paragraph, [2,0] its first sub-paragraph. One set of operations serves
// the basic memorandum and every indorsement, because both are just a Para[].

export type ParaRoot = { kind: 'body' } | { kind: 'ind'; index: number };

function listFor(doc: MemoDoc, root: ParaRoot): Para[] | null {
  if (root.kind === 'ind') {
    const d = doc.inds[root.index];
    return d ? d.paras : null;
  }
  return doc.paras;
}

function walk(list: Para[], path: number[]): { arr: Para[]; idx: number } | null {
  let arr = list;
  for (let d = 0; d < path.length - 1; d++) {
    const sub = subOf(arr[path[d]!]!);
    if (!sub) return null;
    arr = sub;
  }
  return { arr, idx: path[path.length - 1]! };
}

/** Deep-copies the tree so React sees a new object and the edit is undoable. */
function cloneParas(list: Para[]): Para[] {
  return list.map((p) => {
    const sub = subOf(p);
    if (!sub) return Array.isArray(p) ? p.slice() : p;
    return { t: bodyOf(p), sub: cloneParas(sub) };
  });
}

function withList(doc: MemoDoc, root: ParaRoot, next: Para[]): MemoDoc {
  const normalized = normalizeParas(next);
  if (root.kind === 'ind') {
    const inds = doc.inds.slice();
    const d = inds[root.index];
    if (!d) return doc;
    inds[root.index] = { ...d, paras: normalized };
    return { ...doc, inds };
  }
  return { ...doc, paras: normalized };
}

export function setParaText(doc: MemoDoc, root: ParaRoot, path: number[], text: string): MemoDoc {
  const list = listFor(doc, root);
  if (!list) return doc;
  const next = cloneParas(list);
  const w = walk(next, path);
  if (!w) return doc;
  const sub = subOf(w.arr[w.idx]!);
  w.arr[w.idx] = sub ? { t: text, sub } : text;
  return withList(doc, root, next);
}

export function addPara(doc: MemoDoc, root: ParaRoot): MemoDoc {
  const list = listFor(doc, root);
  if (!list) return doc;
  return withList(doc, root, cloneParas(list).concat(''));
}

export function deletePara(doc: MemoDoc, root: ParaRoot, path: number[]): MemoDoc {
  const list = listFor(doc, root);
  if (!list) return doc;
  const next = cloneParas(list);
  const w = walk(next, path);
  if (!w) return doc;
  w.arr.splice(w.idx, 1);
  return withList(doc, root, next);
}

/**
 * Subdivides a paragraph. The first call creates TWO children, because a
 * paragraph cannot be divided into one part -- if there is an a. there must be
 * a b. (AFH 33-337).
 */
export function addSubPara(doc: MemoDoc, root: ParaRoot, path: number[]): MemoDoc {
  if (path.length >= MAX_LEVEL) return doc;
  const list = listFor(doc, root);
  if (!list) return doc;
  const next = cloneParas(list);
  const w = walk(next, path);
  if (!w) return doc;
  const cur = w.arr[w.idx]!;
  const sub = (subOf(cur) || []).slice();
  sub.push('');
  if (sub.length === 1) sub.push('');
  w.arr[w.idx] = { t: bodyOf(cur) || '', sub };
  return withList(doc, root, next);
}

/** Collapses a subdivided paragraph back to plain text, children discarded. */
export function clearSubParas(doc: MemoDoc, root: ParaRoot, path: number[]): MemoDoc {
  const list = listFor(doc, root);
  if (!list) return doc;
  const next = cloneParas(list);
  const w = walk(next, path);
  if (!w) return doc;
  w.arr[w.idx] = bodyOf(w.arr[w.idx]!) || '';
  return withList(doc, root, next);
}

// ---------------------------------------------------------------------------
// The lists below a signature block

export function tailList(doc: MemoDoc, owner: number | null, field: TailField): string[] {
  if (owner === null) return (doc[field] as string[]) || [];
  return (doc.inds[owner]?.[field as 'atch' | 'cc'] as string[]) || [];
}

function setTail(doc: MemoDoc, owner: number | null, field: TailField, next: string[]): MemoDoc {
  if (owner === null) return { ...doc, [field]: next };
  const inds = doc.inds.slice();
  const d = inds[owner];
  if (!d) return doc;
  inds[owner] = { ...d, [field]: next };
  return { ...doc, inds };
}

export function addTail(doc: MemoDoc, owner: number | null, field: TailField): MemoDoc {
  return setTail(doc, owner, field, tailList(doc, owner, field).concat(''));
}

export function setTailItem(
  doc: MemoDoc,
  owner: number | null,
  field: TailField,
  index: number,
  value: string,
): MemoDoc {
  const next = tailList(doc, owner, field).slice();
  next[index] = value;
  return setTail(doc, owner, field, next);
}

export function deleteTail(doc: MemoDoc, owner: number | null, field: TailField, index: number): MemoDoc {
  return setTail(
    doc,
    owner,
    field,
    tailList(doc, owner, field).filter((_, i) => i !== index),
  );
}

// ---------------------------------------------------------------------------
// Indorsements

export function newIndorsement(existing: number): Indorsement {
  // The first indorsement follows a page break by construction, so it takes the
  // separate-page form; later ones flow underneath and take the same-page one.
  return { form: existing ? 'own' : 'ref', paras: [''], atch: [], cc: [] };
}
