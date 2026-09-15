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
  const size = 6.5;
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
  await rw.editContent((content, i) =>
    i !== 0
      ? content
      : `${content}\n` +
        `1 1 1 rg 0 ${clearFrom} 612 ${792 - clearFrom} re f\n` +
        `0.082 0.094 0.11 rg 0 ${band} 612 ${HEADER_BAND} re f\n` +
        `BT /F2 15 Tf 1 1 1 rg 1 0 0 1 ${left} ${792 - 21} Tm ${literal(title.toUpperCase())} Tj ET\n` +
        `BT /F1 7.5 Tf 0.78 0.78 0.76 rg 1 0 0 1 ${left} ${792 - 35} Tm ${literal(subtitle)} Tj ET\n`,
  );
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** A published body fat table: percent by circumference row and height column. */
export interface Tier2Table {
  circumference: { start: number; step: number; count: number };
  height: { start: number; step: number; count: number };
  rows: ReadonlyArray<ReadonlyArray<number>>;
}

function patch(source: string, anchor: RegExp, replacement: string, what: string): string {
  const matches = source.match(new RegExp(anchor.source, 'g'));
  if (!matches || matches.length !== 1) {
    throw new Error(`PT calculator script: expected exactly one match for ${what}, found ${matches?.length ?? 0}. Has the source PDF changed?`);
  }
  return source.replace(anchor, replacement);
}

/**
 * The PT calculator's script, brought to the manual where the site was.
 *
 * The scoring tables, the ladders, proration and the ratings are the oracle
 * the site's scorer is tested against and are not touched. The Tier 2 body
 * fat page is where the file and AFMAN 36-2905 disagreed, and the site was
 * corrected on 2026-09-03; this carries the same four corrections into the
 * file so the two cannot answer differently: abdomen, waist and buttocks
 * round down to the quarter inch (Attachment 8), the standard is "under 26%"
 * and "under 36%" rather than "or less" (Table 3.2), the percent is read from
 * the published tables at Attachments 9 and 10 with the DoD equation kept
 * only for a measurement off the end of them, and a met assessment is scored
 * as an exempt component without being counted as an exemption, so the file
 * stops warning of a PFRA hold that para 3.9 does not impose. Every edit is
 * anchored to the exact text it replaces and fails loudly if the file's
 * script has moved on.
 */
export function patchTier2Script(source: string, tables: Record<'male' | 'female', Tier2Table>): string {
  const compact = (t: Tier2Table) =>
    `{c0:${t.circumference.start},cs:${t.circumference.step},h0:${t.height.start},hs:${t.height.step},r:${JSON.stringify(t.rows)}}`;
  let out = source;
  out = patch(
    out,
    /function floorHalfDown\(x\)\{ return Math\.floor\(x \* 2 \+ 1e-9\) \/ 2; \}/,
    [
      'function floorHalfDown(x){ return Math.floor(x * 4 + 1e-9) / 4; } /* AFMAN 36-2905 Atch 8: the quarter inch, not the half */',
      `var BFT = { m: ${compact(tables.male)}, f: ${compact(tables.female)} };`,
      '/* AFMAN 36-2905 Attachments 9 (male) and 10 (female): the published cell, or null off the table. */',
      'function bftLookup(sexF, circ, ht){',
      '  var t = sexF ? BFT.f : BFT.m;',
      '  var ci = Math.round((circ - t.c0) / t.cs), hi = Math.round((ht - t.h0) / t.hs);',
      '  if (ci < 0 || hi < 0 || ci >= t.r.length || hi >= t.r[0].length) return null;',
      '  if (Math.abs(t.c0 + ci * t.cs - circ) > 1e-6 || Math.abs(t.h0 + hi * t.hs - ht) > 1e-6) return null;',
      '  return t.r[ci][hi];',
      '}',
    ].join('\n'),
    'the half-inch rounding',
  );
  out = patch(
    out,
    /S\("BF_Std", sexF \? "36% or less" : "26% or less"\);/,
    'S("BF_Std", sexF ? "under 36%" : "under 26%");',
    'the standard label',
  );
  out = patch(
    out,
    /\/\* DoD circumference equations; DoDI 1308\.3 E3\.1\.2\.1 - whole percent \*\/\s*var pct = null;\s*if \(circ !== null && htR !== null && htR > 0\)\{\s*if \(sexF\) pct = 163\.205 \* lg\(circ\) - 97\.684 \* lg\(htR\) - 78\.387;\s*else\s+pct = 86\.010 \* lg\(circ\) - 70\.041 \* lg\(htR\) \+ 36\.76;\s*pct = Math\.round\(pct\);\s*if \(pct < 0\) pct = 0;\s*\}/,
    [
      '/* AFMAN 36-2905 Atch 9 / Atch 10 first; the DoD equation (DoDI 1308.3) only off the end of the table */',
      '  var pct = null, fromTable = false;',
      '  if (circ !== null && htR !== null && htR > 0){',
      '    pct = bftLookup(sexF, circ, htR);',
      '    if (pct !== null) fromTable = true;',
      '    else {',
      '      if (sexF) pct = 163.205 * lg(circ) - 97.684 * lg(htR) - 78.387;',
      '      else      pct = 86.010 * lg(circ) - 70.041 * lg(htR) + 36.76;',
      '      pct = Math.round(pct);',
      '      if (pct < 0) pct = 0;',
      '    }',
      '  }',
    ].join('\n'),
    'the equation block',
  );
  out = patch(
    out,
    /res = \(pct <= max\) \? "PASS" : "FAIL";\s*\/\* Table 3\.2: 26% \/ 36% or less \*\//,
    'res = (pct < max) ? "PASS" : "FAIL";      /* Table 3.2: "< 26%" / "< 36%" -- equal to the standard does not pass */',
    'the pass test',
  );
  out = patch(
    out,
    /note = "Cross-check " \+ pct \+ "% against " \+ fmtIn\(circ\) \+ " and " \+ fmtIn\(htR\)\s*\+ " in " \+ \(sexF \? "Attachment 10\." : "Attachment 9\."\);/,
    [
      'note = fromTable',
      '         ? "Read from " + (sexF ? "Attachment 10" : "Attachment 9") + " at " + fmtIn(circ) + " and " + fmtIn(htR) + "."',
      '         : fmtIn(circ) + " at " + fmtIn(htR) + " falls outside the published table. This figure is the DoD circumference equation the table is built from, not a published one \\u2014 have it checked.";',
    ].join('\n'),
    'the cross-check note',
  );
  out = patch(
    out,
    /bodyPts = 0; bodyPos = 0; exCount\+\+;(\s*notes\.push\("BFA met)/,
    'bodyPts = 0; bodyPos = 0; /* scored as exempt (para 3.7.2) but not an exemption: no PFRA hold (para 3.9) */$1',
    'the met-assessment branch',
  );
  return out;
}

/**
 * The PT calculator: the scoring script that is the oracle the site's scorer
 * is tested against stays as it is, its Tier 2 page is brought to the manual
 * (see `patchTier2Script`), the document information, which named its author
 * and unit, is replaced, and the site's mark added.
 */
export async function preparePtCalculator(bytes: Uint8Array, tables: Record<'male' | 'female', Tier2Table>): Promise<Uint8Array> {
  const rw = await PdfRewriter.open(bytes);
  const scripts = await rw.documentScripts();
  const main = scripts.find((s) => s.name === 'PFRA');
  if (!main || scripts.length !== 1) throw new Error(`PT calculator: expected one document script named PFRA, found ${scripts.map((s) => s.name).join(', ') || 'none'}`);
  rw.setDocumentScript('PFRA', patchTier2Script(main.source, tables));
  rw.setInfo({
    ...INFO_COMMON,
    Title: 'PT Calculator',
    Subject:
      'Self-calculating Physical Fitness Assessment score worksheet built to AFMAN 36-2905, with the Tier 2 body fat assessment.',
    Keywords: 'PFRA, PT, AFMAN 36-2905, fitness, WHtR, body fat',
  });
  // The print button sat in the original's header; Reader prints anyway.
  rw.removeFields(({ dict }) => dict.get('FT') instanceof PdfName && (dict.get('FT') as PdfName).name === 'Btn');
  // Page 2's printed explanation of the body fat figure, kept true to the script above.
  const explained = ['(The DoD circumference equation, rounded to a whole percent, which is how the Attachment 9 and 10 tables are)', '(generated. Verified against 58 published table cells with no differences. Standard: male 26% or less, female 36% or less.)'];
  await rw.editContent((content, i) => {
    if (i !== 1) return monochrome(content);
    for (const line of explained) if (!content.includes(line)) throw new Error(`PT calculator: page 2 no longer carries ${line}`);
    return monochrome(
      content
        .replace(explained[0]!, literal('Read from the published tables at AFMAN 36-2905 Attachments 9 and 10; the DoD circumference equation is used'))
        .replace(explained[1]!, literal('only where a measurement falls off the end of the table. Standard (Table 3.2): male under 26%, female under 36%.')),
    );
  });
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
