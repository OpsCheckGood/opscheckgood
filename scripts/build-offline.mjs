#!/usr/bin/env node
/**
 * Builds dist/bullet-bench-offline.html: one self-contained file that works
 * when double-clicked from a thumb drive with no network at all.
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
 * Run: npm run build:offline   (after npm run build)
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outFile = join(dist, 'bullet-bench-offline.html');

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Reuse the stylesheet Astro already generated so the offline page and the
// hosted page cannot drift apart.
const cssDir = join(dist, '_astro');
const cssFiles = existsSync(cssDir)
  ? readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  : [];
if (cssFiles.length === 0) {
  console.error('No stylesheet found in dist/_astro. Run `npm run build` first.');
  process.exit(1);
}
const css = cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');

const result = await build({
  entryPoints: [join(root, 'src', 'offline-entry.tsx')],
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

const js = result.outputFiles[0].text;

// If anything survived as a separate chunk, the file is not self-contained.
if (result.outputFiles.length !== 1) {
  console.error(
    `Expected a single bundle, got ${result.outputFiles.length}. ` +
      'A dynamic import failed to inline; the offline page would be broken.',
  );
  process.exit(1);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bullet Bench (offline) — Ops Check Good</title>
<style>${css}</style>
</head>
<body>
<header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2"
        style="border-color: var(--rule); background: var(--panel);">
  <span class="label" style="color: var(--ink-faint);">Ops Check Good</span>
  <span class="text-[13px] font-semibold">Bullet Bench</span>
  <span class="tabular ml-auto text-[11px]" style="color: var(--ink-faint);">offline copy</span>
</header>
<main id="bullet-bench-root"></main>
<footer class="mx-auto max-w-[1400px] px-3 py-6 text-[11px] leading-relaxed" style="color: var(--ink-faint);">
<p class="m-0">Unofficial personal project. Not affiliated with, endorsed by, or produced by the
United States Air Force or the Department of Defense. Official guidance governs; check current
instructions and your chain of command before relying on anything here.</p>
<p class="m-0 mt-1">This file is completely self-contained. It makes no network requests and
nothing you type leaves this device.</p>
</footer>
<script>${js}</script>
</body>
</html>
`;

writeFileSync(outFile, html, 'utf8');
console.log(
  `Wrote dist/bullet-bench-offline.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, single file, no subresources)`,
);
