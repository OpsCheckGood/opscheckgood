import { HELVETICA, HELVETICA_BOLD, TIMES_BOLD, TIMES_ROMAN } from '../mfr/fonts';

/**
 * A fillable PDF, written byte by byte.
 *
 * The site's tools run in a browser. Some people need the same tool as a file
 * they can open in Acrobat on a machine with no browser to spare, pass around
 * by email, or keep on a shared drive -- which is how the PT calculator began
 * life. This writes that file: an AcroForm with text fields, drop-downs and
 * read-only output fields, a document-level JavaScript that carries the
 * tool's engine, calculate actions that run it whenever a field changes, and
 * a link back to the site in small type at the foot of each page.
 *
 * No library, for the same reason as the memorandum writer: a dependency is
 * one more thing that can reach the network. The fonts are base-14, which
 * every reader has. Appearances are left to the reader (`NeedAppearances`),
 * which is what lets the fields show their values without this file drawing
 * every glyph itself; Acrobat, Reader, Foxit and Chrome all honour it.
 */

export type FormFont = 'Helv' | 'HeBo' | 'Cour' | 'CoBo' | 'TiRo' | 'TiBo';

const BASE_FONT: Record<FormFont, string> = {
  Helv: 'Helvetica',
  HeBo: 'Helvetica-Bold',
  Cour: 'Courier',
  CoBo: 'Courier-Bold',
  TiRo: 'Times-Roman',
  TiBo: 'Times-Bold',
};

export interface StaticText {
  x: number;
  y: number;
  text: string;
  font: FormFont;
  size: number;
  /** 0 is black, 1 is white. */
  gray?: number;
  /** "r g b" operands; overrides gray. */
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface Rule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  gray?: number;
  width?: number;
}

export type FieldKind =
  /** Single-line text the user types. */
  | 'text'
  /** Multi-line text the user types. */
  | 'multiline'
  /** A drop-down of fixed choices. */
  | 'combo'
  /** Single-line text the script fills; the user cannot edit it. */
  | 'output'
  /** Multi-line text the script fills. */
  | 'outputMultiline';

export interface Field {
  name: string;
  kind: FieldKind;
  /** Left, bottom, width, height in points. */
  rect: [number, number, number, number];
  font?: FormFont;
  /** 0 means auto-size. */
  size?: number;
  options?: string[];
  value?: string;
  /** JavaScript run as this field's calculate action; `event.value` is its result. */
  calculate?: string;
  /** JavaScript run when the user commits a new value. */
  onCommit?: string;
  tooltip?: string;
  /** Character cells for a comb field; unused here but cheap to support. */
  maxLen?: number;
  /** Text alignment inside the field. */
  align?: 'left' | 'center' | 'right';
  /** No background and no border: text sitting on the page, for a preview. */
  plain?: boolean;
}

export interface Link {
  rect: [number, number, number, number];
  url: string;
}

export interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "r g b" operands, or a single grey. */
  color: string;
}

export interface FormPage {
  texts: StaticText[];
  rules: Rule[];
  fields: Field[];
  links: Link[];
  fills?: Fill[];
}

/** The site's palette, as PDF operands. */
export const INK = '0.082 0.094 0.11';
export const PANEL = '0.918 0.914 0.894';
export const RULE = '0.62 0.62 0.6';
export const MUTED = '0.29 0.31 0.33';

function fillOp(color: string): string {
  return color.split(' ').length === 3 ? `${color} rg` : `${color} g`;
}

export interface FormDocument {
  title: string;
  author?: string;
  subject?: string;
  widthPt?: number;
  heightPt?: number;
  pages: FormPage[];
  /** Document-level JavaScript, run when the file opens. */
  script: string;
  /** Names of calculated fields in the order their scripts run. */
  calcOrder?: string[];
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** Width of a string in points, in one of the base-14 faces used here. */
export function measure(font: FormFont, text: string, size: number): number {
  if (font === 'Cour' || font === 'CoBo') return text.length * size * 0.6;
  const table =
    font === 'HeBo' ? HELVETICA_BOLD : font === 'TiRo' ? TIMES_ROMAN : font === 'TiBo' ? TIMES_BOLD : HELVETICA;
  let w = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    w += c < 32 || c > 126 ? table[78]! : table[c - 32]!;
  }
  return (w * size) / 1000;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** A PDF literal string: Latin-1, with the three characters that need escaping. */
export function pdfString(s: string): string {
  const text = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `(${text})`;
}

/** A PDF name: letters, digits and a few marks, everything else hex-escaped. */
function pdfName(s: string): string {
  return `/${s.replace(/[^A-Za-z0-9_.-]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
}

/**
 * JavaScript for a stream: Latin-1 bytes only. Characters beyond that are
 * rewritten as `\uXXXX`, which is valid inside a JavaScript string literal --
 * and the engines that go in here keep every non-ASCII character inside one,
 * because the data is emitted with JSON.stringify.
 */
function jsBytes(source: string): string {
  return source.replace(/[^\x00-\xff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

const FLAG_READONLY = 1;
const FLAG_MULTILINE = 1 << 12;
const FLAG_DO_NOT_SPELLCHECK = 1 << 22;
const FLAG_DO_NOT_SCROLL = 1 << 23;
const FLAG_COMBO = 1 << 17;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function buildFormPdf(doc: FormDocument): Uint8Array {
  const W = doc.widthPt ?? 612;
  const H = doc.heightPt ?? 792;

  const bodies: string[] = [];
  const reserve = (): number => {
    bodies.push('');
    return bodies.length;
  };
  const set = (n: number, body: string) => {
    bodies[n - 1] = body;
  };

  const catalog = reserve();
  const pagesRoot = reserve();
  const info = reserve();
  const fontRefs: Partial<Record<FormFont, number>> = {};
  for (const key of Object.keys(BASE_FONT) as FormFont[]) {
    const n = reserve();
    fontRefs[key] = n;
    set(n, `<</Type /Font /Subtype /Type1 /BaseFont /${BASE_FONT[key]} /Encoding /WinAnsiEncoding>>`);
  }
  const fontDict = (Object.keys(fontRefs) as FormFont[]).map((k) => `/${k} ${fontRefs[k]} 0 R`).join(' ');

  const scriptStream = reserve();
  const scriptAction = reserve();
  const js = jsBytes(doc.script);
  set(scriptStream, `<</Length ${js.length}>>\nstream\n${js}\nendstream`);
  set(scriptAction, `<</S /JavaScript /JS ${scriptStream} 0 R>>`);

  const fieldRefs: number[] = [];
  const fieldByName = new Map<string, number>();
  const pageRefs: number[] = [];

  for (const page of doc.pages) {
    const pageRef = reserve();
    pageRefs.push(pageRef);
    const annots: number[] = [];

    // Static content.
    let content = '';
    for (const fill of page.fills ?? []) {
      content += `${fillOp(fill.color)} ${num(fill.x)} ${num(fill.y)} ${num(fill.w)} ${num(fill.h)} re f\n`;
    }
    for (const rule of page.rules) {
      content += `${num(rule.gray ?? 0)} G ${num(rule.width ?? 0.5)} w ${num(rule.x1)} ${num(rule.y1)} m ${num(rule.x2)} ${num(rule.y2)} l S\n`;
    }
    for (const t of page.texts) {
      const width = measure(t.font, t.text, t.size);
      const x = t.align === 'center' ? t.x - width / 2 : t.align === 'right' ? t.x - width : t.x;
      const color = t.color ? fillOp(t.color) : `${num(t.gray ?? 0)} g`;
      content += `BT /${t.font} ${num(t.size)} Tf ${color} 1 0 0 1 ${num(x)} ${num(t.y)} Tm ${pdfString(t.text)} Tj ET\n`;
    }
    const contentRef = reserve();
    set(contentRef, `<</Length ${content.length}>>\nstream\n${content}\nendstream`);

    for (const field of page.fields) {
      const ref = reserve();
      fieldRefs.push(ref);
      fieldByName.set(field.name, ref);
      annots.push(ref);
      const [x, y, w, h] = field.rect;
      const output = field.kind === 'output' || field.kind === 'outputMultiline';
      const multi = field.kind === 'multiline' || field.kind === 'outputMultiline';
      let flags = FLAG_DO_NOT_SPELLCHECK;
      if (output) flags |= FLAG_READONLY;
      if (multi) flags |= FLAG_MULTILINE | FLAG_DO_NOT_SCROLL;
      if (field.kind === 'combo') flags |= FLAG_COMBO;
      const font = field.font ?? (multi && output ? 'Cour' : 'Helv');
      const size = field.size ?? (multi ? 9 : 0);
      const parts = [
        '/Type /Annot /Subtype /Widget',
        `/FT ${field.kind === 'combo' ? '/Ch' : '/Tx'}`,
        `/T ${pdfString(field.name)}`,
        `/Rect [${num(x)} ${num(y)} ${num(x + w)} ${num(y + h)}]`,
        '/F 4',
        `/P ${pageRef} 0 R`,
        `/Ff ${flags}`,
        `/DA (/${font} ${num(size)} Tf 0 g)`,
        field.plain
          ? '/MK <<>>'
          : output
            ? '/MK <</BG [0.96 0.96 0.94]>>'
            : '/MK <</BG [1 1 1] /BC [0.62 0.62 0.6]>>',
        field.plain ? '/BS <</W 0 /S /S>>' : '/BS <</W 0.5 /S /S>>',
      ];
      if (field.tooltip) parts.push(`/TU ${pdfString(field.tooltip)}`);
      if (field.align === 'center') parts.push('/Q 1');
      else if (field.align === 'right') parts.push('/Q 2');
      if (field.kind === 'combo' && field.options) {
        parts.push(`/Opt [${field.options.map(pdfString).join(' ')}]`);
      }
      if (field.value !== undefined) {
        parts.push(`/V ${pdfString(field.value)} /DV ${pdfString(field.value)}`);
      }
      if (field.maxLen) parts.push(`/MaxLen ${field.maxLen}`);
      const actions: string[] = [];
      if (field.calculate) {
        const s = reserve();
        const code = jsBytes(field.calculate);
        set(s, `<</S /JavaScript /JS ${pdfString(code)}>>`);
        actions.push(`/C ${s} 0 R`);
      }
      if (field.onCommit) {
        const s = reserve();
        const code = jsBytes(field.onCommit);
        set(s, `<</S /JavaScript /JS ${pdfString(code)}>>`);
        actions.push(`/V ${s} 0 R`);
      }
      if (actions.length) parts.push(`/AA <<${actions.join(' ')}>>`);

      // An appearance of its own, so a viewer that does not build one from
      // NeedAppearances still shows a box to type in and the value in it.
      const ap = reserve();
      set(ap, appearanceStream(field, w, h, font, size, output, fontDict));
      parts.push(`/AP <</N ${ap} 0 R>>`);
      set(ref, `<<${parts.join(' ')}>>`);
    }

    for (const link of page.links) {
      const ref = reserve();
      annots.push(ref);
      const [x, y, w, h] = link.rect;
      set(
        ref,
        `<</Type /Annot /Subtype /Link /Rect [${num(x)} ${num(y)} ${num(x + w)} ${num(y + h)}] /Border [0 0 0] /F 4 /A <</S /URI /URI ${pdfString(link.url)}>>>>`,
      );
    }

    set(
      pageRef,
      `<</Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources <</Font <<${fontDict}>>>> /Contents ${contentRef} 0 R /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]>>`,
    );
  }

  const calcOrder = (doc.calcOrder ?? [])
    .map((name) => fieldByName.get(name))
    .filter((n): n is number => n !== undefined);

  set(pagesRoot, `<</Type /Pages /Kids [${pageRefs.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageRefs.length}>>`);
  set(
    catalog,
    `<</Type /Catalog /Pages ${pagesRoot} 0 R ` +
      `/Names <</JavaScript <</Names [(OpsCheckGood) ${scriptAction} 0 R]>>>> ` +
      `/AcroForm <</Fields [${fieldRefs.map((f) => `${f} 0 R`).join(' ')}] /NeedAppearances true ` +
      `/DA (/Helv 0 Tf 0 g) /DR <</Font <<${fontDict}>>>>` +
      (calcOrder.length ? ` /CO [${calcOrder.map((c) => `${c} 0 R`).join(' ')}]` : '') +
      '>>>>',
  );
  set(
    info,
    `<</Title ${pdfString(doc.title)} /Author ${pdfString(doc.author ?? 'Ops Check Good')}` +
      (doc.subject ? ` /Subject ${pdfString(doc.subject)}` : '') +
      ' /Producer (Ops Check Good) /Creator (opscheckgood.github.io/opscheckgood)>>',
  );

  // Serialise with a classic cross-reference table.
  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  bodies.forEach((body, i) => {
    offsets[i + 1] = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= bodies.length; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${bodies.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * The normal appearance of a field: its background, its border, and its
 * value laid out the way the reader would lay it out.
 */
function appearanceStream(
  field: Field,
  w: number,
  h: number,
  font: FormFont,
  size: number,
  output: boolean,
  fontDict: string,
): string {
  const fontSize = size > 0 ? size : Math.min(12, Math.max(6, h * 0.62));
  let content = '';
  if (!field.plain) {
    content += output ? '0.96 0.96 0.94 rg' : '1 1 1 rg';
    content += ` 0 0 ${num(w)} ${num(h)} re f\n`;
    if (!output) content += `0.62 0.62 0.6 RG 0.5 w 0.25 0.25 ${num(w - 0.5)} ${num(h - 0.5)} re S\n`;
  }
  const value = field.value ?? '';
  if (value !== '') {
    const multi = field.kind === 'multiline' || field.kind === 'outputMultiline';
    const lead = fontSize * 1.15;
    const lines = multi ? wrapForWidth(value, font, fontSize, w - 4) : [value];
    content += '/Tx BMC q 1 1 ' + num(w - 2) + ' ' + num(h - 2) + ' re W n BT /' + font + ' ' + num(fontSize) + ' Tf 0 g\n';
    if (multi) {
      let y = h - 2 - fontSize;
      for (const line of lines) {
        content += `1 0 0 1 2 ${num(y)} Tm ${pdfString(line)} Tj\n`;
        y -= lead;
        if (y < -lead) break;
      }
    } else {
      const width = measure(font, value, fontSize);
      const x = field.align === 'center' ? (w - width) / 2 : field.align === 'right' ? w - width - 2 : 2;
      const y = (h - fontSize * 0.72) / 2;
      content += `1 0 0 1 ${num(Math.max(2, x))} ${num(y)} Tm ${pdfString(value)} Tj\n`;
    }
    content += 'ET Q EMC\n';
  }
  return (
    `<</Type /XObject /Subtype /Form /BBox [0 0 ${num(w)} ${num(h)}] ` +
    `/Resources <</Font <<${fontDict}>>>> /Length ${content.length}>>\nstream\n${content}\nendstream`
  );
}

/** Greedy wrap by measured width, for an appearance stream. */
function wrapForWidth(text: string, font: FormFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r\n?|\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(font, candidate, size) <= width || line === '') line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** The site's mark on each page: one small line and a link over it. */
export function branding(pageWidth: number, url = 'https://opscheckgood.github.io/opscheckgood/'): {
  texts: StaticText[];
  links: Link[];
} {
  const label = 'OPS CHECK GOOD';
  const site = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const text = `${label}   ${site}`;
  const size = 7;
  const width = measure('Helv', text, size);
  const x = pageWidth / 2 - width / 2;
  return {
    texts: [{ x: pageWidth / 2, y: 30, text, font: 'Helv', size, gray: 0.55, align: 'center' }],
    links: [{ rect: [x, 26, width, 12], url }],
  };
}
