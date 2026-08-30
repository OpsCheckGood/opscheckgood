import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Hard constraint 3: a page saved to disk and opened with no network must fully
 * work. These tests run against real build output, so they are skipped (loudly)
 * when dist/ is absent -- CI always builds first.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const offlineFile = join(dist, 'bullet-bench-offline.html');
const built = existsSync(offlineFile);

// Skipping locally is a convenience. Skipping in CI would quietly retire the
// only test that proves constraint 3, so there it is an error.
if (!built && process.env.CI) {
  throw new Error(
    'dist/bullet-bench-offline.html is missing. CI must run `npm run build` and ' +
      '`npm run build:offline` before the tests.',
  );
}
const describeBuilt = built ? describe : describe.skip;
if (!built) {
  console.warn(
    'dist/bullet-bench-offline.html missing; offline tests skipped. ' +
      'Run `npm run build && npm run build:offline` to include them.',
  );
}

describeBuilt('single-file offline build', () => {
  let html: string;
  beforeAll(() => {
    html = readFileSync(offlineFile, 'utf8');
  });

  it('has no subresources at all', () => {
    // Scan markup only. The minified bundle contains src=/href= inside string
    // literals (React's own error links, a data: URI); those are not requests
    // the browser makes on load, and stripping script/style avoids the
    // false positives.
    const markup = html
      .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
      .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');

    const refs = [...markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]!);
    const external = refs.filter((r) => !r.startsWith('#'));
    expect(external, `unexpected subresources: ${external.join(', ')}`).toEqual([]);
  });

  it('has no absolute /_astro/ asset paths', () => {
    expect(html).not.toContain('/_astro/');
  });

  it('carries no astro-island hydration, which cannot work from file://', () => {
    expect(html).not.toContain('<astro-island');
    expect(html).not.toContain('component-url');
  });

  it('inlines the stylesheet and the script', () => {
    expect(html).toMatch(/<style>[\s\S]{500,}<\/style>/);
    expect(html).toMatch(/<script>[\s\S]{5000,}<\/script>/);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  // The real test: run it the way a browser would and see the tool work.
  it('mounts and shapes bullets with no network available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///bullet-bench-offline.html',
    });

    // Any attempt to reach the network is a failure, not a fallback.
    const denied: string[] = [];
    dom.window.fetch = ((input: unknown) => {
      denied.push(String(input));
      return Promise.reject(new Error('network disabled'));
    }) as typeof fetch;

    const root = dom.window.document.getElementById('bullet-bench-root')!;
    await vi.waitFor(
      () => {
        expect(root.querySelector('textarea')).not.toBeNull();
        // The font has to parse and the optimizer has to run before any
        // millimetre readout can appear.
        expect(root.textContent).toMatch(/\d+(\.\d+)?\/\d+(\.\d+)?mm/);
      },
      { timeout: 15000, interval: 50 },
    );

    const text = root.textContent ?? '';
    expect(text).toContain('Fill against target');
    expect(text).toContain('Shaped output');
    expect(text).toContain('stays on this device');
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 30000);
});

describeBuilt('hosted build', () => {
  it('emits both pages', () => {
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'bullet-bench', 'index.html'))).toBe(true);
  });

  it('ships the font licence', () => {
    expect(existsSync(join(dist, 'fonts', 'LICENSE-Liberation.txt'))).toBe(true);
  });

  it('splits each font into its own chunk so only one is downloaded', () => {
    const chunks = readdirSync(join(dist, '_astro')).filter((f) => f.endsWith('.js'));
    expect(chunks.some((c) => c.startsWith('LiberationSerif'))).toBe(true);
    expect(chunks.some((c) => c.startsWith('LiberationSans'))).toBe(true);
  });
});
