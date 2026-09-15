import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PdfRewriter } from '@/lib/pdf/rewrite';
import { PdfDocument } from '@/lib/pdf/document';
import { PdfName, PdfRef, PdfString, type PdfDict } from '@/lib/pdf/objects';
import { permissionBits, FORM_ONLY } from '@/lib/pdf/security';
import { buildDecorationFormPdf } from '@/lib/pdfform/decoration-form';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/forms/${name}`, import.meta.url))));

async function fieldValues(bytes: Uint8Array): Promise<Map<string, string>> {
  const doc = await PdfDocument.open(bytes);
  const acro = (await doc.resolve((await doc.catalog()).get('AcroForm'))) as PdfDict;
  const out = new Map<string, string>();
  for (const ref of (await doc.resolve(acro.get('Fields'))) as PdfRef[]) {
    const f = (await doc.resolve(ref)) as PdfDict;
    const v = f.get('V');
    out.set((f.get('T') as PdfString).text, v instanceof PdfString ? v.text : '');
  }
  return out;
}

describe('rewriting a PDF', () => {
  it('fills, rescripts, rebrands and locks a form our writer built, and our reader opens the result', async () => {
    const source = buildDecorationFormPdf(CITATION_LANGUAGE.data, CERTIFICATE.data);
    const rw = await PdfRewriter.open(source);
    rw.fill({ name: 'Ami R. Ponde', surname: 'Ponde' });
    rw.setDocumentScript('OpsCheckGood', 'var OCG = { marker: "rewritten" };');
    rw.setInfo({ Title: 'Locked form', Author: 'Ops Check Good' });
    const locked = rw.save({ ownerPassword: 'test-owner' });

    const doc = await PdfDocument.open(locked);
    expect(doc.encrypted).toBe(true);
    const encrypt = (await doc.resolve(doc.trailer.get('Encrypt'))) as PdfDict;
    expect(encrypt.get('P')).toBe(permissionBits(FORM_ONLY));
    expect((encrypt.get('V'))).toBe(4);

    const values = await fieldValues(locked);
    expect(values.get('name')).toBe('Ami R. Ponde');
    expect(values.get('surname')).toBe('Ponde');
    expect(values.get('grade')).toBe('Staff Sergeant'); // untouched default

    const info = (await doc.resolve(doc.trailer.get('Info'))) as PdfDict;
    expect((info.get('Title') as PdfString).text).toBe('Locked form');

    const names = (await doc.resolve((await doc.catalog()).get('Names'))) as PdfDict;
    const tree = (await doc.resolve(names.get('JavaScript'))) as PdfDict;
    const entries = (await doc.resolve(tree.get('Names'))) as unknown[];
    const action = (await doc.resolve(entries[1] as PdfRef)) as PdfDict;
    const js = new TextDecoder('latin1').decode((await doc.streamOf(action.get('JS')))!);
    expect(js).toBe('var OCG = { marker: "rewritten" };');
  });

  it('permission bits keep filling and printing and drop editing', () => {
    const p = permissionBits(FORM_ONLY);
    const bit = (n: number) => (p & (1 << (n - 1))) !== 0;
    expect(bit(3)).toBe(true); // print
    expect(bit(4)).toBe(false); // modify
    expect(bit(6)).toBe(false); // annotate
    expect(bit(9)).toBe(true); // fill forms
    expect(bit(11)).toBe(false); // assemble
    expect(p).toBeLessThan(0);
  });

  it('carries an encrypted e-Publishing form through a rewrite intact', async () => {
    const rw = await PdfRewriter.open(fixture('af1206-20170802-filled.pdf'));
    rw.setInfo({ Title: 'Rewritten 1206' });
    const out = rw.save();
    const doc = await PdfDocument.open(out);
    expect(doc.encrypted).toBe(true);
    const catalog = await doc.catalog();
    const acro = (await doc.resolve(catalog.get('AcroForm'))) as PdfDict;
    const xfa = (await doc.resolve(acro.get('XFA'))) as unknown[];
    // The XFA packets survive, decrypted and re-encrypted, byte for byte.
    let datasets = '';
    for (let i = 0; i + 1 < xfa.length; i += 2) {
      if ((xfa[i] as PdfString).text === 'datasets') {
        datasets = new TextDecoder().decode((await doc.streamOf(xfa[i + 1] as PdfRef))!);
      }
    }
    expect(datasets).toContain('Led 12-person team');
  });

  it('edits page content as text', async () => {
    const source = buildDecorationFormPdf(CITATION_LANGUAGE.data, CERTIFICATE.data);
    const rw = await PdfRewriter.open(source);
    await rw.editContent((content) => content.replace('(DECORATION WRITER)', '(Renamed Tool)'));
    const out = rw.save();
    const doc = await PdfDocument.open(out);
    const pages = (await doc.resolve(((await doc.resolve((await doc.catalog()).get('Pages'))) as PdfDict).get('Kids'))) as PdfRef[];
    const page = (await doc.resolve(pages[0]!)) as PdfDict;
    const content = new TextDecoder('latin1').decode((await doc.streamOf(page.get('Contents')))!);
    expect(content).toContain('(Renamed Tool)');
    expect(content).not.toContain('(DECORATION WRITER)');
    expect((page.get('Type') as PdfName).name).toBe('Page');
  });
});
