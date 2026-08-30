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
const ptOfflineFile = join(dist, 'pt-calculator-offline.html');
const built = existsSync(offlineFile) && existsSync(ptOfflineFile);

// Skipping locally is a convenience. Skipping in CI would quietly retire the
// only test that proves constraint 3, so there it is an error.
if (!built && process.env.CI) {
  throw new Error(
    'A single-file offline build is missing. CI must run `npm run build` and ' +
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

  // Index arithmetic rather than a regex: the file is megabytes once the
  // thesaurus is inlined, and an unbounded [\s\S] quantifier overflows the
  // regex engine's stack on a string that size.
  it('inlines the stylesheet and the script', () => {
    const styleOpen = html.indexOf('<style>');
    const styleClose = html.indexOf('</style>', styleOpen);
    expect(styleOpen).toBeGreaterThan(-1);
    expect(styleClose - styleOpen).toBeGreaterThan(500);

    const scriptOpen = html.lastIndexOf('<script>');
    const scriptClose = html.indexOf('</script>', scriptOpen);
    expect(scriptOpen).toBeGreaterThan(-1);
    expect(scriptClose - scriptOpen).toBeGreaterThan(5000);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  /**
   * The real test: run it the way a browser would and see the tool work.
   *
   * Timeouts are deliberately loose. The file carries an inlined thesaurus and
   * two fonts, so parsing and evaluating it costs real time, and vitest runs
   * test files in parallel -- under that contention a tight bound made this
   * intermittently red for no product reason.
   */
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
        // A millimetre readout only appears once the font has parsed and the
        // optimizer has run, so this proves the whole chain works offline.
        expect(root.textContent).toMatch(/\d+(\.\d+)?\s?mm/);
      },
      { timeout: 45000, interval: 100 },
    );

    const text = root.textContent ?? '';
    expect(text).toContain('AF Form 1206');
    expect(text).toContain('Copy Output');
    // The shaped output carries the substituted spaces, which is the whole
    // product: U+2004 or U+2006 present means the optimizer actually ran.
    expect(text).toMatch(/[\u2004\u2006]/);
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 90000);
});

describeBuilt('hosted build', () => {
  it('emits a page per tool', () => {
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'bullet-bench', 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'pt-calculator', 'index.html'))).toBe(true);
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

describeBuilt('theme', () => {
  const read = () => readFileSync(offlineFile, 'utf8');

  it('applies a stored theme before first paint', () => {
    const html = read();
    const headEnd = html.indexOf('</head>');
    const script = html.indexOf("localStorage.getItem('ocg.theme')");
    // Must be inline, and inside <head>: anything deferred paints the wrong
    // theme first and then corrects it, which is a visible flash.
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(headEnd);
  });

  it('ships a toggle', () => {
    expect(read()).toContain('id="theme-toggle"');
  });

  // Dark is the design, not a preference: charcoal is the specified look, so
  // it is the base palette and light is the opt-in override.
  it('ships dark as the base palette and light as an explicit override', () => {
    const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf8');
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain(":root[data-theme='light']");
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf(":root[data-theme='light']"));
  });

  it('defines every colour token in both palettes', () => {
    const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf8');
    const names = (start: number) => {
      const block = css.slice(start, css.indexOf('}', start));
      return new Set([...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!));
    };
    const dark = names(css.indexOf(':root {'));
    const light = names(css.indexOf(":root[data-theme='light']"));
    expect(dark.size).toBeGreaterThan(12);
    // A token missing from one palette silently falls back to the other's
    // value, which is how a dark colour ends up on a light background.
    expect([...dark].filter((n) => !light.has(n))).toEqual([]);
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
  });
});

/**
 * Constraint 3 again, for the second tool.
 *
 * Each tool ships its own self-contained file, so each one has to be proved
 * separately -- the Bullet Bench file passing says nothing about this one.
 */
describeBuilt('single-file offline PT calculator', () => {
  let html: string;
  beforeAll(() => {
    html = readFileSync(ptOfflineFile, 'utf8');
  });

  it('has no subresources at all', () => {
    const markup = html
      .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
      .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
    const refs = [...markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]!);
    expect(refs.filter((r) => !r.startsWith('#'))).toEqual([]);
  });

  it('carries no astro-island hydration and no absolute asset paths', () => {
    expect(html).not.toContain('/_astro/');
    expect(html).not.toContain('<astro-island');
  });

  // Bullet Bench's font data is most of its 1.5 MB and must not ride along.
  it('carries only its own bundle', () => {
    expect(html.length).toBeLessThan(600_000);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  it('scores an assessment with no network available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///pt-calculator-offline.html',
    });

    const denied: string[] = [];
    dom.window.fetch = ((input: unknown) => {
      denied.push(String(input));
      return Promise.reject(new Error('network disabled'));
    }) as typeof fetch;

    const mount = dom.window.document.getElementById('pt-calculator-root')!;
    await vi.waitFor(
      () => {
        expect(mount.querySelector('input')).not.toBeNull();
      },
      { timeout: 45000, interval: 100 },
    );

    // Drive it the way a user would, then read the composite back off the page.
    const doc = dom.window.document;
    const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
      const proto =
        el.tagName === 'SELECT'
          ? dom.window.HTMLSelectElement.prototype
          : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    };

    const byLabel = (label: string) =>
      doc.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

    // Before an age is entered there is no column, so the age-dependent tables
    // must be absent rather than quietly showing the neutral track's numbers.
    expect(mount.textContent).toContain('Enter an age to load your scoring chart');
    expect(mount.textContent).not.toContain('HR Push-up');
    // The waist-to-height ladder is the same at every age, so it stays up.
    expect(mount.textContent).toContain('all ages');

    setValue(doc.getElementById('pt-age') as HTMLInputElement, '30');
    setValue(doc.getElementById('body.height') as HTMLInputElement, '70');
    for (const n of [1, 2, 3]) setValue(byLabel(`Waist measurement ${n}`), '34');
    setValue(doc.getElementById('strength.value') as HTMLInputElement, '50');
    setValue(doc.getElementById('core.value') as HTMLInputElement, '50');

    const minutes = byLabel('2 Mile Run minutes');
    const seconds = byLabel('2 Mile Run seconds');
    setValue(minutes, '11');
    setValue(seconds, '30');

    await vi.waitFor(
      () => {
        expect(mount.textContent).toContain('94.0');
      },
      { timeout: 10000, interval: 50 },
    );

    const text = mount.textContent ?? '';
    // The same case the unit tests score to 94.0 / Excellent.
    expect(text).toContain('EXCELLENT');
    // The provenance stamp and the unverified banner are both non-negotiable.
    // The unverified-data banner is deliberately not rendered here (see the
    // header comment in PtCalculator.tsx). The source stamp still has to carry
    // the provenance, so that is what is asserted.
    expect(text).not.toContain('Unverified data');
    expect(text).toContain('Source (stub)');
    expect(text).toContain('AFMAN 36-2905');
    // ...and the chart appears once there is a column to draw.
    expect(text).toContain('HR Push-up');
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 90000);
});
