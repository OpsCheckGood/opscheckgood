import { PdfRewriter } from '../pdf/rewrite';
import { PdfName, PdfString, type PdfDict, type PdfObject } from '../pdf/objects';
import { measure } from './writer';

/**
 * Preparing the two forms that came from elsewhere for the site.
 *
 * Both were built by the maintainer before the site existed and carry that
 * origin: a name in the document information, a unit's name and emblem on
 * the page, sample entries in the fields, and, in the promotion builder, a
 * script the site has since generalised. The site is anonymous and serves
 * every unit, so each file goes through this once, at build time, and the
 * scrubbed result is what the site embeds. The originals are never
 * published. What the site then does per download -- filling the fields and
 * locking the file -- is in `downloads.ts`.
 */

export const SITE_URL = 'https://opscheckgood.github.io/opscheckgood/';
const SITE_HOST = 'opscheckgood.github.io/opscheckgood';

const INFO_COMMON = {
  Author: 'Ops Check Good',
  Creator: 'Ops Check Good',
  Producer: 'Ops Check Good',
};

/** The site's palette, as PDF fill and stroke operands. */
export const INK = '0.082 0.094 0.11';
export const PANEL = '0.918 0.914 0.894';
export const RULE = '0.62 0.62 0.6';
export const MUTED = '0.29 0.31 0.33';

/**
 * Every colour a page draws, remapped to paper and ink.
 *
 * The originals were designed in navy with an orange stripe and blue-grey
 * tints; the site is monochrome. Dark colours and saturated accents become
 * ink, light tints become the panel colour, mid greys become rules or muted
 * text, and white stays white. Structure is untouched: bands stay bands,
 * boxes stay boxes, they just stop being blue.
 */
export function monochrome(content: string): string {
  return content.replace(/([\d.]+) ([\d.]+) ([\d.]+) (rg|RG)/g, (whole, r, g, b, op) => {
    const [R, G, B] = [Number(r), Number(g), Number(b)];
    if (R === 1 && G === 1 && B === 1) return whole;
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    let color: string;
    if (op === 'RG') color = lum < 0.45 ? INK : RULE;
    else if (lum < 0.4 || sat > 0.35) color = INK;
    else if (lum > 0.88) color = PANEL;
    else if (lum > 0.6) color = RULE;
    else color = MUTED;
    return `${color} ${op}`;
  });
}

/** A literal string as it appears in a content stream: `(text) Tj`. */
function literal(text: string): string {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/**
 * The site's mark at the foot of a page: one small grey line and a link
 * over it. Drawn with whatever font the page already calls /F1.
 */
async function brandPage(rw: PdfRewriter, pageIndex: number, y: number): Promise<void> {
  const text = `OPS CHECK GOOD   ${SITE_HOST}`;
  const size = 7;
  const width = measure('Helv', text, size);
  const x = 306 - width / 2;
  await rw.editContent((content, i) =>
    i === pageIndex
      ? `${content}\nBT /F1 ${size} Tf 0.55 g 1 0 0 1 ${x.toFixed(2)} ${y} Tm ${literal(text)} Tj ET\n`
      : content,
  );
  const page = rw.pages()[pageIndex]!;
  const link: PdfDict = new Map<string, PdfObject>([
    ['Type', new PdfName('Annot')],
    ['Subtype', new PdfName('Link')],
    ['Rect', [x, y - 3, x + width, y + size + 2]],
    ['Border', [0, 0, 0]],
    ['F', 4],
    ['A', new Map<string, PdfObject>([['S', new PdfName('URI')], ['URI', new PdfString(latin1(SITE_URL))]])],
  ]);
  const ref = rw.add(link);
  const annots = rw.deref(page.get('Annots'));
  if (Array.isArray(annots)) annots.push(ref);
  else page.set('Annots', [ref]);
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * The PT calculator: its script is the oracle the site's scorer is tested
 * against and stays exactly as it is. Only the document information, which
 * named its author and unit, is replaced, and the site's mark added.
 */
export async function preparePtCalculator(bytes: Uint8Array): Promise<Uint8Array> {
  const rw = await PdfRewriter.open(bytes);
  rw.setInfo({
    ...INFO_COMMON,
    Title: 'PT Calculator',
    Subject:
      'Self-calculating Physical Fitness Assessment score worksheet built to AFMAN 36-2905, with the Tier 2 body fat assessment.',
    Keywords: 'PFRA, PT, AFMAN 36-2905, fitness, WHtR, body fat',
  });
  await rw.editContent(monochrome);
  await brandPage(rw, 0, 18);
  return rw.save();
}

/**
 * The promotion script builder: the unit's name and emblem come off the
 * pages, the sample entries come out of the fields, the site's script goes
 * in, and the site's mark replaces the unit's footer.
 */
export async function preparePromotionBuilder(bytes: Uint8Array, engineSource: string): Promise<Uint8Array> {
  const rw = await PdfRewriter.open(bytes);
  rw.setInfo({
    ...INFO_COMMON,
    Title: 'Promotion Script Builder',
    Subject: 'Enlisted promotion ceremony run of show builder.',
  });
  await rw.editContent((content) =>
    // The orange accent carried the title on the navy band; on an ink band it
    // reads in white. The stripe under the band goes white with it.
    monochrome(content.replace(/\.909804 \.45098 \.109804 rg/g, '1 1 1 rg'))
      .replace(/\(82 RS PROMOTION SCRIPT BUILDER\)/g, literal('PROMOTION SCRIPT BUILDER'))
      .replace(/\(82d Reconnaissance Squadron\s+\\267\s+Team 8-Deuce\)/g, literal('Ops Check Good'))
      .replace(/\(82 RS Promotion Script Builder\)/g, literal(`OPS CHECK GOOD   ${SITE_HOST}`))
      // The unit emblem: a form XObject drawn once at the top of page 1.
      .replace(/q\s+[\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm\s+\/FormXob\.[0-9a-f]+ Do\s+Q\s*/g, ''),
  );
  rw.fill({}, true);
  rw.setDocumentScript('OpsCheckGood', engineSource);
  // The footer line already names the site; give it the link.
  const footer = await footerPosition(rw);
  if (footer) await linkAt(rw, footer.page, footer.x, footer.y, footer.width);
  return rw.save();
}

async function footerPosition(rw: PdfRewriter): Promise<{ page: number; x: number; y: number; width: number } | null> {
  let found: { page: number; x: number; y: number; width: number } | null = null;
  await rw.editContent((content, i) => {
    if (found) return content;
    const m = /1 0 0 1 ([\d.]+) ([\d.]+) Tm \(OPS CHECK GOOD   [^)]*\) Tj/.exec(content);
    if (m) found = { page: i, x: Number(m[1]), y: Number(m[2]), width: measure('Helv', `OPS CHECK GOOD   ${SITE_HOST}`, 7) };
    return content;
  });
  return found;
}

async function linkAt(rw: PdfRewriter, pageIndex: number, x: number, y: number, width: number): Promise<void> {
  const page = rw.pages()[pageIndex]!;
  const link: PdfDict = new Map<string, PdfObject>([
    ['Type', new PdfName('Annot')],
    ['Subtype', new PdfName('Link')],
    ['Rect', [x, y - 3, x + width, y + 9]],
    ['Border', [0, 0, 0]],
    ['F', 4],
    ['A', new Map<string, PdfObject>([['S', new PdfName('URI')], ['URI', new PdfString(latin1(SITE_URL))]])],
  ]);
  const ref = rw.add(link);
  const annots = rw.deref(page.get('Annots'));
  if (Array.isArray(annots)) annots.push(ref);
  else page.set('Annots', [ref]);
}
