import { bodyOf, dutyTitle, paraLabel, sigLine, subOf, tailBlocks } from './format';
import { cuiDesLines, cuiOn } from './spec';
import type { MemoDoc, MemoSpec, Para, Run } from './types';
import { fontOf, fontSize, lineFactor } from './fonts';
import { COPPERPLATE_TTF_BASE64, LETTERHEAD_FAMILY } from './assets/letterheadFont';

/**
 * The memorandum as HTML. One renderer, two consumers: the live preview and the
 * browser print view.
 *
 * It deliberately mirrors the PDF's geometry rather than approximating it --
 * same letterhead heights, same signature indent, same quarter-inch per
 * sub-paragraph level -- so what a user checks on screen is what comes out of
 * the download.
 */

export function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The letterhead face, embedded.
 *
 * Named alone it would render only where it is installed, so the preview, the
 * print view and the PDF would each show a different letterhead depending on
 * the machine. Embedded as a data URL, all three agree -- and the same bytes
 * back the PDF's FontFile2 stream, so the widths the PDF measures are the
 * widths the browser draws.
 */
export const LETTERHEAD_FACE = `@font-face{font-family:'${LETTERHEAD_FAMILY}';font-weight:700;font-style:normal;font-display:block;src:url(data:font/truetype;charset=utf-8;base64,${COPPERPLATE_TTF_BASE64}) format('truetype')}`;

/** Falls back to a locally installed copy, then to any glyphic face. */
const LETTERHEAD_STACK = `'${LETTERHEAD_FAMILY}','Copperplate Gothic Bold','Copperplate Gothic',Copperplate,'Big Caslon',Georgia,serif`;

function runHtml(r: Run): string {
  let s = esc(r.t);
  if (r.b) s = `<b>${s}</b>`;
  if (r.i) s = `<i>${s}</i>`;
  return s;
}

function inlineHtml(body: string | Run[]): string {
  return typeof body === 'string' ? esc(body) : (body || []).map(runHtml).join('');
}

function paraHtml(p: Para, i: number, level: number, numbered: boolean): string {
  const label = numbered || level > 0 ? `${paraLabel(level, i)}&nbsp;&nbsp;` : '';
  const indent = level ? ` style="margin-left:${(level * 0.25).toFixed(2)}in"` : '';
  let h = `<p class="para${level ? ' subp' : ''}"${indent}>${label}${inlineHtml(bodyOf(p))}</p>`;
  const sub = subOf(p);
  if (sub) h += sub.map((sp, j) => paraHtml(sp, j, level + 1, true)).join('');
  return h;
}

function tailHtml(o: { atch?: string[]; cc?: string[]; distro?: string[] }): string {
  return tailBlocks(o)
    .map(
      (b, bi) =>
        `<div class="atch"><div class="${bi === 0 ? 'atchsp' : 'ccsp'}"></div><div>${esc(
          b.head,
        )}</div>${b.items.map((t) => `<div>${esc(t)}</div>`).join('')}</div>`,
    )
    .join('');
}

function sigHtml(name: string, rank: string, title: string): string {
  return `<div class="sig"><div class="sigsp"></div><div>${esc(sigLine(name, rank))}</div>${
    title ? `<div>${esc(dutyTitle(title))}</div>` : ''
  }</div>`;
}

/**
 * The whole memorandum, letterhead to last indorsement.
 *
 * Every top-level child of the returned fragment is a block the paginator can
 * move whole -- which is why an indorsement is wrapped in `.indblk` rather than
 * emitted loose: head, body and signature travel together, so an indorsement
 * breaks to a new page only when it genuinely will not fit.
 */
export function memoInnerHtml(doc: MemoDoc, spec: MemoSpec): string {
  const color = doc.lhColor || '#000099';
  const paras = (spec.paras || []).map((p, i) => paraHtml(p, i, 0, true)).join('');

  let inds = '';
  for (const ind of spec.inds || []) {
    // The space before the floated span is deliberate: the float costs nothing
    // visually, but without it a copied memo reads "82 RS/CC28 July 2026".
    inds += `<div class="indblk"><div class="ind">${esc(ind.head)}${
      ind.headRight ? ` <span style="float:right">${esc(ind.headRight)}</span>` : ''
    }</div>`;
    if (ind.line2) {
      inds += `<div class="ln">${esc(ind.line2)}${
        ind.line2Right ? ` <span style="float:right">${esc(ind.line2Right)}</span>` : ''
      }</div>`;
    }
    if (ind.memoFor) inds += `<div class="ln">${esc(ind.memoFor)}</div>`;
    if (ind.subj) inds += `<div class="ln">${esc(ind.subj)}</div>`;
    inds += (ind.paras || []).map((p, i) => paraHtml(p, i, 0, !!ind.numbered)).join('');
    inds += sigHtml(ind.sig.name, ind.sig.rank, ind.sig.title) + tailHtml(ind) + '</div>';
  }

  const des = cuiDesLines(doc, spec);
  const desHtml = des.length
    ? `<div class="cuides">${des.map((t) => `<div>${esc(t)}</div>`).join('')}</div>`
    : '';

  const seal = doc.seal ? `<img class="seal" alt="" src="${esc(doc.seal)}">` : '';
  const lh3 = doc.lh3 ? `<div class="lh3" style="color:${esc(color)}">${esc(doc.lh3)}</div>` : '';

  return `<div class="lhwrap">${seal}<div class="lh1" style="color:${esc(color)}">${esc(
    doc.lh1,
  )}</div><div class="lh2" style="color:${esc(color)}">${esc(doc.lh2)}</div>${lh3}</div>
  <div class="memodate">${esc(spec.date)}</div>
  <div class="ln">MEMORANDUM FOR&nbsp;&nbsp;${esc(spec.memoFor || 'RECORD')}</div>
  <div class="ln">FROM:&nbsp;&nbsp;${esc(spec.from || '')}</div>
  <div class="ln sub">SUBJECT:&nbsp;&nbsp;${esc(spec.subject || '')}</div>
  ${paras}
  ${sigHtml(spec.sig.name, spec.sig.rank, spec.sig.title)}
  ${tailHtml(spec)}
  ${inds}
  ${desHtml}`;
}

/**
 * Typography for one rendered page.
 *
 * `--lh` drives every vertical rule in the stylesheet below, so the whole
 * memorandum re-flows from the two controls the user actually has: face and
 * point size.
 */
export function memoStyle(doc: MemoDoc): Record<string, string> {
  const f = fontOf(doc);
  return {
    fontFamily: f.css,
    fontSize: `${fontSize(doc)}pt`,
    '--lh': String(lineFactor(doc)),
  };
}

/**
 * Page geometry shared by the preview and the print view.
 *
 * `prefix` scopes it: the preview needs `.mfrprev .ln`, the print window wants
 * `.wd .ln`. Everything measured in points, from the same numbers the PDF uses.
 */
export function memoCss(doc: MemoDoc, prefix: string): string {
  const lf = lineFactor(doc);
  return `
    ${prefix}{color:#000;line-height:${lf};position:relative}
    ${prefix} .lhwrap{position:relative;height:125.65pt;margin:0}
    ${prefix} .seal{position:absolute;left:-0.5in;top:36pt;width:72pt;height:72pt;object-fit:contain}
    ${prefix} .lh1,${prefix} .lh2,${prefix} .lh3{position:absolute;left:0;right:0;margin:0;text-align:center;font-family:${LETTERHEAD_STACK};font-weight:bold;text-transform:uppercase}
    ${prefix} .lh1{top:45pt;font-size:12pt;line-height:13.35pt}
    ${prefix} .lh2{top:59.35pt;font-size:10.56pt;line-height:11.68pt}
    ${prefix} .lh3{top:71.03pt;font-size:10.56pt;line-height:11.68pt}
    ${prefix} .memodate{text-align:right;margin:2.27pt 0 ${lf}em}
    ${prefix} .ln{margin:0 0 ${lf}em}
    ${prefix} .para{margin:0 0 1em;text-align:left}
    /* Sub-paragraph: a quarter inch further in, one blank line between. */
    ${prefix} .para.subp{margin:0 0 1em 0.25in}
    /* A wrapped SUBJECT aligns under its first word, not back at the margin. */
    ${prefix} .ln.sub{margin-bottom:1em;padding-left:4.98em;text-indent:-4.98em}
    ${prefix} .ind{margin:${(2 * lf).toFixed(4)}em 0 1em;overflow:hidden}
    ${prefix} .sig{margin-left:3.5in}
    ${prefix} .sigsp{height:${(4 * lf - 1).toFixed(4)}em}
    /* Attachments begin on the third line below the duty title: two blanks. */
    ${prefix} .atch{margin:0}
    ${prefix} .atchsp{height:${(2 * lf).toFixed(4)}em}
    ${prefix} .ccsp{height:${lf}em}
    /* CUI designation indicator: block at the right, lines left-justified. */
    ${prefix} .cuides{margin-top:${(3 * lf).toFixed(
      4,
    )}em;width:fit-content;margin-left:auto;text-align:left;font-size:8pt;line-height:1.2;white-space:nowrap}
    ${prefix} .indblk{page-break-inside:avoid;break-inside:avoid}
  `;
}

/**
 * A standalone document for the print window.
 *
 * The designation indicator flows at the end here rather than pinning to the
 * first page: the browser cannot tell us where its pages break. For a one-page
 * memorandum that is the same place, and for anything longer the PDF is the
 * authoritative artifact.
 */
export function printDocument(doc: MemoDoc, spec: MemoSpec): string {
  const f = fontOf(doc);
  const cui = cuiOn(doc);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    spec.subject || 'Memorandum',
  )}</title><style>
    ${LETTERHEAD_FACE}
    html,body{background:#fff;color:#000;color-scheme:light}
    @page{size:letter portrait;margin:0.6in 1in 1in 1in}
    body{margin:0}
    .wd{font-family:${f.css};font-size:${fontSize(doc)}pt;max-width:6.5in;margin:0 auto}
    ${memoCss(doc, '.wd')}
    /* After memoCss, which sets the block's margin: the letterhead is pinned to
       the paper edge, so it has to cancel the page's own top margin. */
    .wd .lhwrap{margin-top:-0.6in}
    /* CUI belongs in the page margin, so nothing in the body moves. A fixed
       element is positioned from the content box and has to be pulled back out
       by the margin width or it lands on the letterhead. */
    .cui-m{position:fixed;left:0;right:0;text-align:center;font-size:11pt;color:#000}
    .cui-t{top:calc(-0.6in + 0.18in)}
    .cui-b{bottom:calc(-1in + 0.18in)}
  </style></head><body>${
    cui ? '<div class="cui-m cui-t">CUI</div><div class="cui-m cui-b">CUI</div>' : ''
  }<div class="wd">${memoInnerHtml(doc, spec)}</div></body></html>`;
}
