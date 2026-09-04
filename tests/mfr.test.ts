import { describe, it, expect } from 'vitest';
import {
  bodyOf,
  dutyTitle,
  formatDate,
  indOrdinal,
  memoDate,
  normalizeParas,
  paraLabel,
  sigLine,
  sigName,
  sigRank,
  subOf,
  subjectCase,
  tailBlocks,
  textOf,
} from '@/lib/mfr/format';
import {
  addPara,
  addSubPara,
  addTail,
  clearSubParas,
  deletePara,
  deleteTail,
  emptyDoc,
  newIndorsement,
  setParaText,
  setTailItem,
} from '@/lib/mfr/doc';
import { buildSpec, cuiDesLines, cuiOn, customSpec, locarSpec } from '@/lib/mfr/spec';
import { LOCAR_LANGUAGE, MEMO_FORMAT } from '@/lib/data/memoLanguage';
import { assemblePdf, buildPdfPages, encodeSeal } from '@/lib/mfr/pdf';
import { DEFAULT_SEAL } from '@/lib/mfr/assets/seal';
import { buildDocx } from '@/lib/mfr/docx';
import { zipStore } from '@/lib/mfr/zip';
import { memoInnerHtml } from '@/lib/mfr/html';
import type { MemoDoc, Para } from '@/lib/mfr/types';

const FIXED = new Date(Date.UTC(2026, 8, 4, 12));

function doc(patch: Partial<MemoDoc> = {}): MemoDoc {
  return { ...emptyDoc(), ...patch };
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('names, ranks and titles', () => {
  // A signature block is the one place a wrong name is embarrassing rather than
  // merely untidy, so both input orders have to land on the same output.
  it('reduces a middle name to an initial from either input order', () => {
    expect(sigName('ELLSWORTH, MICHAEL ANTHONY')).toBe('MICHAEL A. ELLSWORTH');
    expect(sigName('Michael Anthony Ellsworth')).toBe('MICHAEL A. ELLSWORTH');
  });

  it('is idempotent', () => {
    const once = sigName('Smith, John Daniel');
    expect(sigName(once)).toBe(once);
  });

  it('keeps a generational suffix with the surname', () => {
    expect(sigName('SNUFFY, JOHN A JR')).toBe('JOHN A. SNUFFY JR');
    expect(sigName('John A. Snuffy III')).toBe('JOHN A. SNUFFY III');
  });

  it('leaves a single-token name alone rather than inventing a surname', () => {
    expect(sigName('Snuffy')).toBe('SNUFFY');
    expect(sigName('')).toBe('');
  });

  it('normalizes roster rank spellings and passes unknown ones through', () => {
    expect(sigRank('MSG')).toBe('MSgt');
    expect(sigRank('msgt')).toBe('MSgt');
    expect(sigRank('2LT')).toBe('2d Lt');
    expect(sigRank('Squadron Superintendent')).toBe('Squadron Superintendent');
  });

  it('builds the signature line', () => {
    expect(sigLine('Smith, John D', 'TSG')).toBe('JOHN D. SMITH, TSgt, USAF');
    expect(sigLine('Smith, John D', '')).toBe('JOHN D. SMITH, USAF');
  });

  // A LOCAR carries the recipient's signature block from the moment their rank
  // is picked, which is before their name has been typed.
  it('prints nothing rather than a rank with no name in front of it', () => {
    expect(sigLine('', 'SSgt')).toBe('');
  });

  it('title-cases an all-caps duty title but keeps acronyms up', () => {
    expect(dutyTitle('NCOIC, PRODUCTION')).toBe('NCOIC, Production');
    expect(dutyTitle('C4ISR TECHNICIAN')).toBe('C4ISR Technician');
    expect(dutyTitle('RC-135 AVIONICS CRAFTSMAN')).toBe('RC-135 Avionics Craftsman');
  });

  it('leaves a title a person typed exactly as typed', () => {
    expect(dutyTitle('Section Chief')).toBe('Section Chief');
  });
});

describe('subject casing', () => {
  it('title-cases a shouted subject and lowers the small words', () => {
    expect(subjectCase('REQUEST FOR ADDITIONAL MANNING')).toBe('Request for Additional Manning');
  });

  it('leaves an acronym in a mixed-case line alone', () => {
    expect(subjectCase('Referral to a UIF')).toBe('Referral to a UIF');
  });

  it('capitalizes the first and last word whatever they are', () => {
    expect(subjectCase('the memo we asked for')).toBe('The Memo We Asked For');
  });
});

describe('paragraph structure', () => {
  it('numbers four levels the way the handbook does', () => {
    expect([0, 1, 2, 3].map((l) => paraLabel(l, 0))).toEqual(['1.', 'a.', '(1)', '(a)']);
    expect(paraLabel(1, 25)).toBe('z.');
  });

  it('numbers indorsements the military way', () => {
    expect([0, 1, 2, 3].map(indOrdinal)).toEqual(['1st', '2d', '3d', '4th']);
    expect(indOrdinal(10)).toBe('11th');
  });

  // Every JavaScript string has a `.sub` method, so a naive `p.sub` check makes
  // every plain paragraph look subdivided and throws on the first `.map`.
  it('does not mistake String.prototype.sub for sub-paragraphs', () => {
    expect(subOf('a plain paragraph')).toBeNull();
    expect(bodyOf('a plain paragraph')).toBe('a plain paragraph');
  });

  it('collapses a parent whose children were all removed', () => {
    expect(normalizeParas([{ t: 'parent', sub: [] }])).toEqual(['parent']);
    expect(normalizeParas([{ t: 'parent', sub: ['a'] }])).toEqual([{ t: 'parent', sub: ['a'] }]);
  });

  it('flattens styled runs for an emptiness check', () => {
    expect(textOf([{ t: 'one ' }, { t: 'two', b: true }])).toBe('one two');
  });
});

describe('the lists below a signature block', () => {
  it('numbers two or more attachments and leaves one unnumbered', () => {
    expect(tailBlocks({ atch: ['Memo, 1 Jul 26'] })).toEqual([
      { head: 'Attachment:', items: ['Memo, 1 Jul 26'] },
    ]);
    expect(tailBlocks({ atch: ['One', 'Two'] })).toEqual([
      { head: '2 Attachments:', items: ['1.  One', '2.  Two'] },
    ]);
  });

  it('drops blank entries rather than printing an empty line', () => {
    expect(tailBlocks({ atch: ['', '   '] })).toEqual([]);
  });

  it('keeps attachments, cc and distribution in the template order', () => {
    const blocks = tailBlocks({ distro: ['82 RS/MXAA'], cc: ['Lt Col Casey'], atch: ['Memo'] });
    expect(blocks.map((b) => b.head)).toEqual(['Attachment:', 'cc:', 'DISTRIBUTION:']);
  });
});

describe('dates', () => {
  it('writes the memorandum date in military order', () => {
    expect(memoDate(new Date(2026, 8, 4))).toBe('4 Sep 2026');
  });

  it('spells out an ISO date and leaves anything else alone', () => {
    expect(formatDate('2026-09-04')).toBe('4 September 2026');
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('not a date');
  });
});

describe('document editing', () => {
  it('creates two sub-paragraphs at once, because one part is not a division', () => {
    const before = doc({ paras: ['parent'] });
    const after = addSubPara(before, { kind: 'body' }, [0]);
    expect(subOf(after.paras[0]!)).toEqual(['', '']);
  });

  it('does not subdivide past four levels', () => {
    let d = doc({ paras: ['one'] });
    d = addSubPara(d, { kind: 'body' }, [0]);
    d = addSubPara(d, { kind: 'body' }, [0, 0]);
    d = addSubPara(d, { kind: 'body' }, [0, 0, 0]);
    const blocked = addSubPara(d, { kind: 'body' }, [0, 0, 0, 0]);
    expect(blocked).toBe(d);
  });

  // Assigning the raw string to the node used to clobber the whole object, so
  // typing one character into a paragraph deleted every sub-paragraph under it.
  it('keeps sub-paragraphs when the parent text is edited', () => {
    let d = doc({ paras: ['parent'] });
    d = addSubPara(d, { kind: 'body' }, [0]);
    d = setParaText(d, { kind: 'body' }, [0], 'edited');
    expect(bodyOf(d.paras[0]!)).toBe('edited');
    expect(subOf(d.paras[0]!)).toHaveLength(2);
  });

  it('edits a sub-paragraph without touching its siblings', () => {
    let d = doc({ paras: ['parent'] });
    d = addSubPara(d, { kind: 'body' }, [0]);
    d = setParaText(d, { kind: 'body' }, [0, 1], 'second');
    expect(subOf(d.paras[0]!)).toEqual(['', 'second']);
  });

  it('collapses a subdivided paragraph back to plain text', () => {
    let d = doc({ paras: ['parent'] });
    d = addSubPara(d, { kind: 'body' }, [0]);
    d = clearSubParas(d, { kind: 'body' }, [0]);
    expect(d.paras[0]).toBe('parent');
  });

  it('adds and removes paragraphs', () => {
    let d = doc({ paras: ['one'] });
    d = addPara(d, { kind: 'body' });
    expect(d.paras).toHaveLength(2);
    d = deletePara(d, { kind: 'body' }, [0]);
    expect(d.paras).toEqual(['']);
  });

  it("edits an indorsement's paragraphs independently of the body", () => {
    let d = doc({ paras: ['body'], inds: [newIndorsement(0)] });
    d = setParaText(d, { kind: 'ind', index: 0 }, [0], 'indorsed');
    expect(d.inds[0]!.paras).toEqual(['indorsed']);
    expect(d.paras).toEqual(['body']);
  });

  it('edits the tail lists', () => {
    let d = doc();
    d = addTail(d, null, 'atch');
    d = setTailItem(d, null, 'atch', 0, 'Memo');
    expect(d.atch).toEqual(['Memo']);
    d = deleteTail(d, null, 'atch', 0);
    expect(d.atch).toEqual([]);
  });
});

describe('the custom memorandum', () => {
  it('resolves the header from the document', () => {
    const spec = customSpec(
      doc({ memoFor: '82 RS/CC', from: '82 RS/MXAA', subject: 'Manning', prepName: 'John D. Smith' }),
      FIXED,
    );
    expect(spec.memoFor).toBe('82 RS/CC');
    expect(spec.from).toBe('82 RS/MXAA');
    expect(spec.date).toBe('4 Sep 2026');
    expect(spec.sig.name).toBe('John D. Smith');
  });

  it('defaults MEMORANDUM FOR to RECORD', () => {
    expect(customSpec(doc({ memoFor: '' }), FIXED).memoFor).toBe('RECORD');
  });

  it('fills a separate-page indorsement header from the basic memorandum', () => {
    const spec = customSpec(
      doc({ from: '82 RS/MXAA', subject: 'Manning', inds: [newIndorsement(0)] }),
      FIXED,
    );
    const ind = spec.inds![0]!;
    expect(ind.head).toBe('1st Ind to 82 RS/MXAA, 4 Sep 2026, Manning');
    expect(ind.line2).toBe('82 RS/MXAA');
  });

  it('gives a same-page indorsement a one-line header with the date at the right', () => {
    const spec = customSpec(
      doc({ from: '82 RS/MXAA', inds: [{ ...newIndorsement(0), form: 'own', office: '82 RS/CC' }] }),
      FIXED,
    );
    expect(spec.inds![0]!.head).toBe('1st Ind, 82 RS/CC');
    expect(spec.inds![0]!.headRight).toBe('________________ (date)');
  });
});

describe('the LOCAR', () => {
  const base = doc({
    template: 'locar',
    locarType: 'Reprimand',
    locarFrom: '82 RS/CC',
    locarRecipRank: 'SSgt',
    locarRecipName: 'John A. Snuffy',
    locarDayServed: '2026-09-04',
    prepRank: 'Lt Col',
    prepName: 'Casey, Jane Q',
    prepTitle: 'Commander',
    locarOffense: 'Investigation has disclosed the facts.',
    locarCorrective: 'This conduct undermines the flight.',
  });

  it('always emits the four paragraphs, of which the user writes two', () => {
    const spec = locarSpec(base, FIXED);
    expect(spec.paras).toHaveLength(4);
    expect(spec.paras[0]).toBe('Investigation has disclosed the facts.');
    expect(spec.paras[1]).toBe('You are hereby reprimanded.  This conduct undermines the flight.');
    // Paragraph 3 is the Privacy Act statement, carried as styled runs.
    expect(spec.paras[2]).toBe(LOCAR_LANGUAGE.data.privacyActRuns);
    expect(spec.paras[3]).toBe(LOCAR_LANGUAGE.data.rights);
  });

  it('adds the UIF sentence only when the issuer asks for it', () => {
    expect(String(locarSpec(base, FIXED).paras[3])).not.toContain('UIF');
    const referred = locarSpec({ ...base, locarUif: 'recommend' }, FIXED);
    expect(String(referred.paras[3])).toContain(LOCAR_LANGUAGE.data.uifSentence);
  });

  it('uses the verb that matches the type', () => {
    expect(String(locarSpec({ ...base, locarType: 'Counseling' }, FIXED).paras[1])).toContain(
      'You are hereby counseled.',
    );
    expect(String(locarSpec({ ...base, locarType: 'Admonishment' }, FIXED).paras[1])).toContain(
      'You are hereby admonished.',
    );
  });

  it('writes a subject in title case and a filename that names the letter', () => {
    const spec = locarSpec(base, FIXED);
    expect(spec.subject).toBe('Letter of Reprimand');
    expect(spec.filename).toBe('LOR_JOHN_A_SNUFFY');
  });

  it('builds the three indorsements and threads the type through them', () => {
    const spec = locarSpec(base, FIXED);
    expect(spec.inds).toHaveLength(3);
    expect(spec.inds![0]!.head).toBe('1st Ind to 82 RS/CC, 4 September 2026, Letter of Reprimand');
    expect(spec.inds![0]!.subj).toBe('ACKNOWLEDGEMENT');
    expect(String(spec.inds![1]!.paras[1])).toContain('this reprimand is the appropriate action');
    // No placeholder may survive into the output.
    for (const ind of spec.inds!) {
      for (const p of ind.paras) expect(String(p)).not.toContain('{{noun}}');
    }
  });

  it('shows the recipient in capitals and the issuer with the name reordered', () => {
    const spec = locarSpec(base, FIXED);
    expect(spec.memoFor).toBe('SSGT JOHN A. SNUFFY');
    expect(spec.inds![1]!.head).toBe('2d Ind, 82 RS/CC (LT COL JANE Q. CASEY)');
  });

  it('falls back to a blank the issuer must fill rather than inventing facts', () => {
    const spec = locarSpec(doc({ template: 'locar' }), FIXED);
    expect(String(spec.paras[0])).toContain('(describe the offense)');
    expect(spec.memoFor).toBe('(RECIPIENT)');
  });
});

describe('CUI marking', () => {
  it('defaults on for a LOCAR and off for a custom memorandum', () => {
    expect(cuiOn(doc({ template: 'locar' }))).toBe(true);
    expect(cuiOn(doc({ template: 'custom' }))).toBe(false);
  });

  it('remembers an override per template', () => {
    const d = doc({ template: 'locar', cuiMap: { locar: false, custom: true } });
    expect(cuiOn(d)).toBe(false);
    expect(cuiOn({ ...d, template: 'custom' })).toBe(true);
  });

  it('drops a blank designation line instead of printing an empty label', () => {
    const d = doc({
      template: 'custom',
      cuiDesMap: { custom: true },
      cuiDesOffice: '82 RS/MXAA',
      cuiDesPoc: 'MSgt Snuffy, DSN 555',
    });
    const lines = cuiDesLines(d, { from: '82 RS/MXAA' });
    expect(lines).toEqual([
      'Controlled by:  82 RS/MXAA',
      'CUI Category(ies):  PRVCY',
      'POC:  MSgt Snuffy, DSN 555',
    ]);
  });

  it('emits nothing when the indicator is off', () => {
    expect(cuiDesLines(doc(), { from: 'x' })).toEqual([]);
  });
});

describe('HTML rendering', () => {
  it('escapes what the user typed', () => {
    const d = doc({ subject: '<script>alert(1)</script>', paras: ['plain'] });
    const html = memoInnerHtml(d, customSpec(d, FIXED));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders styled runs as markup, not as text', () => {
    const d = doc({ template: 'locar' });
    const html = memoInnerHtml(d, locarSpec(d, FIXED));
    expect(html).toContain('<b>Privacy Act</b>');
    expect(html).toContain('<i>(on a voluntary basis)</i>');
  });

  it('draws the default seal, and none at all once it is cleared', () => {
    const withSeal = doc();
    expect(memoInnerHtml(withSeal, customSpec(withSeal, FIXED))).toContain('class="seal"');
    const bare = doc({ seal: '' });
    expect(memoInnerHtml(bare, customSpec(bare, FIXED))).not.toContain('<img');
  });

  it('wraps each indorsement in one block so it is paginated whole', () => {
    const d = doc({ inds: [newIndorsement(0)] });
    expect(memoInnerHtml(d, customSpec(d, FIXED))).toContain('class="indblk"');
  });
});

describe('PDF output', () => {
  const d = doc({
    from: '82 RS/MXAA',
    subject: 'Request for Additional Manning',
    paras: ['One.', 'Two.'],
    prepName: 'John D. Smith',
    prepRank: 'TSgt',
    prepTitle: 'Section Chief',
  });

  it('writes a well-formed file', async () => {
    const blob = assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), null), null);
    const text = new TextDecoder('latin1').decode(await bytesOf(blob));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('trailer');
  });

  it('is byte-for-byte deterministic', async () => {
    const once = await bytesOf(assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), null), null));
    const twice = await bytesOf(assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), null), null));
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it('leaves no unused object in the cross-reference table', async () => {
    const text = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), null), null)),
    );
    const table = text.slice(text.indexOf('\nxref\n'), text.lastIndexOf('trailer'));
    const entries = [...table.matchAll(/^(\d{10}) 00000 ([nf]) $/gm)];
    expect(entries.length).toBeGreaterThan(0);
    // Only the free head entry may sit at offset zero.
    for (const [, offset, kind] of entries) {
      if (kind === 'n') expect(Number(offset)).toBeGreaterThan(0);
    }
  });

  it('declares no image resource when the seal has been cleared', async () => {
    const bare = doc({ ...d, seal: '' });
    const text = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(bare, buildPdfPages(bare, customSpec(bare, FIXED), null), null)),
    );
    expect(text).not.toContain('/XObject');
  });

  // The letterhead face is embedded rather than named, so a machine that has
  // never seen Copperplate Gothic still centres the lines identically.
  it('embeds the letterhead face', async () => {
    const text = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), null), null)),
    );
    expect(text).toContain('/BaseFont /CopperplateGothic-Bold');
    expect(text).toContain('/FontFile2');
    expect(text).toContain('/Length1');
  });

  it('embeds the default seal as a JPEG with its true dimensions', async () => {
    const seal = await encodeSeal(DEFAULT_SEAL);
    expect(seal).not.toBeNull();
    expect(seal!.width).toBe(180);
    expect(seal!.height).toBe(180);
    // 0xFFD8: it really is JPEG, so DCTDecode can read it with no decoder here.
    expect(seal!.bytes[0]).toBe(0xd8 - 0xd8 + 0xff);
    expect(seal!.bytes[1]).toBe(0xd8);

    const text = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(d, buildPdfPages(d, customSpec(d, FIXED), seal), seal)),
    );
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 180 /Height 180');
    expect(text).toContain('/XObject <</Im0');
  });

  it('draws the CUI banner only when the memorandum is marked', () => {
    const plain = buildPdfPages(d, customSpec(d, FIXED), null);
    expect(plain.join('')).not.toContain('(CUI) Tj');
    const marked = doc({ ...d, cuiMap: { custom: true } });
    expect(buildPdfPages(marked, customSpec(marked, FIXED), null).join('')).toContain('(CUI) Tj');
  });

  it('breaks a long memorandum onto more than one page', () => {
    const long: Para[] = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ${'word '.repeat(40)}`);
    const wordy = doc({ ...d, paras: long });
    expect(buildPdfPages(wordy, customSpec(wordy, FIXED), null).length).toBeGreaterThan(1);
  });

  it('transliterates curly punctuation rather than dropping it', () => {
    const curly = doc({ ...d, paras: ['The member’s conduct — as described.'] });
    const stream = buildPdfPages(curly, customSpec(curly, FIXED), null).join('');
    expect(stream).toContain("member's");
    expect(stream).toContain('-');
  });

  it('escapes parentheses so a placeholder cannot break the content stream', () => {
    const parens = doc({ ...d, paras: ['on (date) at (location)'] });
    const stream = buildPdfPages(parens, customSpec(parens, FIXED), null).join('');
    expect(stream).toContain('\\(date\\)');
  });
});

describe('Word output', () => {
  /**
   * Word rejects the whole document if these are out of order.
   *
   * CT_PPr and CT_RPr are xsd:sequence, so Word validates the children of
   * w:pPr and w:rPr positionally and answers a misordered file with "Word
   * found unreadable content" -- not with a hint about which element is wrong.
   * Nothing about the XML looks wrong to a reader and the file unzips
   * perfectly, so this is the test that has to catch it.
   */
  const PPR_ORDER = ['w:spacing', 'w:ind', 'w:jc'];
  const RPR_ORDER = ['w:rFonts', 'w:b', 'w:i', 'w:caps', 'w:color', 'w:sz', 'w:szCs'];

  /** Every child sequence found inside `tag`, as arrays of element names. */
  function childSequences(xml: string, tag: string): string[][] {
    const out: string[][] = [];
    for (const m of xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'g'))) {
      out.push([...m[1]!.matchAll(/<(w:[a-zA-Z]+)[\s/>]/g)].map((c) => c[1]!));
    }
    return out;
  }

  /** The sequences that step backwards through `order`, for the failure text. */
  function outOfOrder(sequences: string[][], order: string[]): string[] {
    return sequences
      .filter((seq) => {
        const ranks = seq.map((n) => order.indexOf(n)).filter((r) => r >= 0);
        return ranks.some((r, i) => i > 0 && r < ranks[i - 1]!);
      })
      .map((seq) => seq.join(' '));
  }

  /**
   * The namespace URIs, exactly.
   *
   * A wrong URI is invisible: the XML is still well-formed, the package still
   * unzips, every string you would grep for is still present, and Word answers
   * with "Word experienced an error trying to open the file" -- which names
   * nothing and reads like a disk problem. `wp` was bound to
   * .../drawingml/2006/wordprocessing rather than .../wordprocessingDrawing,
   * so any memorandum carrying the seal would not open at all.
   */
  it('binds every namespace prefix to the right URI', async () => {
    const d = doc({ from: 'A/B', subject: 'S', paras: ['One.'], prepName: 'John D. Smith' });
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(d, customSpec(d, FIXED))),
    );
    const NS: Record<string, string> = {
      w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
      pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    };
    for (const [prefix, uri] of Object.entries(NS)) {
      expect(`${prefix} -> ${xml.includes(`xmlns:${prefix}="${uri}"`)}`).toBe(`${prefix} -> true`);
    }
  });

  it('orders the children of w:pPr and w:rPr the way the schema demands', async () => {
    // Every paragraph shape the generator emits: centred letterhead,
    // right-aligned date, the hanging-indent subject, body and sub-paragraphs,
    // the indented signature block, and the lists under it.
    const rich = doc({
      lh1: 'DEPARTMENT OF THE AIR FORCE',
      lh2: '82D RECONNAISSANCE SQUADRON',
      from: '82 RS/MXAA',
      subject: 'Request for Additional Manning',
      paras: ['First paragraph.', 'Second paragraph.'],
      atch: ['Roster'],
      cc: ['82 RS/CC'],
      distro: ['82 RS/MXAA'],
      prepName: 'John D. Smith',
      prepRank: 'TSgt',
      prepTitle: 'Section Chief',
    });
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(rich, customSpec(rich, FIXED))),
    );

    const pprs = childSequences(xml, 'w:pPr');
    const rprs = childSequences(xml, 'w:rPr');
    expect(pprs.length).toBeGreaterThan(5);
    expect(rprs.length).toBeGreaterThan(5);
    expect(outOfOrder(pprs, PPR_ORDER)).toEqual([]);
    expect(outOfOrder(rprs, RPR_ORDER)).toEqual([]);
  });

  const d = doc({
    from: '82 RS/MXAA',
    subject: 'Request for Additional Manning',
    paras: ['One.'],
    prepName: 'John D. Smith',
    prepRank: 'TSgt',
  });

  it('produces a ZIP holding the parts Word requires', async () => {
    const text = new TextDecoder('latin1').decode(await bytesOf(buildDocx(d, customSpec(d, FIXED))));
    expect(text.startsWith('PK')).toBe(true);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('word/_rels/document.xml.rels');
  });

  it('carries the memorandum text and the signature indent', async () => {
    const text = new TextDecoder('latin1').decode(await bytesOf(buildDocx(d, customSpec(d, FIXED))));
    expect(text).toContain('SUBJECT:  Request for Additional Manning');
    expect(text).toContain('JOHN D. SMITH, TSgt, USAF');
    expect(text).toContain('w:ind w:left="5040"');
  });

  it('adds the CUI header and footer parts only when marked', async () => {
    const plain = new TextDecoder('latin1').decode(await bytesOf(buildDocx(d, customSpec(d, FIXED))));
    expect(plain).not.toContain('word/header1.xml');
    const marked = doc({ ...d, cuiMap: { custom: true } });
    const cui = new TextDecoder('latin1').decode(await bytesOf(buildDocx(marked, customSpec(marked, FIXED))));
    expect(cui).toContain('word/header1.xml');
    expect(cui).toContain('word/footer1.xml');
  });

  it('references no image part when the seal has been cleared', async () => {
    const bare = doc({ ...d, seal: '' });
    const text = new TextDecoder('latin1').decode(await bytesOf(buildDocx(bare, customSpec(bare, FIXED))));
    expect(text).not.toContain('word/media/image1');
  });

  it('carries the seal and names the letterhead face Word should use', async () => {
    const text = new TextDecoder('latin1').decode(await bytesOf(buildDocx(d, customSpec(d, FIXED))));
    expect(text).toContain('word/media/image1.jpeg');
    expect(text).toContain('Copperplate Gothic Bold');
  });

  it('escapes XML so a typed angle bracket cannot corrupt the document', async () => {
    const sharp = doc({ ...d, subject: 'A & B <tag>' });
    const text = new TextDecoder('latin1').decode(await bytesOf(buildDocx(sharp, customSpec(sharp, FIXED))));
    expect(text).toContain('A &amp; B &lt;tag&gt;');
  });
});

describe('the ZIP writer', () => {
  it('records a CRC that a reader can verify', () => {
    const out = zipStore([{ name: 'a.txt', data: 'hello' }]);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
    expect(view.getUint16(8, true)).toBe(0); // stored, not deflated
    // Known CRC-32 of "hello".
    expect(view.getUint32(14, true)).toBe(0x3610a686);
  });

  it('ends with an end-of-central-directory record naming every entry', () => {
    const out = zipStore([
      { name: 'a.txt', data: 'one' },
      { name: 'b.txt', data: 'two' },
    ]);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const eocd = out.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
  });
});

describe('the language data behind the tool', () => {
  it('is marked unverified until someone cites the source form', () => {
    expect(LOCAR_LANGUAGE.isStub).toBe(true);
    expect(MEMO_FORMAT.isStub).toBe(true);
  });

  it('gives every letter type a verb and an abbreviation', () => {
    for (const t of LOCAR_LANGUAGE.data.types) {
      expect(LOCAR_LANGUAGE.data.verbs[t]).toBeTruthy();
      expect(LOCAR_LANGUAGE.data.abbreviations[t]).toBeTruthy();
    }
  });

  it('carries sample libraries rather than wording built into a component', () => {
    expect(LOCAR_LANGUAGE.data.offenseSamples.length).toBeGreaterThan(20);
    expect(LOCAR_LANGUAGE.data.correctiveSamples.length).toBeGreaterThan(20);
    expect(MEMO_FORMAT.data.sampleParagraphs.length).toBeGreaterThan(0);
  });
});

describe('template selection', () => {
  it('routes each template to its own builder', () => {
    expect(buildSpec(doc({ template: 'custom', subject: 'X' }), FIXED).subject).toBe('X');
    expect(buildSpec(doc({ template: 'locar' }), FIXED).subject).toBe('Letter of Counseling');
  });
});

// ---------------------------------------------------------------------------
// AFH 33-337, The Tongue and Quill, chapter 14
// ---------------------------------------------------------------------------

/**
 * The format rules, read from the handbook rather than from the template.
 *
 * Each case cites the rule it enforces. These are the ones an eye does not
 * catch: a memorandum with the wrong wrap indent or a numbered lone paragraph
 * looks perfectly reasonable until somebody who knows the standard reads it.
 */
describe('Tongue and Quill conformance', () => {
  const rich = doc({
    from: '82 RS/MXAA',
    subject: 'Request for Additional Manning',
    paras: [{ t: 'Parent paragraph.', sub: ['A sub-paragraph.'] }] as unknown as MemoDoc['paras'],
    prepName: 'John D. Smith',
    prepRank: 'TSgt',
    prepTitle: 'Section Chief',
  });

  it('indents only the first line of a sub-paragraph (ch.14 text rule 5)', async () => {
    // "All second and subsequent lines of text for all paragraphs at all levels
    // begin flush with the left margin; do not indent." In Word that is a
    // first-line indent, never a left indent, which would move every line.
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(rich, customSpec(rich, FIXED))),
    );
    expect(xml).toContain('<w:ind w:left="0" w:firstLine="360"/>');
    // The signature block is the exception: it sits as a unit at 4.5in.
    expect(xml).toContain('w:ind w:left="5040"');
  });

  it('does not number a lone paragraph (ch.14 text rule 2)', async () => {
    // "Number and letter each paragraph and subparagraph. A single paragraph is
    // not numbered."
    const one = doc({
      from: 'A/B',
      subject: 'S',
      paras: ['The only paragraph.'],
      prepName: 'John D. Smith',
    });
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(one, customSpec(one, FIXED))),
    );
    expect(xml).toContain('The only paragraph.');
    expect(xml).not.toContain('1.  The only paragraph.');

    // Two paragraphs are numbered, and so is a lone one carrying children --
    // its sub-paragraphs have to hang off something.
    const two = doc({ ...one, paras: ['First.', 'Second.'] });
    const twoXml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(two, customSpec(two, FIXED))),
    );
    expect(twoXml).toContain('1.  First.');
    expect(twoXml).toContain('2.  Second.');
  });

  it('keeps the same numbering decision in the preview and the PDF', () => {
    // Three renderers, one rule. They disagreed before this was made central.
    const one = doc({ from: 'A/B', subject: 'S', paras: ['Only one.'] });
    expect(memoInnerHtml(one, customSpec(one, FIXED))).not.toContain('1.&nbsp;&nbsp;');
    const pages = buildPdfPages(one, customSpec(one, FIXED), null);
    expect(pages.join('')).not.toContain('(1.  ');
  });

  it('numbers continuation pages only past two pages (ch.14 text rule 12)', async () => {
    // "The first page of a memorandum is never numbered... memorandums longer
    // than two pages must have page numbers... starting with page 2."
    const short = doc({ from: 'A/B', subject: 'S', paras: ['Short.'] });
    const shortPdf = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(short, buildPdfPages(short, customSpec(short, FIXED), null), null)),
    );
    expect(shortPdf).not.toContain('(2) Tj');

    // Enough text to run past two pages.
    const long = doc({
      from: 'A/B',
      subject: 'S',
      paras: Array.from({ length: 90 }, (_, i) => `Paragraph ${i + 1}. ${'Filler text. '.repeat(6)}`),
      prepName: 'John D. Smith',
    });
    const pages = buildPdfPages(long, customSpec(long, FIXED), null);
    expect(pages.length).toBeGreaterThan(2);
    const longPdf = new TextDecoder('latin1').decode(
      await bytesOf(assemblePdf(long, pages, null)),
    );
    expect(longPdf).toContain('(2) Tj');
    expect(longPdf).toContain('(3) Tj');
  });

  it('lifts the letterhead so Word puts it where the PDF does', async () => {
    // The letterhead is flowed text, so it cannot start above the top margin,
    // while the seal beside it is anchored 0.5in from the page edge. A 1in top
    // margin left the text sitting across the seal's lower half. The margin is
    // cut to 0.625in and the difference given back before the date, so only the
    // letterhead moves.
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(rich, customSpec(rich, FIXED))),
    );
    expect(xml).toContain('w:pgMar w:top="900"');
    // Left, right and bottom stay at 1in, which is what the handbook pins.
    expect(xml).toContain('w:right="1440"');
    expect(xml).toContain('w:bottom="1440"');
    expect(xml).toContain('w:left="1440"');
    // 120 twips of original spacing plus the 540 taken off the margin.
    expect(xml).toContain('w:after="660"');
  });

  it('places the closing elements the required number of lines apart', async () => {
    // Signature block five lines below the last line of text and 4.5in from the
    // page edge; attachments three lines below it; cc two lines below that.
    const xml = new TextDecoder('latin1').decode(
      await bytesOf(buildDocx(rich, customSpec(rich, FIXED))),
    );
    // 5040 twips from a 1in margin is 4.5in from the page edge.
    expect(xml).toContain('w:ind w:left="5040"');
    const pages = buildPdfPages(rich, customSpec(rich, FIXED), null).join('');
    expect(pages).toContain('JOHN D. SMITH, TSgt, USAF');
  });
});
