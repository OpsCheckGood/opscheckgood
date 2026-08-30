#!/usr/bin/env node
/**
 * Fails the build if dist/ would make a network request at runtime.
 *
 * This enforces hard constraint 1. The audience is often on .mil networks where
 * outbound requests fail or are silently blocked, so a single CDN reference is
 * the difference between a working tool and a blank page.
 *
 * The check distinguishes requests the page makes on its own from links a user
 * chooses to follow. An <a href> to e-publishing.af.mil is fine and expected --
 * the source stamps link to the documents they cite. A <script src> to the same
 * host is not. Likewise the data files carry sourceUrl strings that end up in
 * the JS bundle as text; those are rendered, never fetched.
 *
 * Run: npm run verify:offline   (after npm run build)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

/** An absolute or protocol-relative URL. Everything else is same-origin. */
const EXTERNAL = String.raw`(?:https?:)?\/\/[^"'\s)>]+`;

const RULES = [
  {
    id: 'script-src',
    what: 'external <script src>',
    exts: ['.html'],
    pattern: new RegExp(`<script[^>]*\\ssrc\\s*=\\s*["']${EXTERNAL}`, 'gi'),
  },
  {
    id: 'link-href',
    what: 'external <link href> (stylesheet, preload, preconnect, ...)',
    exts: ['.html'],
    pattern: new RegExp(`<link[^>]*\\shref\\s*=\\s*["']${EXTERNAL}`, 'gi'),
  },
  {
    id: 'iframe-src',
    what: 'external <iframe src>',
    exts: ['.html'],
    pattern: new RegExp(`<iframe[^>]*\\ssrc\\s*=\\s*["']${EXTERNAL}`, 'gi'),
  },
  {
    id: 'img-src',
    what: 'external <img src>',
    exts: ['.html'],
    pattern: new RegExp(`<img[^>]*\\ssrc\\s*=\\s*["']${EXTERNAL}`, 'gi'),
  },
  {
    id: 'css-import',
    what: 'external @import',
    exts: ['.html', '.css'],
    pattern: new RegExp(`@import\\s+(?:url\\()?["']?${EXTERNAL}`, 'gi'),
  },
  {
    id: 'css-url',
    what: 'external url() in CSS',
    exts: ['.html', '.css'],
    pattern: new RegExp(`url\\(\\s*["']?${EXTERNAL}`, 'gi'),
  },
  {
    id: 'fetch',
    what: 'fetch() to an external URL',
    exts: ['.html', '.js', '.mjs'],
    pattern: new RegExp(`fetch\\s*\\(\\s*["'\`]${EXTERNAL}`, 'gi'),
  },
  {
    id: 'xhr',
    what: 'XMLHttpRequest.open() to an external URL',
    exts: ['.html', '.js', '.mjs'],
    pattern: new RegExp(`\\.open\\s*\\(\\s*["'][A-Z]+["']\\s*,\\s*["']${EXTERNAL}`, 'gi'),
  },
  {
    id: 'websocket',
    what: 'WebSocket or EventSource to an external URL',
    exts: ['.html', '.js', '.mjs'],
    pattern: new RegExp(
      `new\\s+(?:WebSocket|EventSource)\\s*\\(\\s*["'\`](?:wss?:)?${EXTERNAL}`,
      'gi',
    ),
  },
  {
    id: 'dynamic-import',
    what: 'import from an external URL',
    exts: ['.html', '.js', '.mjs'],
    pattern: new RegExp(
      `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|importScripts\\s*\\(\\s*)["'\`]${EXTERNAL}`,
      'gi',
    ),
  },
  {
    // Belt and braces: if a known CDN hostname appears anywhere at all, a rule
    // above probably has a hole in it.
    id: 'cdn-hostname',
    what: 'a known CDN or analytics hostname',
    exts: ['.html', '.js', '.mjs', '.css'],
    pattern:
      /\b(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh|code\.jquery\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com|google-analytics\.com|googletagmanager\.com|plausible\.io|api\.datamuse\.com)\b/gi,
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);
const violations = [];

for (const file of files) {
  const ext = extname(file).toLowerCase();
  const applicable = RULES.filter((r) => r.exts.includes(ext));
  if (applicable.length === 0) continue;

  const text = readFileSync(file, 'utf8');
  for (const rule of applicable) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push({
        file: relative(root, file),
        line,
        what: rule.what,
        id: rule.id,
        snippet: match[0].slice(0, 120),
      });
    }
  }
}

const scanned = files.filter((f) =>
  ['.html', '.js', '.mjs', '.css'].includes(extname(f).toLowerCase()),
).length;

if (violations.length > 0) {
  console.error(`Offline check FAILED: ${violations.length} external reference(s) in dist/.\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.what}`);
    console.error(`    ${v.snippet}\n`);
  }
  console.error(
    'Everything must ship in the bundle. See hard constraint 1 in CLAUDE.md.\n' +
      'Inline the asset, or vendor it into public/ and reference it with a relative path.',
  );
  process.exit(1);
}

console.log(`Offline check passed: ${scanned} file(s) scanned, no external references.`);
