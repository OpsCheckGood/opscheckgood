import { bodyOf, dutyTitle, paraLabel, sigLine, subOf, tailBlocks,
  numberParagraphs,
} from './format';
import { fontOf, fontSize } from './fonts';
import { cuiDesLines, cuiOn } from './spec';
import { zipStore, type ZipEntry } from './zip';
import type { MemoDoc, MemoSpec, Para, Run } from './types';

/**
 * Word (.docx) export: real OOXML, so it opens editable with no format-mismatch
 * warning.
 *
 * The PDF is the artifact you sign; this is the one you hand to someone who has
 * to change a sentence. Geometry matches the PDF rather than approximating it,
 * because the two are meant to be the same memorandum:
 *
 *   Signature block   w:ind w:left="5040"                   3.5in from the margin
 *   Subject           w:ind w:left="1195" w:hanging="1195"  wrapped subject aligns under its first word
 *
 * The letterhead names Copperplate Gothic Bold -- the face official letterhead
 * uses. Naming a font is not redistributing it: Word uses it where it is
 * installed and substitutes where it is not, and the PDF, which has to be
 * identical everywhere, uses Helvetica Bold instead.
 */

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Signature block: 3.5in from the left margin, in twips. */
const SIG_TWIPS = 5040;
/** Subject hanging indent, in twips. */
const SUBJ_HANG = 1195;
/** A quarter inch per sub-paragraph level, in twips. */
const LEVEL_TWIPS = 360;
const LETTERHEAD_FONT = 'Copperplate Gothic Bold';

function xe(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RunOpts {
  b?: boolean;
  i?: boolean;
  caps?: boolean;
  font?: string;
  sz?: number;
  color?: string;
}

/**
 * A run.
 *
 * The order of the children of `w:rPr` is not a style choice. CT_RPr is an
 * xsd:sequence, so Word validates it positionally and refuses the whole
 * document -- "Word found unreadable content" -- if anything is out of place.
 * It has to be rFonts, b, i, caps, color, sz, szCs, and the ordering test in
 * tests/mfr.test.ts is what keeps it that way.
 */
function run(text: string, o: RunOpts = {}): string {
  let rp = '';
  if (o.font) rp += `<w:rFonts w:ascii="${xe(o.font)}" w:hAnsi="${xe(o.font)}"/>`;
  if (o.b) rp += '<w:b/>';
  if (o.i) rp += '<w:i/>';
  if (o.caps) rp += '<w:caps/>';
  if (o.color) rp += `<w:color w:val="${xe(o.color)}"/>`;
  if (o.sz) rp += `<w:sz w:val="${Math.round(o.sz * 2)}"/><w:szCs w:val="${Math.round(o.sz * 2)}"/>`;
  return `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
}

interface ParaOpts {
  jc?: 'center' | 'right' | 'left';
  hang?: number;
  /** Indents every line: the signature block, which sits as a unit at 4.5in. */
  indent?: number;
  /**
   * Indents only the first line, leaving the rest at the margin.
   *
   * AFH 33-337 chapter 14, rule 5 for the text of a memorandum: "All second
   * and subsequent lines of text for all paragraphs at all levels begin flush
   * with the left margin; do not indent." So a sub-paragraph's number is
   * indented to align under its parent's first character (rule 4) and the text
   * that wraps off it returns to the margin.
   */
  firstLine?: number;
  after?: number;
}

/**
 * A paragraph. Same rule as `run`: CT_PPr is an xsd:sequence, so spacing comes
 * before ind, which comes before jc, whatever order reads more naturally here.
 */
function para(runs: string, o: ParaOpts = {}): string {
  let pp = `<w:spacing w:before="0" w:after="${o.after != null ? o.after : 0}" w:line="240" w:lineRule="auto"/>`;
  if (o.hang) pp += `<w:ind w:left="${o.hang}" w:hanging="${o.hang}"/>`;
  else if (o.indent) pp += `<w:ind w:left="${o.indent}"/>`;
  else if (o.firstLine) pp += `<w:ind w:left="0" w:firstLine="${o.firstLine}"/>`;
  if (o.jc) pp += `<w:jc w:val="${o.jc}"/>`;
  return `<w:p><w:pPr>${pp}</w:pPr>${runs || ''}</w:p>`;
}

/** The seal, anchored 0.5in from the top and left of the page, 1in square. */
function sealRun(): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="Seal"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="Seal"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function signature(name: string, rank: string, title: string, font: string, size: number): string {
  // Four empty lines, then the name on the fifth.
  let x = '';
  for (let i = 0; i < 4; i++) x += para('', { after: 0 });
  x += para(run(sigLine(name, rank), { font, sz: size }), { indent: SIG_TWIPS, after: 0 });
  if (title) x += para(run(dutyTitle(title), { font, sz: size }), { indent: SIG_TWIPS, after: 240 });
  return x;
}

function paraRuns(p: Para, prefix: string, font: string, size: number): string {
  const body = bodyOf(p);
  if (typeof body === 'string') return run(prefix + body, { font, sz: size });
  return [run(prefix, { font, sz: size })]
    .concat((body as Run[]).map((r) => run(r.t, { font, sz: size, b: r.b, i: r.i })))
    .join('');
}

function subParas(p: Para, font: string, size: number, level = 0): string {
  const sub = subOf(p);
  if (!sub) return '';
  const next = level + 1;
  return sub
    .map(
      (sp, j) =>
        para(paraRuns(sp, `${paraLabel(next, j)}  `, font, size), {
          after: 240,
          firstLine: LEVEL_TWIPS * next,
        }) + subParas(sp, font, size, next),
    )
    .join('');
}

function memoBodyXml(doc: MemoDoc, spec: MemoSpec): string {
  const font = fontOf(doc).word;
  const size = fontSize(doc);
  const color = (doc.lhColor || '#000099').replace('#', '');
  const lhRun = (text: string, sz: number) =>
    run(text, { font: LETTERHEAD_FONT, b: true, caps: true, sz, color });

  let x = para((doc.seal ? sealRun() : '') + lhRun(doc.lh1, 12), { jc: 'center', after: 0 });
  x += para(lhRun(doc.lh2, 10.5), { jc: 'center', after: 0 });
  if (doc.lh3) x += para(lhRun(doc.lh3, 10.5), { jc: 'center', after: 0 });
  x += para('', { after: 120 });

  x += para(run(spec.date, { font, sz: size }), { jc: 'right', after: 240 });
  x += para(run(`MEMORANDUM FOR  ${spec.memoFor || 'RECORD'}`, { font, sz: size }), { after: 240 });
  x += para(run(`FROM:  ${spec.from || ''}`, { font, sz: size }), { after: 240 });
  x += para(run(`SUBJECT:  ${spec.subject || ''}`, { font, sz: size }), {
    after: 240,
    hang: SUBJ_HANG,
  });

  const numbered = numberParagraphs(spec.paras || []);
  for (const [i, p] of (spec.paras || []).entries()) {
    x += para(paraRuns(p, numbered ? `${i + 1}.  ` : '', font, size), { after: 240 });
    x += subParas(p, font, size);
  }

  const tailXml = (o: { atch?: string[]; cc?: string[]; distro?: string[] }) =>
    tailBlocks(o)
      .map((b, bi) => {
        // Second line below the previous element; the first sits on the third
        // line below the duty title.
        let a = para('', { after: 0 });
        if (bi === 0) a += para('', { after: 0 });
        a += para(run(b.head, { font, sz: size }), { after: 0 });
        for (const t of b.items) a += para(run(t, { font, sz: size }), { after: 0 });
        return a;
      })
      .join('');

  x += signature(spec.sig.name, spec.sig.rank, spec.sig.title, font, size);
  x += tailXml(spec);

  for (const ind of spec.inds || []) {
    x += para('', { after: 0 });
    x += para(
      run(ind.head, { font, sz: size }) +
        (ind.headRight ? `<w:r><w:tab/></w:r>${run(ind.headRight, { font, sz: size })}` : ''),
      { after: 240 },
    );
    if (ind.line2) {
      x += para(
        run(ind.line2, { font, sz: size }) +
          (ind.line2Right ? `<w:r><w:tab/></w:r>${run(ind.line2Right, { font, sz: size })}` : ''),
        { after: 240 },
      );
    }
    if (ind.memoFor) x += para(run(ind.memoFor, { font, sz: size }), { after: 240 });
    if (ind.subj) x += para(run(ind.subj, { font, sz: size }), { after: 240 });
    for (const [i, p] of (ind.paras || []).entries()) {
      x += para(paraRuns(p, ind.numbered ? `${i + 1}.  ` : '', font, size), { after: 240 });
      x += subParas(p, font, size);
    }
    x += signature(ind.sig.name, ind.sig.rank, ind.sig.title, font, size);
    x += tailXml(ind);
  }
  return x;
}

function sealPart(dataUrl: string): { ext: 'png' | 'jpeg'; bytes: Uint8Array } | null {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpe?g);base64,([\s\S]*)$/);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255;
  return { ext: m[1] === 'png' ? 'png' : 'jpeg', bytes };
}

/**
 * Builds the .docx.
 *
 * The designation indicator goes in a first-page footer -- `w:titlePg` plus a
 * `first` footer reference is Word's own "first page only", which is exactly
 * what DoDI 5200.48 3.4(f) asks for.
 */
export function buildDocx(doc: MemoDoc, spec: MemoSpec): Blob {
  const seal = sealPart(doc.seal);
  const cui = cuiOn(doc);
  const des = cuiDesLines(doc, spec);

  const sectRef =
    (cui
      ? '<w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>'
      : '') + (des.length ? '<w:footerReference w:type="first" r:id="rId4"/><w:titlePg/>' : '');

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:document xmlns:w="${WNS}" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    // wordprocessingDrawing, not wordprocessing. The short form is a namespace
    // Word does not know, so the seal's <wp:anchor> is unrecognised and the
    // whole document fails to open -- with a generic "error trying to open the
    // file" that names nothing. Pinned by a test, because a wrong URI is
    // invisible to well-formedness checks, to unzip, and to reading it.
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
    memoBodyXml(doc, spec) +
    `<w:sectPr>${sectRef}<w:pgSz w:w="12240" w:h="15840"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="360" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    (cui
      ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      : '') +
    (des.length
      ? '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
      : '') +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    (seal
      ? `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.${seal.ext}"/>`
      : '') +
    (cui
      ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
      : '') +
    (des.length
      ? '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>'
      : '') +
    '</Relationships>';

  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ];
  if (seal) files.push({ name: `word/media/image1.${seal.ext}`, data: seal.bytes });

  if (cui) {
    const banner = (tag: 'hdr' | 'ftr') =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} xmlns:w="${WNS}">` +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>CUI</w:t></w:r></w:p>' +
      `</w:${tag}>`;
    files.push({ name: 'word/header1.xml', data: banner('hdr') });
    files.push({ name: 'word/footer1.xml', data: banner('ftr') });
  }

  if (des.length) {
    // Lines left-justified, indented to the same column the signature block
    // uses, so the block reads as bottom-right with its own text flush left.
    const body =
      (cui ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>CUI</w:t></w:r></w:p>' : '') +
      des
        .map(
          (t) =>
            `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>` +
            `<w:ind w:left="${SIG_TWIPS}"/><w:jc w:val="left"/></w:pPr>` +
            `<w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${xe(
              t,
            )}</w:t></w:r></w:p>`,
        )
        .join('');
    files.push({
      name: 'word/footer2.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${WNS}">${body}</w:ftr>`,
    });
  }

  return new Blob([zipStore(files)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
