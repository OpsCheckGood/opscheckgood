#!/usr/bin/env node
/**
 * Builds one self-contained HTML file per tool: a page that works when
 * double-clicked from a thumb drive with no network at all.
 *
 * This exists because hard constraint 3 is stricter than it first appears.
 * "No runtime network requests" is satisfied by the normal build, but a page
 * opened from disk faces two further problems that have nothing to do with the
 * network:
 *
 *   1. Astro emits absolute asset URLs (`/_astro/...`), which under file://
 *      resolve against the filesystem root rather than the page.
 *   2. Browsers block ES module loading from a file origin. Astro's island
 *      hydration is a dynamic import(), so the interactive part never runs.
 *
 * The fix is to bundle to a classic IIFE with every dynamic import inlined, and
 * to inline the stylesheet, so the file has no subresources whatsoever.
 *
 * Every tool gets its own file, each carrying only its own bundle. Adding a
 * tool is one entry in TOOLS below plus its offline entry point.
 *
 * Run: npm run build:offline   (after npm run build)
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/**
 * One entry per tool. `rootId` must match the element its entry point mounts
 * into, and `wordmark`/`tagline` mirror what the hosted layout puts in its
 * header so the offline copy does not read as a different product.
 */
const TOOLS = [
  {
    name: 'Bullet Bench',
    wordmark: 'BULLET BENCH',
    tagline: 'Write sharp. Get recognized.',
    entry: 'src/offline-entry.tsx',
    rootId: 'bullet-bench-root',
    outFile: 'bullet-bench-offline.html',
  },
  {
    name: 'PT Calculator',
    wordmark: 'PT CALCULATOR',
    tagline: 'Train hard. Score high.',
    entry: 'src/offline-entry-pt.tsx',
    rootId: 'pt-calculator-root',
    outFile: 'pt-calculator-offline.html',
  },
];

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Reuse the stylesheet Astro already generated so the offline pages and the
// hosted pages cannot drift apart.
const cssDir = join(dist, '_astro');
const cssFiles = existsSync(cssDir)
  ? readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  : [];
if (cssFiles.length === 0) {
  console.error('No stylesheet found in dist/_astro. Run `npm run build` first.');
  process.exit(1);
}
const css = cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');

async function bundle(tool) {
  const result = await build({
    entryPoints: [join(root, tool.entry)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    jsx: 'automatic',
    loader: { '.json': 'json', '.ttf': 'binary' },
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(root, 'src') },
    legalComments: 'none',
    logLevel: 'warning',
  });

  // If anything survived as a separate chunk, the file is not self-contained.
  if (result.outputFiles.length !== 1) {
    console.error(
      `${tool.name}: expected a single bundle, got ${result.outputFiles.length}. ` +
        'A dynamic import failed to inline; the offline page would be broken.',
    );
    process.exit(1);
  }
  return result.outputFiles[0].text;
}

function shell(tool, js) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tool.name} (offline) — Ops Check Good</title>
<style>${css}</style>
<script>
// Applies a stored theme before first paint. Same behaviour as the hosted
// layout; duplicated because this file builds its own shell.
(function(){try{var t=localStorage.getItem('ocg.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
</script>
</head>
<body>
<header class="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b px-6 py-4"
        style="border-color: var(--rule);">
  <span style="font-size: 17px; font-weight: 700; letter-spacing: 0.16em; color: var(--ink);">${tool.wordmark}</span>
  <span class="util">${tool.tagline}</span>
  <span class="util ml-auto">offline copy</span>
  <button id="theme-toggle" type="button" class="util border px-2 py-1"
          style="background: var(--panel); border-color: var(--rule-strong); letter-spacing: 0.13em;">Theme</button>
</header>
<main id="${tool.rootId}"></main>
<footer class="mx-auto max-w-[1400px] px-3 py-6 text-[11px] leading-relaxed" style="color: var(--ink-faint);">
<p class="m-0">Unofficial personal project. Not affiliated with, endorsed by, or produced by the
United States Air Force or the Department of Defense. Official guidance governs; check current
instructions and your chain of command before relying on anything here.</p>
<p class="m-0 mt-1">This file is completely self-contained. It makes no network requests and
nothing you type leaves this device.</p>
</footer>
<script>
(function(){
  var b=document.getElementById('theme-toggle');if(!b)return;var r=document.documentElement;
  function cur(){var e=r.getAttribute('data-theme');if(e==='light'||e==='dark')return e;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
  function lab(){var n=cur()==='dark'?'Light':'Dark';b.textContent=n;
    b.setAttribute('aria-label','Switch to '+n.toLowerCase()+' mode');}
  b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';
    r.setAttribute('data-theme',n);try{localStorage.setItem('ocg.theme',n);}catch(e){}lab();});
  lab();
})();
</script>
<script>${js}</script>
</body>
</html>
`;
}

for (const tool of TOOLS) {
  const html = shell(tool, await bundle(tool));
  writeFileSync(join(dist, tool.outFile), html, 'utf8');
  console.log(
    `Wrote dist/${tool.outFile} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, single file, no subresources)`,
  );
}
