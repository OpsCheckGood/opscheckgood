import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aesCbcDecrypt, aesCbcNoPadEncrypt, md5, rc4 } from '@/lib/pdf/crypto';
import { Lexer, Parser, PdfName, PdfRef, PdfString, PdfStream, ascii } from '@/lib/pdf/objects';
import { PdfDocument } from '@/lib/pdf/document';
import { readForm, bulletFields, NotAnXfaFormError } from '@/lib/pdf/form';
import { readDatasetValues, readTemplateFields, toMm } from '@/lib/pdf/xfa';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/forms/${name}`, import.meta.url))));

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));

describe('crypto primitives', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(hex(md5(ascii('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(ascii('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5(ascii('The quick brown fox jumps over the lazy dog')))).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
    // Longer than one block: RFC 1321's million-'a' vector, shortened to 1000.
    expect(hex(md5(ascii('a'.repeat(1000))))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });

  it('rc4 matches the Wikipedia test vector', () => {
    expect(hex(rc4(ascii('Key'), ascii('Plaintext')))).toBe('bbf316e8d940af0ad3');
  });

  it('aes-128 decrypts the FIPS-197 vector through CBC with a zero IV', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f');
    const cipher = fromHex('69c4e0d86a7b0430d8cdb78070b4c55a');
    // IV of zeros prepended: CBC of one block reduces to plain ECB.
    const out = aesCbcDecrypt(key, new Uint8Array([...new Uint8Array(16), ...cipher, ...cipher]));
    expect(hex(out.subarray(0, 16))).toBe('00112233445566778899aabbccddeeff');
  });

  it('aes-128 encrypt (no padding) round-trips against decrypt', () => {
    const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
    const iv = fromHex('000102030405060708090a0b0c0d0e0f');
    const plain = fromHex('6bc1bee22e409f96e93d7e117393172a');
    const enc = aesCbcNoPadEncrypt(key, iv, plain);
    expect(hex(enc)).toBe('7649abac8119b246cee98e9b12e9197d'); // NIST SP 800-38A F.2.1
    const dec = aesCbcDecrypt(key, new Uint8Array([...iv, ...enc, ...enc]));
    expect(hex(dec.subarray(0, 16))).toBe(hex(plain));
  });
});

describe('object syntax', () => {
  it('parses the object kinds a form needs', () => {
    const src = ascii(
      '<< /Type /Catalog /Kids [1 0 R 2 0 R] /Name /A#20B /S (a\\)b) /H <414243> /N 3.5 /T true /Z null >>',
    );
    const obj = new Parser(new Lexer(src)).parse();
    expect(obj).toBeInstanceOf(Map);
    const dict = obj as Map<string, unknown>;
    expect((dict.get('Type') as PdfName).name).toBe('Catalog');
    expect((dict.get('Kids') as PdfRef[]).map((r) => r.num)).toEqual([1, 2]);
    expect((dict.get('Name') as PdfName).name).toBe('A B');
    expect((dict.get('S') as PdfString).text).toBe('a)b');
    expect((dict.get('H') as PdfString).text).toBe('ABC');
    expect(dict.get('N')).toBe(3.5);
    expect(dict.get('T')).toBe(true);
    expect(dict.get('Z')).toBeNull();
  });

  it('reads a stream by its length and by searching when the length lies', () => {
    const good = ascii('<< /Length 5 >>\nstream\nhello\nendstream');
    const s1 = new Parser(new Lexer(good)).parse() as PdfStream;
    expect(String.fromCharCode(...s1.raw)).toBe('hello');
    const bad = ascii('<< /Length 99 >>\nstream\r\nhello\r\nendstream');
    const s2 = new Parser(new Lexer(bad)).parse() as PdfStream;
    expect(String.fromCharCode(...s2.raw)).toBe('hello');
  });
});

describe('xfa helpers', () => {
  it('converts units', () => {
    expect(toMm('202.321mm')).toBe(202.321);
    expect(toMm('1in')).toBe(25.4);
    expect(toMm('12pt')).toBeCloseTo(4.2333, 3);
    expect(toMm('')).toBeNull();
  });

  it('reads field geometry, font and insets from a template', () => {
    const template = `<template><subform>
      <field name="a" x="7.354mm" w="202.321mm" h="218.217mm" y="52.369mm"><ui><textEdit multiLine="1"/></ui>
        <font typeface="Times New Roman" size="12pt"/><margin leftInset="1mm" rightInset="1mm"/></field>
      <field name="b" w="10mm" h="4mm"><font size="7pt" typeface="Arial"/></field>
    </subform></template>`;
    const [a, b] = readTemplateFields(template);
    expect(a).toMatchObject({ name: 'a', widthMm: 202.321, heightMm: 218.217, typeface: 'Times New Roman', multiLine: true, insetLeftMm: 1, insetRightMm: 1 });
    expect(a!.sizePt).toBeCloseTo(12, 9);
    expect(b).toMatchObject({ name: 'b', widthMm: 10, typeface: 'Arial', multiLine: false, insetLeftMm: 0 });
  });

  it('reads leaf values from datasets, decoding entities and line breaks', () => {
    const datasets = `<xfa:datasets xmlns:xfa="x"><xfa:data><form1><rankName>TSgt A &amp; B</rankName>
      <specificAccomplishments>- one&#xD;- two &lt;3</specificAccomplishments><empty/></form1></xfa:data></xfa:datasets>`;
    const values = readDatasetValues(datasets);
    expect(values.get('rankName')).toBe('TSgt A & B');
    expect(values.get('specificAccomplishments')).toBe('- one\n- two <3');
    expect(values.has('empty')).toBe(false);
  });

  it('reads the tags Acrobat writes, with whitespace before every closing bracket', () => {
    const datasets = '<xfa:datasets xmlns:xfa="x"\n><xfa:data\n><form1\n><specificAccomplishments\n>- one&#xD;- two</specificAccomplishments\n><p2SpecificAccomplishments\n/></form1\n></xfa:data\n></xfa:datasets\n>';
    const values = readDatasetValues(datasets);
    expect(values.get('specificAccomplishments')).toBe('- one\n- two');
  });
});

describe('reading real forms', () => {
  it('opens the encrypted blank AF 1206 and reads its field geometry', async () => {
    const form = await readForm(fixture('af1206-20170802-blank.pdf'));
    expect(form.encrypted).toBe(true);
    expect(form.formNumber).toBe('AF FORM 1206');
    expect(form.edition).toBe('20170802');
    const field = form.fields.find((f) => f.name === 'specificAccomplishments')!;
    expect(field.widthMm).toBe(202.321);
    expect(field.heightMm).toBe(218.217);
    expect(field.typeface).toBe('Times New Roman');
    expect(field.sizePt).toBeCloseTo(12, 9);
    expect(field.usableWidthMm).toBe(202.321);
    expect(field.value).toBeNull();
    expect(bulletFields(form).map((f) => f.name)).toEqual([
      'specificAccomplishments',
      'p2SpecificAccomplishments',
    ]);
  });

  it('reads the 910 and 911, whose comment blocks carry no side insets', async () => {
    const f910 = await readForm(fixture('af910-20151130-blank.pdf'));
    expect(f910.formNumber).toBe('AF FORM 910');
    expect(f910.edition).toBe('20151130');
    for (const name of ['KeyDuties', 'IIIComments', 'IVComments', 'VComments', 'VIIIComments', 'IXComments']) {
      const field = f910.fields.find((f) => f.name === name)!;
      expect(field.widthMm, name).toBe(202.321);
      expect(field.insetLeftMm + field.insetRightMm, name).toBe(0);
      expect(field.usableWidthMm, name).toBe(202.321);
      expect(field.multiLine, name).toBe(true);
    }
    // Insets do exist on the form, on small boxes: reading them is not a no-op.
    const sec1 = f910.fields.find((f) => f.name === 'Sec1')!;
    expect(sec1.insetLeftMm).toBe(1);
    expect(sec1.usableWidthMm).toBeCloseTo(11.75, 9);

    const f911 = await readForm(fixture('af911-20150731-blank.pdf'));
    expect(f911.formNumber).toBe('AF FORM 911');
    expect(bulletFields(f911).map((f) => f.name)).toContain('IIIComments');
  });

  it('lifts the bullets out of a filled, re-encrypted 1206 with a classic xref table', async () => {
    const form = await readForm(fixture('af1206-20170802-filled.pdf'));
    expect(form.encrypted).toBe(true);
    const field = form.fields.find((f) => f.name === 'specificAccomplishments')!;
    expect(field.value).toBe(
      "- Led 12-person team through the wing readiness inspection; cut open discrepancies 42% across 210 actions\n" +
        "- Coordinated 22 close air support missions with four joint task force partners while mentoring nine airmen through upgrade training & rewriting the unit's preflight checklist\n" +
        '- Drove 340 hrs of checklist rewrites; hailed by MAJCOM/A4 as best practice',
    );
    expect(form.fields.find((f) => f.name === 'rankName')!.value).toBe('TSgt Test Fixture');
  });

  it('refuses a PDF with no XFA', async () => {
    const plain = ascii(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF',
    );
    const doc = await PdfDocument.open(plain);
    expect((await doc.catalog()).get('Type')).toBeInstanceOf(PdfName);
    await expect(readForm(plain)).rejects.toBeInstanceOf(NotAnXfaFormError);
  });
});
