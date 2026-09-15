import { describe, it, expect } from 'vitest';
import { CEREMONY } from '@/lib/data/ceremony';
import { buildScript, emptyInput, type CeremonyInput } from '@/lib/promotion/ceremony';
import { PF, promotionEngineSource, promotionFieldValues } from '@/lib/pdfform/promotion-form';
import { ptCalculatorPdf, promotionBuilderPdf, decorationBuilderPdf } from '@/lib/pdfform/downloads';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';
import { PdfDocument } from '@/lib/pdf/document';
import { PdfName, PdfRef, PdfString, type PdfDict } from '@/lib/pdf/objects';
import { base64 as promotionBase64 } from '@/lib/pdfform/embedded/promotion-script';
import { base64 as ptBase64 } from '@/lib/pdfform/embedded/pt-calculator';
import { decodeBase64 } from '@/lib/metrics/registry';

const data = CEREMONY.data;

interface Engine {
  build(input: CeremonyInput): { opening: [string, string][]; charge: [string, string][]; closing: [string, string][]; chargeName: string | null };
  calc(name: string, input: CeremonyInput): string;
  read(doc: unknown): CeremonyInput;
}

function engine(): Engine & { buildMain: (i: CeremonyInput) => string; _I: (d: unknown) => CeremonyInput } {
  const src = promotionEngineSource(data);
  return new Function(`${src}\nreturn { build: OCG.build, calc: OCG.calc, read: OCG.read, buildMain: buildMain, _I: _I };`)();
}

const full: CeremonyInput = {
  ...emptyInput(data),
  unit: '1st Maintenance Squadron',
  team: 'Team Maintenance',
  greeting: 'Good morning',
  date: '31 October 2026',
  time: '1230',
  promoteeName: 'Jane Q. Public Jr.',
  pronounId: 'she',
  currentGradeId: 'tsgt',
  newGradeId: 'msgt',
  emcee: 'SSgt Example',
  presiding: 'Colonel Presiding',
  seniorEnlisted: 'Chief Master Sergeant Chief',
  firstSergeant: 'First Sergeant Shirt',
  remarksBy: 'Senior Master Sergeant Remarks',
  chargeReader: '',
  tackers: ['Senior Master Sergeant Tacker', 'Mr. Public'],
  spouseRelation: 'Husband',
  spouseName: 'Sam',
  children: 'Lee and Ash',
  mother: 'Mrs. Public',
  father: '',
  visitors: [{ name: 'Chief Master Sergeant (Ret.) Visitor', role: 'her first supervisor' }, { name: 'Mr. Guest', role: '' }],
  refreshments: 'break room',
};

const cases: Array<[string, CeremonyInput]> = [
  ['everything filled, SNCO charge', full],
  ['NCO charge, minimal roles', { ...full, currentGradeId: 'sra', newGradeId: 'ssgt', presiding: '', seniorEnlisted: '', firstSergeant: '', remarksBy: '', tackers: ['', ''], visitors: [{ name: '', role: '' }], spouseRelation: '', spouseName: '', children: '', mother: '' }],
  ['no charge for a senior promotion', { ...full, currentGradeId: 'msgt', newGradeId: 'smsgt' }],
  ['he, one visitor, spouse without relation', { ...full, pronounId: 'he', spouseRelation: '', spouseName: 'Pat', visitors: [{ name: 'Guest One', role: '' }] }],
];

/** A stand-in for the Acrobat document: the file's fields holding the site's values. */
function docOf(values: Record<string, string>) {
  return { getField: (n: string) => (n in values ? { value: values[n] } : null) };
}

describe("the promotion PDF's script agrees with the site's builder", () => {
  const ocg = engine();

  it.each(cases)('%s', (_, input) => {
    const doc = docOf(promotionFieldValues(input, data));
    const read = ocg.read(doc);
    const site = buildScript(data, input);
    const file = ocg.build(read);
    const blocks = (id: string) => site.find((s) => s.id === id)?.blocks.map((b) => [b.kind, b.text]) ?? [];
    expect(file.opening).toEqual(blocks('opening'));
    expect(file.charge).toEqual(blocks('charge'));
    expect(file.closing).toEqual(blocks('closing'));
  });

  it('formats the fields the way the file always has, and answers the old function names', () => {
    const doc = docOf(promotionFieldValues(full, data));
    const main = ocg.buildMain(ocg._I(doc));
    expect(main.startsWith('»  Approximately three minutes prior to start:\r\rEMCEE: Ladies and gentlemen')).toBe(true);
    expect(ocg.calc(PF.chargeIndicator, ocg.read(doc))).toBe('SENIOR NONCOMMISSIONED OFFICER CHARGE');
    expect(ocg.calc(PF.charge, ocg.read(doc))).toContain('SENIOR NONCOMMISSIONED OFFICER CHARGE');
  });

  it('is empty until something is typed', () => {
    const doc = docOf(promotionFieldValues(emptyInput(data), data));
    expect(ocg.calc(PF.main, ocg.read(doc))).toBe('');
  });
});

async function inspect(bytes: Uint8Array) {
  const doc = await PdfDocument.open(bytes);
  const catalog = await doc.catalog();
  const info = (await doc.resolve(doc.trailer.get('Info'))) as PdfDict;
  const acro = (await doc.resolve(catalog.get('AcroForm'))) as PdfDict;
  const fields = new Map<string, string>();
  for (const ref of (await doc.resolve(acro.get('Fields'))) as PdfRef[]) {
    const f = (await doc.resolve(ref)) as PdfDict;
    const v = f.get('V');
    fields.set((f.get('T') as PdfString).text, v instanceof PdfString ? v.text : '');
  }
  const names = (await doc.resolve(catalog.get('Names'))) as PdfDict;
  const tree = (await doc.resolve(names.get('JavaScript'))) as PdfDict;
  const entries = (await doc.resolve(tree.get('Names'))) as unknown[];
  const action = (await doc.resolve(entries[1] as PdfRef)) as PdfDict;
  const script = new TextDecoder('latin1').decode((await doc.streamOf(action.get('JS')))!);
  const pages = (await doc.resolve(((await doc.resolve(catalog.get('Pages'))) as PdfDict).get('Kids'))) as PdfRef[];
  let content = '';
  const links: string[] = [];
  for (const pageRef of pages) {
    const page = (await doc.resolve(pageRef)) as PdfDict;
    const c = page.get('Contents');
    for (const r of Array.isArray(c) ? c : [c]) content += new TextDecoder('latin1').decode((await doc.streamOf(r as PdfRef)) ?? new Uint8Array());
    for (const a of ((await doc.resolve(page.get('Annots'))) as PdfRef[]) ?? []) {
      const annot = (await doc.resolve(a)) as PdfDict;
      if ((annot.get('Subtype') as PdfName).name === 'Link') {
        links.push(((((await doc.resolve(annot.get('A'))) as PdfDict).get('URI')) as PdfString).text);
      }
    }
  }
  const infoText = [...info.values()].map((v) => (v instanceof PdfString ? v.text : '')).join(' ');
  return { doc, infoText, fields, script, content, links, pages: pages.length };
}

describe('the embedded forms', () => {
  it('promotion builder: scrubbed, blank, rescripted, branded', async () => {
    const r = await inspect(new Uint8Array(decodeBase64(promotionBase64)));
    expect(r.pages).toBe(4);
    expect(r.infoText).not.toMatch(/82|TORRES|MXAA/i);
    expect(r.content).not.toMatch(/82 RS|Reconnaissance|8-Deuce|FormXob/);
    expect(r.content).toContain('(PROMOTION SCRIPT BUILDER)');
    expect(r.content).toContain('opscheckgood.github.io/opscheckgood');
    expect(r.links).toContain('https://opscheckgood.github.io/opscheckgood/');
    for (const [name, value] of r.fields) expect(value, name).toBe('');
    expect(r.script).toContain('var OCG = (function ()');
    expect(r.script).toContain('function buildMain(');
    expect(r.script).not.toContain('Team 8-Deuce');
    expect(saturated(r.content)).toEqual([]);
  });

  it('PT calculator: scrubbed and branded, its own script untouched', async () => {
    const r = await inspect(new Uint8Array(decodeBase64(ptBase64)));
    expect(r.pages).toBe(2);
    expect(r.infoText).not.toMatch(/TORRES|MXAA|82 RS/i);
    expect(r.infoText).toContain('PT Calculator');
    expect(r.fields.size).toBe(265);
    expect(r.script.startsWith('var PF = {')).toBe(true);
    expect(r.content).toContain('opscheckgood.github.io/opscheckgood');
    expect(r.links).toContain('https://opscheckgood.github.io/opscheckgood/');
    expect(saturated(r.content)).toEqual([]);
  });
});

/** Colour operators that are not paper, ink or grey: the originals' navy and orange. */
function saturated(content: string): string[] {
  return [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (rg|RG)/g)]
    .map((m) => m[0])
    .filter((op) => {
      const [r, g, b] = op.split(' ').slice(0, 3).map(Number) as [number, number, number];
      return Math.max(r, g, b) - Math.min(r, g, b) > 0.05;
    });
}

describe('the downloads', () => {
  it('lock every file and carry the page entries into the fields', async () => {
    const pt = await inspect(await ptCalculatorPdf());
    expect(pt.doc.encrypted).toBe(true);

    const promo = await inspect(await promotionBuilderPdf(full, data));
    expect(promo.doc.encrypted).toBe(true);
    expect(promo.fields.get(PF.promotee)).toBe('Jane Q. Public Jr.');
    expect(promo.fields.get(PF.newRank)).toBe('MSgt');
    expect(promo.fields.get(PF.pronoun)).toBe('She');
    expect(promo.fields.get(PF.spouseRelation)).toBe('Husband');
    expect(promo.fields.get('dv2_name')).toBe('Mr. Guest');

    const blank = await inspect(await promotionBuilderPdf(null, data));
    expect(blank.fields.get(PF.promotee)).toBe('');

    const dec = await inspect(
      await decorationBuilderPdf(
        { awardId: 'msm', serviceId: 'usaf', basisId: 'service', circumstanceId: '', closingId: 'standard', longCareer: false, awardNumber: 3, gradeId: 'msgt', name: 'Pat Q. Public', surname: 'Public', pronounId: 'they', assignmentId: 'as', duty: 'Section Chief', squadron: '1st Maintenance Squadron', group: '', wing: '', base: 'Nellis Air Force Base, Nevada', periodId: 'range', start: '2024-01-01', end: '2025-12-31', date: '', periodInOpening: false, approver: '', approverTitle: '', signedDate: '' },
        CITATION_LANGUAGE.data,
        CERTIFICATE.data,
      ),
    );
    expect(dec.doc.encrypted).toBe(true);
    expect(dec.fields.get('award')).toBe('Meritorious Service Medal');
    expect(dec.fields.get('awardNumber')).toBe('Second oak leaf cluster');
    expect(dec.fields.get('grade')).toBe('Master Sergeant');
    expect(dec.fields.get('start')).toBe('1 January 2024');
  });
});
