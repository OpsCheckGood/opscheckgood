import { describe, it, expect } from 'vitest';
import { EPB } from '@/lib/data/epb';
import { characterLabel, count, emptyDraft, isEmpty, worksheetText } from '@/lib/epb/worksheet';
import { buildEpbFormPdf, counterName, epbEngineSource, epbFieldNames, epbFieldValues, WORKBENCH_COUNT } from '@/lib/pdfform/epb-form';
import { epbWorksheetPdf } from '@/lib/pdfform/downloads';
import { PdfDocument } from '@/lib/pdf/document';
import { PdfName, PdfRef, PdfString, type PdfDict } from '@/lib/pdf/objects';

const data = EPB.data;

interface Engine {
  label(text: string, limit: number): string;
  characters(text: string): string;
  merge(e: { value: string; change: string; selStart?: number; selEnd?: number; willCommit: boolean }): string;
  live(doc: unknown, e: unknown, id: string): void;
  calc(doc: unknown, id: string): string;
}

/** The PDF's script, evaluated under Node with a stand-in for the document. */
function engine(): Engine {
  const src = epbEngineSource(data);
  return new Function(`${src}\nreturn OCG;`).call({ calculateNow() {} }) as Engine;
}

function docOf(values: Record<string, string>) {
  return {
    values,
    getField(name: string) {
      const v = values;
      return name in v
        ? {
            get value() { return v[name]; },
            set value(x: string) { v[name] = x; },
          }
        : null;
    },
  };
}

describe('the worksheet dataset', () => {
  it('holds the six boxes myEval takes, in order, with their limits', () => {
    expect(data.sections.map((s) => [s.id, s.limit])).toEqual([
      ['duty', 450], ['executing', 350], ['leading', 350], ['managing', 350], ['improving', 350], ['hlr', 250],
    ]);
    const areas = data.sections.filter((s) => s.qualities.length > 0);
    expect(areas.map((s) => s.qualities.length)).toEqual([3, 3, 2, 2]);
    for (const s of areas) expect(s.description).not.toBe('');
  });
});

describe('the count', () => {
  it('reads remaining, zero and over, spaces included', () => {
    expect(count('', 350).label).toBe('350 remaining');
    expect(count('a b', 350)).toMatchObject({ length: 3, remaining: 347, over: false });
    expect(count('x'.repeat(350), 350)).toMatchObject({ remaining: 0, label: '0 remaining', over: false });
    expect(count('x'.repeat(353), 350)).toMatchObject({ remaining: -3, label: '3 over', over: true });
  });

  it('counts a Windows line ending as one character', () => {
    expect(count('a\r\nb', 10).length).toBe(3);
    expect(characterLabel('a\r\nb')).toBe('3 characters');
    expect(characterLabel('')).toBe('0 characters');
    expect(characterLabel('x')).toBe('1 character');
  });

  it('never says anything but the count', () => {
    for (const n of [0, 1, 349, 350, 351]) {
      expect(count('x'.repeat(n), 350).label).toMatch(/^\d+ (remaining|over)$/);
    }
  });

  it('copies the filled boxes under their headings', () => {
    const draft = { ...emptyDraft(data), executing: 'Did the thing.', hlr: 'Best.' };
    expect(isEmpty(emptyDraft(data))).toBe(true);
    expect(isEmpty(draft)).toBe(false);
    expect(worksheetText(data, draft)).toBe('EXECUTING THE MISSION (336 remaining)\nDid the thing.\n\nHIGHER LEVEL REVIEWER ASSESSMENT (245 remaining)\nBest.');
  });
});

describe("the PDF's script agrees with the site", () => {
  const ocg = engine();

  it('labels the same way', () => {
    for (const s of data.sections) {
      for (const n of [0, 1, s.limit - 1, s.limit, s.limit + 1, s.limit + 40]) {
        const text = 'ab '.repeat(Math.ceil(n / 3)).slice(0, n);
        expect(ocg.label(text, s.limit)).toBe(count(text, s.limit).label);
      }
    }
    expect(ocg.characters('a\r\nb')).toBe(characterLabel('a\r\nb'));
    expect(ocg.characters('')).toBe('0 characters');
  });

  it('merges a keystroke the way Acrobat will apply it', () => {
    expect(ocg.merge({ value: 'abc', change: 'X', selStart: 1, selEnd: 2, willCommit: false })).toBe('aXc');
    expect(ocg.merge({ value: 'abc', change: '', selStart: 0, selEnd: 3, willCommit: false })).toBe('');
    expect(ocg.merge({ value: 'abc', change: 'd', willCommit: false })).toBe('abcd');
    expect(ocg.merge({ value: 'final', change: 'ignored', selStart: 0, selEnd: 0, willCommit: true })).toBe('final');
  });

  it('moves the counter on a keystroke and settles it on calculate', () => {
    const doc = docOf({ executing: 'x'.repeat(348), [counterName('executing')]: '', workbench: 'hi', [WORKBENCH_COUNT]: '' });
    ocg.live(doc, { value: doc.values.executing, change: 'yyy', selStart: 348, selEnd: 348, willCommit: false }, 'executing');
    expect(doc.values[counterName('executing')]).toBe('1 over');
    expect(ocg.calc(doc, 'executing')).toBe('2 remaining');
    ocg.live(doc, { value: 'hi', change: '!', selStart: 2, selEnd: 2, willCommit: false }, 'workbench');
    expect(doc.values[WORKBENCH_COUNT]).toBe('3 characters');
    expect(ocg.calc(doc, 'workbench')).toBe('2 characters');
  });

  it('carries the page draft into the fields with its counts', () => {
    const values = epbFieldValues({ ...emptyDraft(data), duty: 'Lead.\r\nTwo lines.', workbench: 'note' }, data);
    expect(values.duty).toBe('Lead.\nTwo lines.');
    expect(values[counterName('duty')]).toBe('434 remaining');
    expect(values[counterName('leading')]).toBe('350 remaining');
    expect(values[WORKBENCH_COUNT]).toBe('4 characters');
    expect(Object.keys(values).sort()).toEqual(epbFieldNames(data).sort());
  });
});

async function inspect(bytes: Uint8Array) {
  const doc = await PdfDocument.open(bytes);
  const catalog = await doc.catalog();
  const acro = (await doc.resolve(catalog.get('AcroForm'))) as PdfDict;
  const fields = new Map<string, PdfDict>();
  for (const ref of (await doc.resolve(acro.get('Fields'))) as PdfRef[]) {
    const f = (await doc.resolve(ref)) as PdfDict;
    fields.set((f.get('T') as PdfString).text, f);
  }
  const value = (name: string) => {
    const v = fields.get(name)?.get('V');
    return v instanceof PdfString ? v.text : '';
  };
  const names = (await doc.resolve(catalog.get('Names'))) as PdfDict;
  const tree = (await doc.resolve(names.get('JavaScript'))) as PdfDict;
  const entries = (await doc.resolve(tree.get('Names'))) as unknown[];
  const action = (await doc.resolve(entries[1] as PdfRef)) as PdfDict;
  const script = new TextDecoder('latin1').decode((await doc.streamOf(action.get('JS')))!);
  const pages = (await doc.resolve(((await doc.resolve(catalog.get('Pages'))) as PdfDict).get('Kids'))) as PdfRef[];
  const perPage: string[] = [];
  const links: string[] = [];
  for (const pageRef of pages) {
    const page = (await doc.resolve(pageRef)) as PdfDict;
    perPage.push(new TextDecoder('latin1').decode((await doc.streamOf(page.get('Contents') as PdfRef)) ?? new Uint8Array()));
    for (const a of ((await doc.resolve(page.get('Annots'))) as PdfRef[]) ?? []) {
      const annot = (await doc.resolve(a)) as PdfDict;
      if ((annot.get('Subtype') as PdfName).name === 'Link') {
        links.push(((((await doc.resolve(annot.get('A'))) as PdfDict).get('URI')) as PdfString).text);
      }
    }
  }
  const info = (await doc.resolve(doc.trailer.get('Info'))) as PdfDict;
  const infoText = [...info.values()].map((v) => (v instanceof PdfString ? v.text : '')).join(' ');
  return { doc, fields, value, script, perPage, links, infoText };
}

describe('the EPB Worksheet PDF', () => {
  it('is two pages of counted boxes with the family header and footer', async () => {
    const r = await inspect(buildEpbFormPdf(data));
    expect(r.perPage).toHaveLength(2);
    expect(r.perPage[0]).toContain('(EPB WORKSHEET)');
    expect(r.perPage[0]).toContain('(EXECUTING THE MISSION)');
    expect(r.perPage[0]).toContain('(JOB PROFICIENCY: )');
    expect(r.perPage[1]).toContain('(WORKBENCH)');
    for (const page of r.perPage) expect(page).toMatch(/\(opscheckgood\.github\.io\/opscheckgood   CAO \d+ [A-Z]{3} \d{4}\)/);
    expect(r.links.filter((l) => l === 'https://opscheckgood.github.io/opscheckgood/')).toHaveLength(2);
    expect(r.infoText).toContain('Ops Check Good - EPB Worksheet - fillable PDF builder');
    for (const name of epbFieldNames(data)) expect(r.fields.has(name), name).toBe(true);
    // Blank, every counter already reads the whole limit.
    expect(r.value(counterName('duty'))).toBe('450 remaining');
    expect(r.value(WORKBENCH_COUNT)).toBe('0 characters');
    expect(r.value('duty')).toBe('');
    // A keystroke action on every box, a calculate action on every counter.
    for (const s of data.sections) {
      const aa = (await r.doc.resolve(r.fields.get(s.id)!.get('AA'))) as PdfDict;
      expect(aa.has('K'), s.id).toBe(true);
      const ca = (await r.doc.resolve(r.fields.get(counterName(s.id))!.get('AA'))) as PdfDict;
      expect(ca.has('C'), s.id).toBe(true);
      expect(r.fields.get(s.id)!.get('MaxLen')).toBe(s.limit + 100);
    }
    expect(r.script).toContain('var OCG = (function ()');
  });

  it('never celebrates a full box, and names nobody', () => {
    const text = new TextDecoder('latin1').decode(buildEpbFormPdf(data));
    expect(text).not.toMatch(/yahtzee/i);
    expect(text).not.toMatch(/hansen|torres|373 TRS|82 RS/i);
  });

  it('downloads locked, blank or with the page entries and their counts', async () => {
    const blank = await inspect(await epbWorksheetPdf(null, data));
    expect(blank.doc.encrypted).toBe(true);
    expect(blank.value('executing')).toBe('');
    const filled = await inspect(await epbWorksheetPdf({ ...emptyDraft(data), executing: 'x'.repeat(360), hlr: 'Top performer.' }, data));
    expect(filled.doc.encrypted).toBe(true);
    expect(filled.value('executing')).toBe('x'.repeat(360));
    expect(filled.value(counterName('executing'))).toBe('10 over');
    expect(filled.value(counterName('hlr'))).toBe('236 remaining');
    expect(filled.value(counterName('leading'))).toBe('350 remaining');
  });
});
