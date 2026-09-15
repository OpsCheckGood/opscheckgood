import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
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
import { BODY_FAT_TABLES, CURRENT_STANDARDS } from '@/lib/data/pt';
import { assessBodyFat, lookupBodyFat } from '@/lib/pt/score';

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
  // Per page, so a footer can be checked on every one.
  const perPage: string[] = [];
  for (const pageRef of pages) {
    const page = (await doc.resolve(pageRef)) as PdfDict;
    const c = page.get('Contents');
    let t = '';
    for (const r of Array.isArray(c) ? c : [c]) t += new TextDecoder('latin1').decode((await doc.streamOf(r as PdfRef)) ?? new Uint8Array());
    perPage.push(t);
  }
  return { doc, infoText, fields, script, content, links, pages: pages.length, perPage };
}

describe('the embedded forms', () => {
  it('promotion builder: scrubbed, blank, rescripted, branded', async () => {
    const r = await inspect(new Uint8Array(decodeBase64(promotionBase64)));
    expect(r.pages).toBe(4);
    expect(r.infoText).not.toMatch(/82|TORRES|MXAA/i);
    expect(r.content).not.toMatch(/82 RS|Reconnaissance|8-Deuce|FormXob/);
    expect(r.content).toContain('(PROMOTION SCRIPT BUILDER)');
    expect(r.perPage[0]).not.toContain('(OPS CHECK GOOD)');
    for (const page of r.perPage) expect(page).toMatch(/\(opscheckgood\.github\.io\/opscheckgood   CAO \d+ [A-Z]{3} \d{4}\)/);
    expect(r.links.filter((l) => l === 'https://opscheckgood.github.io/opscheckgood/')).toHaveLength(4);
    for (const [name, value] of r.fields) expect(value, name).toBe('');
    expect(r.script).toContain('var OCG = (function ()');
    expect(r.script).toContain('function buildMain(');
    expect(r.script).not.toContain('Team 8-Deuce');
    expect(saturated(r.content)).toEqual([]);
  });

  it('PT calculator: scrubbed and branded, its scoring script untouched and its Tier 2 page brought to the manual', async () => {
    const r = await inspect(new Uint8Array(decodeBase64(ptBase64)));
    expect(r.pages).toBe(2);
    expect(r.infoText).not.toMatch(/TORRES|MXAA|82 RS/i);
    expect(r.infoText).toContain('PT Calculator');
    expect(r.fields.size).toBe(264); // the print button is gone
    expect(r.script.startsWith('var PF = {')).toBe(true);
    // The scoring tables are the oracle and are byte-for-byte the fixture's.
    const fixture = readFileSync(join(root, 'tests', 'fixtures', 'pdf-calculator.js'), 'utf8');
    const tables = (src: string) => src.slice(src.indexOf('var PF = {'), src.indexOf('function ageIndex'));
    expect(tables(r.script)).toBe(tables(fixture));
    // Attachment 8: the quarter inch. Table 3.2: strictly under. Attachments 9 and 10: the published cell. Para 3.9: no hold for a met assessment.
    expect(r.script).toContain('function floorHalfDown(x){ return Math.floor(x * 4 + 1e-9) / 4; }');
    expect(r.script).toContain('res = (pct < max) ? "PASS" : "FAIL";');
    expect(r.script).toContain('S("BF_Std", sexF ? "under 36%" : "under 26%");');
    expect(r.script).toContain('function bftLookup(sexF, circ, ht){');
    expect(r.script).not.toContain('bodyPts = 0; bodyPos = 0; exCount++;');
    expect(r.perPage[1]).toContain('male under 26%, female under 36%');
    expect(r.perPage[1]).not.toContain('26% or less');
    expect(r.perPage[0]).toContain('(PT CALCULATOR)');
    expect(r.perPage[0]).not.toContain('(OPS CHECK GOOD)');
    for (const page of r.perPage) expect(page).toMatch(/\(opscheckgood\.github\.io\/opscheckgood   CAO \d+ [A-Z]{3} \d{4}\)/);
    expect(r.links.filter((l) => l === 'https://opscheckgood.github.io/opscheckgood/')).toHaveLength(2);
    expect(saturated(r.content)).toEqual([]);
  });
});

/**
 * Runs the embedded PT calculator's script the way the oracle harness runs
 * the original: enough of the Acrobat form API for it to calculate over a
 * plain object of field values.
 */
function runEmbeddedPt(script: string, inputs: Record<string, string>): Record<string, string> {
  const harness = `
    var color = { white: ['RGB', 1, 1, 1] };
    var display = { visible: 0, hidden: 1 };
    ${script}
    var values = Object.create(null), fields = Object.create(null);
    function field(name) {
      if (!fields[name]) fields[name] = { get value() { return values[name] === undefined ? '' : values[name]; }, set value(v) { values[name] = String(v); }, fillColor: color.white, display: display.visible };
      return fields[name];
    }
    for (var key in inputs) field(key).value = inputs[key];
    pfraCalc.call({ getField: field });
    return values;
  `;
  return new Function('inputs', harness)(inputs) as Record<string, string>;
}

describe("the embedded PT calculator's Tier 2 page agrees with the site", () => {
  const standards = CURRENT_STANDARDS.data;
  const script = () => {
    const bytes = new Uint8Array(decodeBase64(ptBase64));
    return inspect(bytes).then((r) => r.script);
  };
  // A page 1 that fails on points with a waist-to-height ratio over .55, so the Tier 2 page opens.
  const page1 = {
    Age: '30', Track: 'Standard PFRA', BodyEvent: 'Measured', StrEvent: 'Push-up', CoreEvent: 'Sit-up', CardioEvent: '2 Mile Run',
    Height: '66', W1: '38', W2: '38', W3: '38', StrRaw: '10', CoreA: '10', CardioA: '20', CardioB: '0',
  };

  it('reads the percent from the published table, rounds the tape to the quarter inch, and fails a result equal to the standard', async () => {
    const src = await script();
    const cases: Array<{ sex: 'male' | 'female'; tape: Record<string, string>; site: Record<string, number> }> = [
      { sex: 'male', tape: { BF_Neck: '15.3', BF_2: '34.4' }, site: { neck: 15.3, abdomen: 34.4 } },
      { sex: 'male', tape: { BF_Neck: '16', BF_2: '40.1' }, site: { neck: 16, abdomen: 40.1 } },
      { sex: 'female', tape: { BF_Neck: '13.2', BF_2: '31.6', BF_3: '40.3' }, site: { neck: 13.2, waist: 31.6, buttocks: 40.3 } },
    ];
    for (const c of cases) {
      const out = runEmbeddedPt(src, { ...page1, Sex: c.sex === 'female' ? 'Female' : 'Male', ...c.tape });
      const mine = assessBodyFat(standards, c.sex, 66, c.site);
      expect(out.BFA_Req, JSON.stringify(c)).toMatch(/^YES/);
      expect(out.BF_Pct).toBe(`${mine.percent} %`);
      expect(out.BF_Result).toBe(mine.result === 'pass' ? 'PASS' : 'FAIL');
      expect(out.BF_Std).toBe(c.sex === 'female' ? 'under 36%' : 'under 26%');
      expect(out.BF_Notes).toMatch(/^Read from Attachment (9|10) at /);
      // The circumference is what quarter-inch rounding gives, not the half inch the file used to take.
      expect(parseFloat(out.BF_Circ!)).toBe(mine.circumference);
    }
    // Exactly on the standard: the table says 26, and 26 is not under 26.
    const male = BODY_FAT_TABLES.data.male;
    let atStandard: number | null = null;
    for (let circ = male.circumference.start; atStandard === null && circ < 60; circ += 0.25) {
      if (lookupBodyFat(male, circ, 66) === 26) atStandard = circ;
    }
    expect(atStandard).not.toBeNull();
    const exact = runEmbeddedPt(src, { ...page1, Sex: 'Male', BF_Neck: '0.25', BF_2: String(atStandard! + 0.25) });
    expect(exact.BF_Pct).toBe('26 %');
    expect(exact.BF_Result).toBe('FAIL');
  });

  it('scores a met assessment as an exempt component without warning of a PFRA hold', async () => {
    const src = await script();
    const met = runEmbeddedPt(src, { ...page1, Sex: 'Male', BF_Neck: '16', BF_2: '32' });
    expect(met.BF_Result).toBe('PASS');
    expect(met.Notes).toContain('BFA met');
    expect(met.Notes).not.toContain('PFRA Hold');
    const notMet = runEmbeddedPt(src, { ...page1, Sex: 'Male', BF_Neck: '14', BF_2: '44' });
    expect(notMet.BF_Result).toBe('FAIL');
    expect(notMet.Rating).toContain('UNSAT');
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
    expect(pt.infoText).toContain('Ops Check Good - PT Calculator - fillable PDF builder');

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
