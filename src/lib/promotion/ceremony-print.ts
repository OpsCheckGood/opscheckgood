import type { CeremonyInput, ScriptSection } from './ceremony';

/**
 * A standalone document for the print window: one page per section, the
 * charge on its own sheet so the reader can carry it to the podium.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function printScript(input: CeremonyInput, sections: ScriptSection[]): string {
  const unit = input.unit.trim();
  const title = unit ? `${unit} Promotion Script` : 'Promotion Script';
  const meta = [input.date.trim(), input.time.trim()].filter(Boolean).join(' · ');
  const pages = sections
    .map(
      (section) => `<section class="pg">
  <header><span class="brand">${esc(title)}</span><span class="sect">${esc(section.title)}</span></header>
  <div class="body">${section.blocks
    .map((b) => {
      if (b.kind === 'say') return `<p class="say"><b>EMCEE:</b> ${esc(b.text)}</p>`;
      if (b.kind === 'cue') return `<p class="cue">» ${esc(b.text)}</p>`;
      if (b.kind === 'title') return `<p class="ttl">${esc(b.text)}</p>`;
      return `<p class="para">${esc(b.text)}</p>`;
    })
    .join('\n')}</div>
  <footer><span>${esc(title)}${meta ? ` · ${esc(meta)}` : ''}</span><span>Lines marked » are stage cues, not read aloud.</span></footer>
</section>`,
    )
    .join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    html,body{background:#fff;color:#111;color-scheme:light;font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.35}
    @page{size:letter portrait;margin:0.75in}
    body{margin:0}
    .pg{page-break-after:always;max-width:7in;margin:0 auto 1in}
    .pg:last-child{page-break-after:auto}
    header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #111;padding-bottom:6pt;margin-bottom:14pt}
    .brand{font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-size:10pt}
    .sect{font-weight:700;font-size:13pt;text-transform:uppercase;letter-spacing:0.04em}
    .body{border-left:2px solid #999;padding-left:12pt}
    p{margin:0}
    .say{margin-top:9pt}
    .say b{font-weight:700}
    .cue{color:#555;font-style:italic;font-size:10pt}
    .ttl{font-weight:700;margin-top:6pt}
    .para{margin-top:8pt}
    footer{display:flex;justify-content:space-between;margin-top:18pt;padding-top:6pt;border-top:1px solid #bbb;font-size:8.5pt;color:#666}
    @media screen{body{padding:24px}}
  </style></head><body>${pages}</body></html>`;
}
