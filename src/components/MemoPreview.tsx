import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LETTERHEAD_FACE, memoCss, memoInnerHtml, memoStyle } from '@/lib/mfr/html';
import { cuiOn } from '@/lib/mfr/spec';
import type { MemoDoc, MemoSpec } from '@/lib/mfr/types';

/**
 * Live preview: the memorandum laid out on US Letter page cards.
 *
 * Two rules make it worth having.
 *
 * It measures rather than estimates. Each top-level block of the rendered
 * memorandum is measured in a hidden element at the page's own content width,
 * then packed into pages the way the PDF writer packs them -- so the page count
 * on screen is the page count in the download, and an indorsement that will not
 * fit moves in both or neither.
 *
 * The page is never reflowed to fit the panel. A sheet is 8.5 inches wide at
 * whatever point size the memorandum is set in, full stop; when the panel is
 * narrower than that the whole sheet is *scaled down*, not squeezed. Squeezing
 * changes where every line breaks, which would make the preview disagree with
 * the PDF about the one thing it exists to show.
 */

const DPI = 96;
const PAGE_W = 8.5 * DPI;
const PAGE_H = 11 * DPI;
/** 0.75in top and bottom, matching the page card's padding. */
const CONTENT_H = PAGE_H - 1.5 * DPI;
/** Breathing room around the sheets inside the scroller. */
const STAGE_PAD = 20;

type Zoom = 'fit' | 'full';

interface Block {
  html: string;
  height: number;
}

function paginate(host: HTMLElement, inner: string): { pages: string[][]; ok: boolean } {
  host.innerHTML = inner;
  const kids = Array.from(host.children) as HTMLElement[];
  if (!kids.length) return { pages: [[]], ok: false };

  // The designation indicator is pulled out of the flow and pinned to page one,
  // because that is the only page it may appear on. Its height is charged
  // against page one first so the body cannot run underneath it.
  let desHtml = '';
  let desEl: HTMLElement | null = null;
  const flowing = kids.filter((el) => {
    if (el.classList.contains('cuides')) {
      desHtml = el.outerHTML;
      desEl = el;
      return false;
    }
    return true;
  });

  // An absolutely positioned node inside a hidden container can report a height
  // of zero, and a zero reservation is exactly the overlap this guards against,
  // so the measured height is floored by a computed one: 8pt text at 1.2.
  const desLines = desEl ? (desEl as HTMLElement).children.length : 0;
  const desFloor = desLines * Math.ceil((8 * 1.2 * DPI) / 72) + 10;
  const desHeight = desHtml ? Math.max(desEl ? (desEl as HTMLElement).offsetHeight + 10 : 0, desFloor) : 0;

  const blocks: Block[] = flowing.map((el) => {
    const cs = getComputedStyle(el);
    return {
      html: el.outerHTML,
      height: el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0),
    };
  });

  const pages: string[][] = [[]];
  let used = desHeight;
  for (const block of blocks) {
    const current = pages[pages.length - 1]!;
    if (used + block.height > CONTENT_H && current.length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]!.push(block.html);
    used += block.height;
  }
  if (desHtml) pages[0]!.push(desHtml);
  return { pages, ok: true };
}

export function MemoPreview({
  doc,
  spec,
  onPageCount,
}: {
  doc: MemoDoc;
  spec: MemoSpec;
  onPageCount?: (count: number) => void;
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetsRef = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<string[][] | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [stackHeight, setStackHeight] = useState(0);

  const inner = useMemo(() => memoInnerHtml(doc, spec), [doc, spec]);
  const style = useMemo(() => memoStyle(doc) as React.CSSProperties, [doc]);
  const css = useMemo(() => memoCss(doc, '.mfr-sheet'), [doc]);

  useEffect(() => {
    const host = measureRef.current;
    if (!host) return;
    try {
      const result = paginate(host, inner);
      const next = result.ok ? result.pages : null;
      setPages(next);
      onPageCount?.(next ? next.length : 1);
    } catch {
      setPages(null); // fall back to one continuous card
      onPageCount?.(1);
    }
    host.innerHTML = '';
  }, [inner, style, css, onPageCount]);

  const measureFit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const available = stage.clientWidth - STAGE_PAD * 2;
    // Never scale up: a sheet larger than letter size is not more legible, it
    // is just blurry.
    setFitScale(available > 0 ? Math.min(1, available / PAGE_W) : 1);
  }, []);

  useLayoutEffect(() => {
    measureFit();
    // jsdom has no ResizeObserver, and neither do older browsers; a window
    // listener covers the case that actually matters there, which is the
    // initial measurement.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureFit);
      return () => window.removeEventListener('resize', measureFit);
    }
    const observer = new ResizeObserver(measureFit);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [measureFit]);

  const scale = zoom === 'fit' ? fitScale : 1;

  // A transform does not affect layout, so the scroller is told how tall the
  // scaled stack actually is. Measured after paint, from the unscaled height.
  useLayoutEffect(() => {
    const sheets = sheetsRef.current;
    if (!sheets) return;
    setStackHeight(sheets.offsetHeight * scale);
  }, [pages, inner, style, scale]);

  const banner = cuiOn(doc);

  const sheet = (key: number, contents: string, pageNo?: { i: number; of: number }) => (
    <div
      key={key}
      className="mfr-sheet"
      style={{ ...style, minHeight: pageNo ? `${PAGE_H}px` : undefined, position: 'relative' }}
    >
      {banner ? (
        <>
          <span className="mfr-cui mfr-cui-t">CUI</span>
          <span className="mfr-cui mfr-cui-b">CUI</span>
        </>
      ) : null}
      {pageNo ? (
        <span className="mfr-pageno">
          Page {pageNo.i} of {pageNo.of}
        </span>
      ) : null}
      <div dangerouslySetInnerHTML={{ __html: contents }} />
    </div>
  );

  return (
    <>
      <style>{`
        ${LETTERHEAD_FACE}
        ${css}
        .mfr-sheet{background:#fff;color:#000;padding:0.75in 1in;width:${PAGE_W}px;
          margin:0 auto 20px;box-shadow:0 3px 18px rgba(0,0,0,.35);border-radius:2px;box-sizing:border-box}
        .mfr-sheet:last-child{margin-bottom:0}
        /* The letterhead is pinned to the paper edge, cancelling the card's padding. */
        .mfr-sheet .lhwrap{margin-top:-0.75in}
        /* The preview knows which page the indicator sits on, so it is pinned. */
        .mfr-sheet .cuides{position:absolute;right:0.75in;bottom:0.75in;margin-top:0}
        .mfr-pageno{position:absolute;top:6px;right:10px;font-family:var(--font-sans);font-size:9px;
          color:#aaa;letter-spacing:.3px}
        .mfr-cui{position:absolute;left:0;right:0;text-align:center;font-size:11pt;font-weight:700;color:#000}
        .mfr-cui-t{top:22pt}
        .mfr-cui-b{bottom:22pt}
        .mfr-stage{background:#8a8f98;padding:${STAGE_PAD}px;border-radius:8px;overflow:auto;max-height:82vh}
        .mfr-sheets{width:${PAGE_W}px;transform-origin:top left}
        .mfr-measure{position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;
          width:6.5in;box-sizing:border-box}
      `}</style>

      <div
        ref={measureRef}
        aria-hidden="true"
        className="mfr-sheet mfr-measure"
        style={{ ...style, padding: 0, width: '6.5in', boxShadow: 'none', margin: 0 }}
      />

      <div className="mb-2 flex items-center gap-3">
        <span className="util">Zoom</span>
        <div className="flex gap-1.5">
          {(['fit', 'full'] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
              className="cursor-pointer border px-2 py-1 text-[11px] font-semibold"
              style={
                zoom === z
                  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                  : {
                      background: 'var(--panel-raised)',
                      borderColor: 'var(--rule-strong)',
                      color: 'var(--ink)',
                    }
              }
            >
              {z === 'fit' ? 'Fit width' : 'Full size'}
            </button>
          ))}
        </div>
        <span className="util-value tabular ml-auto">{Math.round(scale * 100)}%</span>
      </div>

      <div className="mfr-stage" ref={stageRef}>
        <div style={{ height: stackHeight || undefined }}>
          <div className="mfr-sheets" ref={sheetsRef} style={{ transform: `scale(${scale})` }}>
            {pages
              ? pages.map((page, i) => sheet(i, page.join(''), { i: i + 1, of: pages.length }))
              : sheet(0, inner)}
          </div>
        </div>
      </div>
    </>
  );
}
