import { PdfDocument } from './document';
import { PdfName, PdfString, latin1, type PdfObject } from './objects';

/**
 * The XFA packets inside a form, and the two things a form reader needs out
 * of them: the geometry of each text field from the `template` packet, and
 * the text the user typed from the `datasets` packet.
 *
 * XFA is XML, but the packets are read with regular expressions rather than a
 * DOM parser so this runs the same in a browser, in the offline single file
 * and under the test runner. The shapes it reads are fixed by the XFA
 * specification -- `<field name=".." w=".." h=".."><font typeface=".."
 * size=".."/>` -- and the forms this is for are conservative documents from
 * Adobe LiveCycle, not arbitrary XML.
 */

export interface XfaPackets {
  template: string | null;
  datasets: string | null;
  /** Every packet by name, for anything else a caller wants to look at. */
  all: Map<string, string>;
}

const decoder = new TextDecoder('utf-8');

export async function readXfaPackets(doc: PdfDocument): Promise<XfaPackets | null> {
  const catalog = await doc.catalog();
  const acroForm = await doc.resolve(catalog.get('AcroForm'));
  if (!(acroForm instanceof Map)) return null;
  const xfa = await doc.resolve(acroForm.get('XFA'));
  const all = new Map<string, string>();

  if (Array.isArray(xfa)) {
    // [name, stream, name, stream, ...]
    for (let i = 0; i + 1 < xfa.length; i += 2) {
      const name = xfa[i];
      const label = name instanceof PdfString ? name.text : name instanceof PdfName ? name.name : String(i);
      const bytes = await doc.streamOf(xfa[i + 1] as PdfObject);
      if (bytes) all.set(label, decoder.decode(bytes));
    }
  } else if (xfa !== null && xfa !== undefined) {
    const bytes = await doc.streamOf(acroForm.get('XFA'));
    if (bytes) {
      // One packet holding the whole XDP: split it into its named children.
      const whole = decoder.decode(bytes);
      all.set('xdp', whole);
      for (const [name, tag] of [
        ['template', 'template'],
        ['datasets', 'xfa:datasets'],
      ] as const) {
        const m = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`).exec(whole);
        if (m) all.set(name, m[0]);
      }
    }
  } else {
    return null;
  }

  return {
    template: all.get('template') ?? null,
    datasets: all.get('datasets') ?? null,
    all,
  };
}

export interface XfaField {
  name: string;
  /** Field box, in millimetres, as the template states it. */
  widthMm: number | null;
  heightMm: number | null;
  xMm: number | null;
  yMm: number | null;
  typeface: string | null;
  sizePt: number | null;
  /** Insets the text sits inside, reducing the usable width. */
  insetLeftMm: number;
  insetRightMm: number;
  insetTopMm: number;
  insetBottomMm: number;
  /** True when the field is a multi-line text edit. */
  multiLine: boolean;
}

/** "202.321mm", "12pt", "0.5in" to millimetres or points as asked. */
export function toMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|px)?\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2] ?? 'pt') {
    case 'mm': return n;
    case 'cm': return n * 10;
    case 'in': return n * 25.4;
    case 'pt': return (n / 72) * 25.4;
    case 'px': return (n / 96) * 25.4;
    default: return null;
  }
}

export function toPt(value: string | null | undefined): number | null {
  const mm = toMm(value);
  return mm === null ? null : (mm / 25.4) * 72;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

/**
 * Every named field in the template with its box and its font. The field
 * element's own attributes carry the box; the first `<font>` and `<margin>`
 * inside it carry the type and the insets.
 */
export function readTemplateFields(template: string): XfaField[] {
  const fields: XfaField[] = [];
  const open = /<field\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(template)) !== null) {
    const tag = m[0];
    const name = attr(tag, 'name');
    if (!name) continue;
    // The body runs to the matching close; fields do not nest, so the next
    // </field> is it. Acrobat writes it as "</field\n>".
    const close = /<\/field\s*>/g;
    close.lastIndex = m.index;
    const end = close.exec(template)?.index ?? -1;
    const body = end < 0 ? template.slice(m.index) : template.slice(m.index, end);
    // A caption's or a border's margin does not move the text.
    const content = body
      .replace(/<caption\b[\s\S]*?<\/caption\s*>/g, '')
      .replace(/<border\b[\s\S]*?<\/border\s*>/g, '');
    const font = /<font\b[^>]*>/.exec(content)?.[0] ?? '';
    const margin = /<margin\b[^>]*>/.exec(content)?.[0] ?? '';
    const textEdit = /<textEdit\b[^>]*>/.exec(content)?.[0] ?? null;
    fields.push({
      name,
      widthMm: toMm(attr(tag, 'w')),
      heightMm: toMm(attr(tag, 'h')),
      xMm: toMm(attr(tag, 'x')),
      yMm: toMm(attr(tag, 'y')),
      typeface: attr(font, 'typeface'),
      sizePt: toPt(attr(font, 'size')),
      insetLeftMm: toMm(attr(margin, 'leftInset')) ?? 0,
      insetRightMm: toMm(attr(margin, 'rightInset')) ?? 0,
      insetTopMm: toMm(attr(margin, 'topInset')) ?? 0,
      insetBottomMm: toMm(attr(margin, 'bottomInset')) ?? 0,
      multiLine: textEdit !== null && attr(textEdit, 'multiLine') === '1',
    });
  }
  return fields;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/\r\n?/g, '\n');
}

/**
 * Leaf values from the datasets packet, keyed by element name. Only elements
 * holding text (no child elements) are returned, which is every form field.
 * Rich-text values (`<body xmlns=...>`) are flattened to their text with
 * paragraph breaks kept.
 */
export function readDatasetValues(datasets: string): Map<string, string> {
  const values = new Map<string, string>();
  // Acrobat writes closing tags as "</name\n>", so the bracket may follow
  // whitespace on both the open and the close.
  const data = /<xfa:data\b[^>]*>([\s\S]*?)<\/xfa:data\s*>/.exec(datasets)?.[1] ?? datasets;
  const element = /<([A-Za-z_][\w.-]*)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = element.exec(data)) !== null) {
    const name = m[1]!;
    const inner = m[3]!;
    if (/<(?!\/?(?:p|span|br|body|html)\b)[A-Za-z_]/.test(inner)) {
      // Has child elements: a container. Recurse into it.
      for (const [k, v] of readDatasetValues(inner)) if (!values.has(k)) values.set(k, v);
      continue;
    }
    if (values.has(name)) continue;
    let text = inner;
    if (/<(?:p|body|html)\b/.test(text)) {
      text = text
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<\/p>\s*<p\b[^>]*>/g, '\n')
        .replace(/<[^>]+>/g, '');
    }
    values.set(name, decodeXml(text));
  }
  return values;
}

/** For tests and diagnostics: the packet names present, in file order. */
export function packetNames(packets: XfaPackets): string[] {
  return [...packets.all.keys()];
}

export { latin1 };
