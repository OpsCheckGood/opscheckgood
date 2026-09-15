import { describe, it, expect } from 'vitest';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';
import {
  buildDecorationFormPdf,
  decorationEngineSource,
  decorationFieldValues,
  F,
  OUTPUTS,
} from '@/lib/pdfform/decoration-form';
import { buildFormPdf, measure, pdfString } from '@/lib/pdfform/writer';
import {
  assembleCitation,
  certificateText,
  closingSentence,
  openingSentence,
  type CitationInput,
} from '@/lib/decoration/citation';
import { wrapMonospace } from '@/lib/decoration/fit';
import { buildCitationDocx } from '@/lib/decoration/docx';
import { PdfDocument } from '@/lib/pdf/document';
import { PdfName, PdfRef, PdfString, type PdfDict } from '@/lib/pdf/objects';

const language = CITATION_LANGUAGE.data;
const certificate = CERTIFICATE.data;

/** The PDF's script, evaluated under Node. */
function engine(): { calc: (name: string, v: Record<string, string>) => string; sync: (doc: unknown) => void; read: (doc: unknown) => Record<string, string> } {
  const src = decorationEngineSource(language, certificate);
  return new Function(`${src}\nreturn OCG;`)() as ReturnType<typeof engine>;
}

const valuesFor = (input: CitationInput) => ({ ...decorationFieldValues(input, language, certificate), [F.narrative]: '' });

const base: CitationInput = {
  awardId: 'ascom', serviceId: 'usaf', basisId: 'service', circumstanceId: '', closingId: 'standard',
  longCareer: false, awardNumber: 2, gradeId: 'tsgt', name: 'Ami R. Ponde', surname: 'Ponde', pronounId: 'she',
  assignmentId: 'as', duty: 'a Flight Chief', squadron: '1st Maintenance Squadron', group: '1st Maintenance Group',
  wing: '1st Fighter Wing', base: 'Joint Base Langley-Eustis, Virginia', periodId: 'range',
  start: '2024-01-01', end: '2025-12-31', date: '', periodInOpening: false,
  approver: 'JANE Q. PUBLIC, Lt Col, USAF', approverTitle: 'Commander, 1st Maintenance Squadron', signedDate: '2026-07-31',
};

const cases: Array<[string, CitationInput]> = [
  ['commendation, first OLC', base],
  ['achievement with dates in the sentence', { ...base, awardId: 'asam', awardNumber: 1, periodInOpening: true }],
  ['MSM retirement, long career, he', { ...base, awardId: 'msm', closingId: 'retirement', longCareer: true, pronounId: 'he', gradeId: 'smsgt' }],
  ['bronze star with an engagement clause', { ...base, awardId: 'bsm', basisId: 'achievement', circumstanceId: 'foreign', periodInOpening: true }],
  ['DSM, its own opening', { ...base, awardId: 'dsm', basisId: 'responsibility', gradeId: 'ltgen', assignmentId: 'while', duty: '' }],
  ['heroism at or near, on a date', { ...base, basisId: 'heroism', closingId: 'heroism', assignmentId: 'near', periodId: 'on', date: '2025-03-09', periodInOpening: true }],
  ['guard closing, space force grade', { ...base, closingId: 'guard', serviceId: 'ussf', gradeId: 'spc4', pronounId: 'they' }],
];

describe("the PDF's own script agrees with the site's engine", () => {
  const ocg = engine();
  const narrative = 'During this period, Sergeant Ponde led the flight through two inspections and rebuilt the training plan for 40 Airmen, cutting overdue items 30 percent.';

  it.each(cases)('%s', (_, input) => {
    const v = { ...valuesFor(input), [F.narrative]: narrative };
    const opening = openingSentence(input, language);
    const closing = closingSentence(input, language);
    expect(ocg.calc(F.opening, v)).toBe(opening);
    expect(ocg.calc(F.closingOut, v)).toBe(closing);
    const full = assembleCitation(opening, narrative, closing);
    expect(ocg.calc(F.citation, v)).toBe(wrapMonospace(full, certificate.box.columns!).join('\n'));
    const page = certificateText(input, language, certificate)!;
    const texts = page.header.map((l) => l.text);
    const award = language.awards.find((a) => a.id === input.awardId)!;
    expect(ocg.calc(F.certTitle, v)).toBe(award.certificate.title);
    expect(texts).toContain(ocg.calc(F.certTitle, v));
    expect(texts).toContain(ocg.calc(F.certMember, v));
    expect(ocg.calc(F.status, v)).toMatch(/^\d+ \/ 1350 characters   \d+ \/ 20 lines   FITS$/);
  });

  it('lays out the preview header the way the site does, for both certificate styles', () => {
    for (const input of [base, { ...base, awardId: 'msm', basisId: 'service', closingId: 'standard' }]) {
      const v = valuesFor(input);
      const page = certificateText(input, language, certificate)!;
      const style = page.style;
      const slots = certificate.page!.headers[style].lines.map((_, i) => ocg.calc(`preview_${style}_${i}`, v));
      // The site drops empty lines; the file keeps blank slots. Same text otherwise.
      expect(slots.filter((t) => t !== '')).toEqual(page.header.map((l) => l.text));
      expect(ocg.calc(F.previewSigned, v)).toBe('31 July 2026');
      expect(ocg.calc(F.previewSignature, v)).toBe('JANE Q. PUBLIC, Lt Col, USAF\nCommander, 1st Maintenance Squadron');
    }
  });

  it('names the oak leaf cluster and the basis line the way the page does', () => {
    const v = valuesFor(base);
    expect(ocg.calc(F.certCluster, v)).toBe('(FIRST OAK LEAF CLUSTER)');
    expect(ocg.calc(F.certCluster, { ...v, [F.number]: 'First award' })).toBe('');
    expect(ocg.calc(F.certBasis, v)).toBe('MERITORIOUS SERVICE');
    expect(ocg.calc(F.certPeriod, v)).toBe('1 January 2024 to 31 December 2025');
  });

  it('reports a citation that runs past the certificate', () => {
    const v = { ...valuesFor(base), [F.narrative]: 'word '.repeat(320) };
    expect(ocg.calc(F.status, v)).toMatch(/CUT OFF: runs \d+ lines? past the certificate/);
  });

  it('follows a change of decoration in the dependent menus', () => {
    const fields = new Map<string, { value: string; items: string[]; setItems(i: string[]): void }>();
    const field = (name: string, value: string) => {
      const f = { value, items: [] as string[], setItems(i: string[]) { f.items = i; } };
      fields.set(name, f);
      return f;
    };
    field(F.award, 'Bronze Star Medal');
    field(F.basis, 'meritorious service');
    field(F.circumstance, '-');
    field(F.closing, 'Retirement');
    const doc = { getField: (n: string) => fields.get(n) };
    ocg.sync(doc);
    expect(fields.get(F.basis)!.items).toEqual(['meritorious achievement', 'meritorious service']);
    expect(fields.get(F.basis)!.value).toBe('meritorious service'); // kept: still offered
    expect(fields.get(F.circumstance)!.items.length).toBe(3);
    expect(fields.get(F.closing)!.value).toBe('Standard'); // Retirement is not a Bronze Star closing
  });
});

describe('the form file', () => {
  it('is a PDF our own reader can open, with the fields, the script and the link', async () => {
    const bytes = buildDecorationFormPdf(language, certificate);
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
    const doc = await PdfDocument.open(bytes);
    const catalog = await doc.catalog();
    const acro = (await doc.resolve(catalog.get('AcroForm'))) as PdfDict;
    const fields = (await doc.resolve(acro.get('Fields'))) as PdfRef[];
    const names: string[] = [];
    for (const ref of fields) {
      const f = (await doc.resolve(ref)) as PdfDict;
      names.push((f.get('T') as PdfString).text);
    }
    for (const name of Object.values(F)) expect(names, name).toContain(name);
    expect(acro.get('NeedAppearances')).toBe(true);
    // Every field carries its own appearance, so it shows as a box to type in
    // even in a viewer that ignores NeedAppearances.
    for (const ref of fields) {
      const f = (await doc.resolve(ref)) as PdfDict;
      const ap = (await doc.resolve(f.get('AP'))) as PdfDict;
      expect(ap.get('N'), (f.get('T') as PdfString).text).toBeInstanceOf(PdfRef);
    }
    const order = (await doc.resolve(acro.get('CO'))) as PdfRef[];
    expect(order.length).toBeGreaterThanOrEqual(OUTPUTS.length);

    const namesDict = (await doc.resolve(catalog.get('Names'))) as PdfDict;
    const jsTree = (await doc.resolve(namesDict.get('JavaScript'))) as PdfDict;
    const entries = (await doc.resolve(jsTree.get('Names'))) as unknown[];
    const action = (await doc.resolve(entries[1] as PdfRef)) as PdfDict;
    const js = await doc.streamOf(action.get('JS'));
    const source = new TextDecoder('latin1').decode(js!);
    expect(source).toContain('var OCG = (function ()');
    expect(source).toContain('OCG.sync(this)');
    // The script the file carries is the script the tests ran.
    expect(new Function(`${source.replace('OCG.sync(this);', '')}\nreturn OCG;`)().data.columns).toBe(70);

    const pages = (await doc.resolve((await doc.resolve(catalog.get('Pages')) as PdfDict).get('Kids'))) as PdfRef[];
    expect(pages).toHaveLength(3);
    const page1 = (await doc.resolve(pages[0]!)) as PdfDict;
    const annots = (await doc.resolve(page1.get('Annots'))) as PdfRef[];
    let link: PdfDict | null = null;
    for (const ref of annots) {
      const a = (await doc.resolve(ref)) as PdfDict;
      if ((a.get('Subtype') as PdfName).name === 'Link') link = a;
    }
    expect(link).not.toBeNull();
    const action2 = link!.get('A') as PdfDict;
    expect((action2.get('URI') as PdfString).text).toBe('https://opscheckgood.github.io/opscheckgood/');
  });

  it('escapes strings and measures base-14 text', () => {
    expect(pdfString('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(pdfString('curly ‘quotes’')).toBe("(curly 'quotes')");
    expect(measure('Cour', 'abcdefghij', 10)).toBeCloseTo(60, 6);
    expect(measure('Helv', 'Hello', 10)).toBeGreaterThan(20);
  });

  it('builds an empty form document without fields', async () => {
    const bytes = buildFormPdf({ title: 't', pages: [{ texts: [], rules: [], fields: [], links: [] }], script: 'var x = 1;' });
    const doc = await PdfDocument.open(bytes);
    expect(((await doc.catalog()).get('Type') as PdfName).name).toBe('Catalog');
  });
});

describe('the Word draft', () => {
  it('is a docx carrying the certificate lines and the citation', async () => {
    const page = certificateText(base, language, certificate)!;
    const blob = buildCitationDocx(page, 'Technical Sergeant Ami R. Ponde distinguished herself. The end.');
    expect(blob.type).toContain('wordprocessingml');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // PK
    // Stored, not deflated, so the XML is readable in place.
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('THE AIR AND SPACE COMMENDATION MEDAL');
    expect(text).toContain('(FIRST OAK LEAF CLUSTER)');
    expect(text).toContain('distinguished herself. The end.');
    expect(text).toContain('w:jc w:val="both"');
    expect(text).toContain('Courier New');
  });
});
