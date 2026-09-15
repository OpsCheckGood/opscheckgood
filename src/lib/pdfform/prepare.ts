import { PdfRewriter } from '../pdf/rewrite';
import { PdfName, PdfString, type PdfDict, type PdfObject } from '../pdf/objects';
import { FOOTER_Y, HEADER_BAND, measure } from './writer';
import { SITE_URL as SITE, footerText } from './version';

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

export const SITE_URL = SITE;

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
 * The site's mark at the foot of every page: the site, the current-as-of
 * date, and a link over it. Drawn with whatever font the page calls /F1,
 * which in both originals is Helvetica.
 */
async function brandPages(rw: PdfRewriter): Promise<void> {
  const text = footerText();
  const size = 7;
  const width = measure('Helv', text, size);
  const x = 306 - width / 2;
  await rw.editContent(
    (content) => `${content}\n1 1 1 rg 0 0 612 ${FOOTER_Y + 12} re f\nBT /F1 ${size} Tf 0.5 g 1 0 0 1 ${x.toFixed(2)} ${FOOTER_Y} Tm ${literal(text)} Tj ET\n`,
  );
  for (const page of rw.pages()) {
    const link: PdfDict = new Map<string, PdfObject>([
      ['Type', new PdfName('Annot')],
      ['Subtype', new PdfName('Link')],
      ['Rect', [x, FOOTER_Y - 4, x + width, FOOTER_Y + 8]],
      ['Border', [0, 0, 0]],
      ['F', 4],
      ['A', new Map<string, PdfObject>([['S', new PdfName('URI')], ['URI', new PdfString(latin1(SITE_URL))]])],
    ]);
    const ref = rw.add(link);
    const annots = rw.deref(page.get('Annots'));
    if (Array.isArray(annots)) annots.push(ref);
    else page.set('Annots', [ref]);
  }
}

/**
 * The standard header, painted over the original's on the first page: white
 * over whatever the original drew from `clearFrom` up, then the ink band
 * with the tool's name, what it is, and the site's name. Later pages keep
 * their own smaller headings.
 */
async function paintHeader(rw: PdfRewriter, title: string, subtitle: string, clearFrom: number): Promise<void> {
  const left = 54;
  const band = 792 - HEADER_BAND;
  const site = 'OPS CHECK GOOD';
  const siteX = 612 - left - measure('HeBo', site, 8);
  await rw.editContent((content, i) =>
    i !== 0
      ? content
      : `${content}\n` +
        `1 1 1 rg 0 ${clearFrom} 612 ${792 - clearFrom} re f\n` +
        `0.082 0.094 0.11 rg 0 ${band} 612 ${HEADER_BAND} re f\n` +
        `BT /F2 15 Tf 1 1 1 rg 1 0 0 1 ${left} ${792 - 21} Tm ${literal(title.toUpperCase())} Tj ET\n` +
        `BT /F1 7.5 Tf 0.78 0.78 0.76 rg 1 0 0 1 ${left} ${792 - 35} Tm ${literal(subtitle)} Tj ET\n` +
        `BT /F2 8 Tf 1 1 1 rg 1 0 0 1 ${siteX.toFixed(2)} ${792 - 27} Tm ${literal(site)} Tj ET\n`,
  );
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
  // The print button sat in the original's header; Reader prints anyway.
  rw.removeFields(({ dict }) => dict.get('FT') instanceof PdfName && (dict.get('FT') as PdfName).name === 'Btn');
  await rw.editContent(monochrome);
  // The original's band runs from 748 to 780; the standard band covers it.
  await paintHeader(rw, 'PT Calculator', 'Physical fitness assessment scoring to AFMAN 36-2905, with the Tier 2 body fat assessment', 748);
  await brandPages(rw);
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
      // Page 1's title and subtitle are painted over below; later pages
      // keep a small heading of their own. The unit's footer goes.
      .replace(/\(82 RS PROMOTION SCRIPT BUILDER\)/g, literal('PROMOTION SCRIPT BUILDER'))
      .replace(/\(82d Reconnaissance Squadron\s+\\267\s+Team 8-Deuce\)/g, literal(''))
      .replace(/\(82 RS Promotion Script Builder\)/g, literal(''))
      // The unit emblem: a form XObject drawn once at the top of page 1.
      .replace(/q\s+[\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm\s+\/FormXob\.[0-9a-f]+ Do\s+Q\s*/g, ''),
  );
  rw.fill({}, true);
  rw.setDocumentScript('OpsCheckGood', engineSource);
  // The original's band runs from 684 to 792; the standard band covers its top and white the rest.
  await paintHeader(rw, 'Promotion Script Builder', 'Enlisted promotion ceremony run of show: names in, script out, with the charge the new grade calls for', 684);
  await brandPages(rw);
  return rw.save();
}
