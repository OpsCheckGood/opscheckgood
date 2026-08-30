import { bodyOf, dutyTitle, paraLabel, sigLine, subOf, tailBlocks } from './format';
import { baseline, fontOf, fontSize, lineHeight, textWidth, type StyleCode } from './fonts';
import { cuiDesLines, cuiOn } from './spec';
import { COPPERPLATE_TTF_BASE64, COPPERPLATE_WIDTHS } from './assets/letterheadFont';
import type { MemoDoc, MemoSpec, Para, Run, SpecIndorsement } from './types';

/**
 * A US Letter PDF, written byte by byte.
 *
 * No library, because a library is a runtime dependency and every dependency is
 * one more thing that can reach the network (constraint 1). The body is set in
 * base-14 fonts, which need no embedding; the letterhead face is embedded whole
 * so it renders the same on a machine that has never seen it. The seal goes in
 * as JPEG bytes -- the one image format a PDF reads with no decoder of ours.
 *
 * The layout is absolute: text is placed word by word at measured coordinates
 * rather than flowed by a renderer. That is what makes the output identical on
 * every machine, which is the whole reason for producing a PDF at all.
 */

const PAGE_H = 792;
const LEFT = 72;
const RIGHT = 540;
const WIDTH = RIGHT - LEFT;
const CENTER = 306;
const BLACK = '0 0 0';
/** Last baseline a body line may occupy before the page is full. */
const BOTTOM = 720;
/** Signature block indent: 4.5in from the left page edge, as the template lays it out. */
const SIG_X = 324;
/** Quarter inch, one sub-paragraph level. */
const INDENT = 18;
/**
 * Top of the date's line box. The letterhead block ends at 125.65pt and Word
 * leaves 2.27pt before the date.
 */
const DATE_TOP = 127.92;

/**
 * PDF string literals are Latin-1. Curly quotes and dashes are transliterated
 * rather than dropped, because they are what a word processor produces and a
 * memorandum full of missing apostrophes is not an acceptable output.
 */
function pdfEscape(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xb7]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export interface SealImage {
  /** Raw JPEG bytes. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
}

/**
 * Pixel dimensions from a JPEG's start-of-frame marker.
 *
 * The PDF image dictionary has to state the true /Width and /Height or readers
 * reject the stream, and the browser is not always available to ask -- the same
 * code builds a PDF in a test with no DOM at all.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    // Standalone markers carry no length; everything else is a segment.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    // SOF0..SOF15, excluding the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * Turns whatever the letterhead is carrying into embeddable JPEG bytes.
 *
 * A JPEG -- which the bundled seal is -- passes straight through, so the PDF is
 * byte-for-byte reproducible and needs no browser. Anything else the user
 * uploaded goes through a canvas, which accepts any format the browser can
 * decode and hands back the one a PDF reads. Transparency is composited onto
 * white, because letterhead is printed on paper.
 */
export async function encodeSeal(dataUrl: string, size = 360): Promise<SealImage | null> {
  if (!dataUrl) return null;

  const jpeg = /^data:image\/jpe?g;base64,([\s\S]*)$/.exec(dataUrl);
  if (jpeg) {
    const bytes = base64ToBytes(jpeg[1]!);
    const dims = jpegSize(bytes);
    if (dims) return { bytes, ...dims };
  }

  if (typeof document === 'undefined') return null;
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  // Letterhead seals are square; anything else is fitted inside without stretching.
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  const encoded = canvas.toDataURL('image/jpeg', 0.92);
  return { bytes: base64ToBytes(encoded.slice(encoded.indexOf(',') + 1)), width: size, height: size };
}

function colorOf(hex: string): string {
  const h = String(hex || '#000099').replace('#', '');
  const c = (i: number) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3);
  return `${c(0)} ${c(2)} ${c(4)}`;
}

/** Letterhead content stream: seal at 1in, three centred lines above the body. */
function letterheadStream(doc: MemoDoc, seal: SealImage | null): string {
  let cs = seal ? `q 72 0 0 72 36 ${(PAGE_H - 36 - 72).toFixed(2)} cm /Im0 Do Q\n` : '';
  const rgb = colorOf(doc.lhColor);
  const line = (top: number, text: string, size: number) => {
    const s = String(text || '').toUpperCase();
    if (!s) return;
    const x = CENTER - textWidth(doc, s, 5, size) / 2;
    cs += `q ${rgb} rg BT /F5 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - top).toFixed(
      2,
    )} Tm (${pdfEscape(s)}) Tj ET Q\n`;
  };
  line(55.68, doc.lh1, 12);
  line(68.64, doc.lh2, 10.56);
  if (doc.lh3) line(80.3, doc.lh3, 10.56);
  return cs;
}

/** CUI banner: centred, ~0.3in from the top and bottom edges, inside the margin. */
function cuiStream(doc: MemoDoc): string {
  const size = 11;
  const x = CENTER - textWidth(doc, 'CUI', 1, size) / 2;
  return (
    `q 0 0 0 rg BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - 22).toFixed(2)} Tm (CUI) Tj ET Q\n` +
    `q 0 0 0 rg BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} 22 Tm (CUI) Tj ET Q\n`
  );
}

// ---------------------------------------------------------------------------
// Layout

interface Token {
  t: string;
  b?: boolean;
  i?: boolean;
  space: boolean;
}

function tokenize(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const re = /(\s+|\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.t)) !== null) {
      out.push({ t: m[0]!, b: r.b, i: r.i, space: /^\s/.test(m[0]!) });
    }
  }
  return out;
}

function asRuns(p: Para, prefix: string): Run[] {
  const body = bodyOf(p);
  const pre: Run[] = prefix ? [{ t: prefix }] : [];
  return typeof body === 'string' ? pre.concat([{ t: body }]) : pre.concat(body || []);
}

/**
 * Builds the page content streams for one memorandum.
 *
 * Pagination is the part worth reading. Two rules from the template drive it:
 * a paragraph split across pages must leave at least two lines on both, and the
 * signature block may never be stranded on a page with no body text above it.
 * `keepSig` reserves the signature's height while flowing the last paragraph so
 * the two move together.
 */
export function buildPdfPages(doc: MemoDoc, spec: MemoSpec, seal: SealImage | null): string[] {
  const FS = fontSize(doc);
  const LH = lineHeight(doc);
  const GAP = FS;
  const TOP = 72 + baseline(doc);
  const SIG_H = 5 * LH;

  const des = cuiDesLines(doc, spec);
  const DES_SIZE = 8;
  const DES_LH = 9.6;
  const desHeight = des.length ? des.length * DES_LH + DES_LH : 0;

  const pages: string[] = [];
  let cs = '';
  let y = TOP;

  /** Page one gives up the designation indicator's height before anything is placed. */
  const bottom = () => BOTTOM - (pages.length === 0 ? desHeight : 0);

  const tw = (s: string, style: StyleCode, size: number) => textWidth(doc, s, style, size);
  const draw = (x: number, top: number, s: string, style: StyleCode, size: number) => {
    cs += `q ${BLACK} rg BT /F${style} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - top).toFixed(
      2,
    )} Tm (${pdfEscape(s)}) Tj ET Q\n`;
  };
  const newPage = () => {
    pages.push(cs);
    cs = '';
    y = TOP;
  };
  const room = (h: number) => {
    if (y + h > bottom()) newPage();
  };
  const styleOf = (t: Token): StyleCode => (t.b ? 2 : t.i ? 4 : 1);

  /**
   * Flows runs from `x0`, wrapping at `maxW`, breaking pages as needed.
   * `hang` indents every line after the first, which is how a wrapped SUBJECT
   * aligns under its first word rather than falling back to the margin.
   */
  const flow = (runs: Run[], x0: number, maxW: number, hang = 0) => {
    const toks = tokenize(runs);
    room(LH);
    let left = x0;
    let x = x0;
    for (const tk of toks) {
      const style = styleOf(tk);
      const w = tw(tk.t, style, FS);
      if (tk.space) {
        if (x > left) x += w;
        continue;
      }
      if (x + w > x0 + maxW + 0.5 && x > left) {
        y += LH;
        left = x0 + hang;
        x = left;
        room(LH);
      }
      draw(x, y, tk.t, style, FS);
      x += w;
    }
    y += LH;
  };

  /** How many lines a block would take, without drawing it. Mirrors `flow`. */
  const countLines = (runs: Run[], x0: number, maxW: number, hang = 0) => {
    const toks = tokenize(runs);
    let left = x0;
    let x = x0;
    let n = 1;
    for (const tk of toks) {
      const w = tw(tk.t, styleOf(tk), FS);
      if (tk.space) {
        if (x > left) x += w;
        continue;
      }
      if (x + w > x0 + maxW + 0.5 && x > left) {
        n++;
        left = x0 + hang;
        x = left;
      }
      x += w;
    }
    return n;
  };

  const signature = (name: string, rank: string, title: string) => {
    room(70);
    y += 4 * LH;
    draw(SIG_X, y, sigLine(name, rank), 1, FS);
    if (title) {
      y += LH;
      draw(SIG_X, y, dutyTitle(title), 1, FS);
    }
  };

  const flowParas = (list: Para[], numbered: boolean, level: number, keepSig: boolean) => {
    (list || []).forEach((p, i) => {
      if (i || level) y += GAP;
      const x = LEFT + INDENT * level;
      const w = WIDTH - INDENT * level;
      const runs = asRuns(p, numbered || level > 0 ? `${paraLabel(level, i)}  ` : '');
      const n = countLines(runs, x, w);
      const last = keepSig && !level && i === list.length - 1 && !subOf(p);
      const need = n * LH + (last ? SIG_H : 0);
      const fits = bottom() - TOP;
      // Move the whole block down when it cannot leave two lines behind, but
      // never loop on a block that would not fit on an empty page either.
      if (y + need > bottom() && need <= fits && y > TOP) newPage();
      else if (y + 2 * LH > bottom() && y > TOP) newPage();
      flow(runs, x, w);
      const sub = subOf(p);
      if (sub) flowParas(sub, true, level + 1, keepSig);
    });
  };

  const tail = (o: { atch?: string[]; cc?: string[]; distro?: string[] }) => {
    tailBlocks(o).forEach((b, bi) => {
      room(4 * LH + b.items.length * LH);
      // The first element sits on the third line below the duty title; each one
      // after it on the second line below the one before.
      y += bi === 0 ? 3 * LH : 2 * LH;
      draw(LEFT, y, b.head, 1, FS);
      for (const t of b.items) {
        y += LH;
        draw(LEFT, y, t, 1, FS);
      }
    });
  };

  // Page one: letterhead, then the memorandum header.
  cs += letterheadStream(doc, seal);
  const dateY = DATE_TOP + baseline(doc);
  draw(RIGHT - tw(spec.date, 1, FS), dateY, spec.date, 1, FS);
  y = dateY + 2 * LH;
  flow([{ t: `MEMORANDUM FOR  ${spec.memoFor || 'RECORD'}` }], LEFT, WIDTH);
  y += LH;
  draw(LEFT, y, `FROM:  ${spec.from || ''}`, 1, FS);
  y += 2 * LH;
  // The hang is the printed width of the label, so it scales with the body font.
  flow([{ t: `SUBJECT:  ${spec.subject || ''}` }], LEFT, WIDTH, tw('SUBJECT:  ', 1, FS));
  y += GAP;

  flowParas(spec.paras || [], true, 0, true);
  signature(spec.sig.name, spec.sig.rank, spec.sig.title);
  tail(spec);

  /**
   * An indorsement begins on the second line below the last element before it
   * and takes a new page only when the whole block will not fit -- head, body
   * and signature are one unit.
   */
  const indHeight = (ind: SpecIndorsement) => {
    let n = 2; // head plus a blank
    if (ind.line2) n += 2;
    if (ind.memoFor) n += countLines([{ t: ind.memoFor }], LEFT, WIDTH) + 1;
    if (ind.subj) n += 2;
    for (const p of ind.paras || []) n += countLines(asRuns(p, '1.  '), LEFT, WIDTH) + 1;
    return n * LH + SIG_H;
  };

  for (const ind of spec.inds || []) {
    if (y + 2 * LH + indHeight(ind) > bottom()) newPage();
    else y += 2 * LH;
    draw(LEFT, y, ind.head, 1, FS);
    if (ind.headRight) draw(RIGHT - tw(ind.headRight, 1, FS), y, ind.headRight, 1, FS);
    y += 2 * LH;
    if (ind.line2) {
      draw(LEFT, y, ind.line2, 1, FS);
      if (ind.line2Right) draw(RIGHT - tw(ind.line2Right, 1, FS), y, ind.line2Right, 1, FS);
      y += 2 * LH;
    }
    if (ind.memoFor) {
      flow([{ t: ind.memoFor }], LEFT, WIDTH);
      y += LH;
    }
    if (ind.subj) {
      draw(LEFT, y, ind.subj, 1, FS);
      y += LH + GAP;
    }
    flowParas(ind.paras || [], !!ind.numbered, 0, true);
    signature(ind.sig.name, ind.sig.rank, ind.sig.title);
    tail(ind);
  }
  newPage();

  if (des.length) {
    // Page one only. The block sits bottom right, but its lines are left
    // justified with each other -- so one left edge for the whole block, placed
    // so the widest line finishes on the right margin.
    const dx = RIGHT - Math.max(...des.map((t) => tw(t, 1, DES_SIZE)));
    let dy = BOTTOM - desHeight + DES_LH;
    let ds = '';
    for (const t of des) {
      ds += `q ${BLACK} rg BT /F1 ${DES_SIZE} Tf 1 0 0 1 ${dx.toFixed(2)} ${(PAGE_H - dy).toFixed(
        2,
      )} Tm (${pdfEscape(t)}) Tj ET Q\n`;
      dy += DES_LH;
    }
    pages[0] = pages[0]! + ds;
  }

  return cuiOn(doc) ? pages.map((page) => cuiStream(doc) + page) : pages;
}

// ---------------------------------------------------------------------------
// Byte assembly

/**
 * Assembles the pages into a PDF file.
 *
 * Object numbering: 1 catalog, 2 page tree, one object per page, five fonts,
 * an optional seal image, then one content stream per page. The xref table is
 * built from recorded byte offsets, which is why everything is written through
 * one `put`.
 */
export function assemblePdf(doc: MemoDoc, pages: string[], seal: SealImage | null): Blob {
  const list = pages.length ? pages : [''];
  const n = list.length;
  const bytes: number[] = [];
  const offsets: number[] = [];
  const put = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 255);
  };
  const putBytes = (u8: Uint8Array) => {
    for (let i = 0; i < u8.length; i++) bytes.push(u8[i]!);
  };
  const startObj = (num: number) => {
    offsets[num] = bytes.length;
  };

  const pageObj = (i: number) => 3 + i;
  const fontBase = 3 + n;
  // F5 is a real embedded face, so it carries a descriptor and the file itself.
  const descriptorObj = fontBase + 5;
  const fontFileObj = fontBase + 6;
  // With no seal the image object is not reserved at all. Numbering around a
  // gap would leave an xref entry pointing at offset 0 and marked in use, which
  // is a malformed file even though most readers tolerate it.
  const imgObj = fontFileObj + 1;
  const contentBase = fontFileObj + 1 + (seal ? 1 : 0);
  const maxObj = contentBase + n - 1;

  const f = fontOf(doc);
  const resources =
    `<</Font <</F1 ${fontBase} 0 R /F2 ${fontBase + 1} 0 R /F3 ${fontBase + 2} 0 R /F4 ${
      fontBase + 3
    } 0 R /F5 ${fontBase + 4} 0 R>>` + (seal ? ` /XObject <</Im0 ${imgObj} 0 R>>` : '') + '>>';

  put('%PDF-1.4\n%\xff\xff\xff\xff\n');
  startObj(1);
  put('1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n');

  let kids = '';
  for (let i = 0; i < n; i++) kids += `${pageObj(i)} 0 R `;
  startObj(2);
  put(`2 0 obj\n<</Type /Pages /Kids [${kids.trim()}] /Count ${n}>>\nendobj\n`);

  for (let i = 0; i < n; i++) {
    startObj(pageObj(i));
    put(
      `${pageObj(
        i,
      )} 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${
        contentBase + i
      } 0 R>>\nendobj\n`,
    );
  }

  // F1/F2/F4 follow the chosen body font. F3 is Courier-Bold and F5 the
  // letterhead face; both are fixed, so a body-font change cannot move them.
  const type1 = (num: number, name: string) => {
    startObj(num);
    put(`${num} 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding>>\nendobj\n`);
  };
  type1(fontBase, f.pdf[0]);
  type1(fontBase + 1, f.pdf[1]);
  type1(fontBase + 2, 'Courier-Bold');
  type1(fontBase + 3, f.pdf[2]);

  // F5 = Copperplate Gothic Bold, embedded whole, so the letterhead is the real
  // face on any machine rather than a base-14 stand-in that centres differently.
  startObj(fontBase + 4);
  put(
    `${fontBase + 4} 0 obj\n<</Type /Font /Subtype /TrueType /BaseFont /CopperplateGothic-Bold ` +
      `/FirstChar 32 /LastChar 126 /Widths [${COPPERPLATE_WIDTHS.join(' ')}] ` +
      `/Encoding /WinAnsiEncoding /FontDescriptor ${descriptorObj} 0 R>>\nendobj\n`,
  );
  startObj(descriptorObj);
  put(
    `${descriptorObj} 0 obj\n<</Type /FontDescriptor /FontName /CopperplateGothic-Bold /Flags 32 ` +
      '/FontBBox [-133 -250 1257 885] /ItalicAngle 0 /Ascent 885 /Descent -227 /CapHeight 667 ' +
      `/StemV 140 /FontFile2 ${fontFileObj} 0 R>>\nendobj\n`,
  );
  const ttf = base64ToBytes(COPPERPLATE_TTF_BASE64);
  startObj(fontFileObj);
  put(`${fontFileObj} 0 obj\n<</Length ${ttf.length} /Length1 ${ttf.length}>>\nstream\n`);
  putBytes(ttf);
  put('\nendstream\nendobj\n');

  if (seal) {
    startObj(imgObj);
    put(
      `${imgObj} 0 obj\n<</Type /XObject /Subtype /Image /Width ${seal.width} /Height ${seal.height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Length ${seal.bytes.length}>>\nstream\n`,
    );
    putBytes(seal.bytes);
    put('\nendstream\nendobj\n');
  }

  for (let i = 0; i < n; i++) {
    startObj(contentBase + i);
    put(`${contentBase + i} 0 obj\n<</Length ${list[i]!.length}>>\nstream\n`);
    put(list[i]!);
    put('\nendstream\nendobj\n');
  }

  const xref = bytes.length;
  put(`xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= maxObj; i++) {
    put(`${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`);
  }
  put(`trailer\n<</Size ${maxObj + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);

  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

export async function buildPdf(doc: MemoDoc, spec: MemoSpec): Promise<Blob> {
  const seal = doc.seal ? await encodeSeal(doc.seal) : null;
  return assemblePdf(doc, buildPdfPages(doc, spec, seal), seal);
}
