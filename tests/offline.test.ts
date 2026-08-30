import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, REPO_IS_PUBLIC } from '@/lib/site';

/**
 * Hard constraint 3: a page saved to disk and opened with no network must fully
 * work. These tests run against real build output, so they are skipped (loudly)
 * when dist/ is absent -- CI always builds first.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const offlineFile = join(dist, 'bullet-bench-offline.html');
const ptOfflineFile = join(dist, 'pt-calculator-offline.html');
const btzOfflineFile = join(dist, 'btz-calculator-offline.html');
const built = existsSync(offlineFile) && existsSync(ptOfflineFile) && existsSync(btzOfflineFile);

// Skipping locally is a convenience. Skipping in CI would quietly retire the
// only test that proves constraint 3, so there it is an error.
if (!built && process.env.CI) {
  throw new Error(
    'A single-file offline build is missing. CI must run `npm run build` and ' +
      '`npm run build:offline` before the tests.',
  );
}
const describeBuilt = built ? describe : describe.skip;

/**
 * Strips script and style bodies, leaving the markup a reader actually sees.
 *
 * Bundled libraries embed URLs in their own error messages -- opentype.js names
 * its issue tracker in a deprecation warning -- and those are not links this
 * site offers. Assertions about what the page points at have to look at the
 * markup, not at every string that happens to be in the file.
 */
function stripCode(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
}
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
        /*
         * Wait on the substituted spaces themselves.
         *
         * This used to wait on a millimetre readout, on the reasoning that one
         * could only appear after the font parsed. That was wrong: the
         * Requirements label prints the form's own width straight out of the
         * data, so it renders immediately and satisfied the wait before the
         * font had loaded -- leaving the assertions below to run against a
         * page still showing "LOADING". It passed on a quiet machine and went
         * red under parallel load, which is the worst way for a test to fail.
         *
         * U+2004 or U+2006 in the output can only come from the optimizer,
         * which cannot run until the font has parsed, so this gates on the end
         * of the chain rather than on something that looks like it.
         */
        expect(root.textContent).toMatch(/[\u2004\u2006]/);
      },
      { timeout: 45000, interval: 100 },
    );

    const text = root.textContent ?? '';
    expect(text).toContain('AF Form 1206');
    expect(text).toContain('Copy Output');
    // The measured width appears once the font is in, alongside the shaping.
    expect(text).toMatch(/\d+(\.\d+)?\s?mm/);
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 90000);
});

/**
 * The offline copies are the ones most likely to be wrong in a way nobody can
 * report -- they get passed around on thumb drives, detached from the site. So
 * each one carries the issue tracker in its own footer, written out as text
 * rather than linked: the file has no links at all (see the no-subresources
 * test above) and the machine it is opened on may have no network either.
 */
describeBuilt('every offline copy says where to report a problem', () => {
  it.each([
    'bullet-bench-offline.html',
    'pt-calculator-offline.html',
    'btz-calculator-offline.html',
  ])('%s points somewhere real, and never links out', (file) => {
    const path = join(dist, file);
    if (!existsSync(path)) return;
    const html = readFileSync(path, 'utf8');
    // Markup only. The bundles carry github.com inside library error strings --
    // opentype.js links its own issue tracker in a deprecation warning -- which
    // is not a destination this page offers anybody.
    const markup = stripCode(html);

    expect(markup).toContain('Something wrong?');
    if (REPO_IS_PUBLIC) {
      expect(markup).toContain(`github.com/${REPO}/issues`);
    } else {
      // Naming a private tracker in a file that gets passed around on thumb
      // drives would send people to a 404 with no way to ask why.
      expect(markup).not.toContain('github.com');
    }
    // Written out, never linked: an anchor would break the invariant that these
    // files reference nothing at all.
    expect(markup).not.toContain('href="https://github.com');
  });
});

/**
 * The same rule for the hosted pages. This is the test that actually protects
 * a visitor from a dead link, because it reads the built HTML rather than the
 * source that was supposed to produce it.
 */
describeBuilt('GitHub links appear only when the repository is public', () => {
  const pages = ['index.html', join('report', 'index.html'), join('tools', 'btz-calculator', 'index.html')];

  it.each(pages)('%s', (page) => {
    const path = join(dist, page);
    if (!existsSync(path)) return;
    const markup = stripCode(readFileSync(path, 'utf8'));
    if (REPO_IS_PUBLIC) {
      if (page.startsWith('report')) expect(markup).toContain(`github.com/${REPO}`);
    } else {
      expect(markup).not.toContain('github.com');
    }
  });

  // Whatever the visibility, the bug report page itself must still be reachable
  // and still able to assemble a report.
  it('keeps the report page working either way', () => {
    const path = join(dist, 'report', 'index.html');
    if (!existsSync(path)) return;
    const html = readFileSync(path, 'utf8');
    expect(html).toContain('OPS CHECK GOOD — BUG REPORT');
    expect(html).toContain('Copy report');
    expect(html).toContain('Keep real records out of it');
  });
});

describeBuilt('hosted build', () => {
  it('emits a page per tool', () => {
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'bullet-bench', 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'pt-calculator', 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'tools', 'btz-calculator', 'index.html'))).toBe(true);
    // The bug report page is site furniture rather than a tool, but it has to
    // exist or every "Report a bug" link in the footer is a 404.
    expect(existsSync(join(dist, 'report', 'index.html'))).toBe(true);
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

  // Light is the design and the default; dark is the opt-in override. Nothing
  // stamps an attribute until the user picks, so bare :root has to be the
  // light palette or the first paint is wrong.
  it('ships light as the base palette and dark as an explicit override', () => {
    const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf8');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf(":root[data-theme='dark']"));
  });

  it('defines every colour token in both palettes', () => {
    const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf8');
    const names = (start: number) => {
      const block = css.slice(start, css.indexOf('}', start));
      return new Set([...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!));
    };
    const light = names(css.indexOf(':root {'));
    const dark = names(css.indexOf(":root[data-theme='dark']"));
    expect(light.size).toBeGreaterThan(12);
    // A token missing from one palette silently falls back to the other's
    // value, which is how a dark colour ends up on a light background.
    expect([...light].filter((n) => !dark.has(n))).toEqual([]);
    expect([...dark].filter((n) => !light.has(n))).toEqual([]);
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

/**
 * Constraint 3 again, for the third tool.
 *
 * Same reasoning as the PT block above: each tool ships its own self-contained
 * file, so each one has to be proved on its own. This one is the cheapest of
 * the three to prove and the most important to get right -- it carries no font
 * data and no thesaurus, just arithmetic, and the whole product is whether that
 * arithmetic runs on a laptop with no network.
 */
describeBuilt('single-file offline BTZ calculator', () => {
  let html: string;
  beforeAll(() => {
    html = readFileSync(btzOfflineFile, 'utf8');
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

  // No fonts, no thesaurus: this file has no excuse to be large.
  it('carries only its own bundle', () => {
    expect(html.length).toBeLessThan(500_000);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  it('projects a BTZ date with no network available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///btz-calculator-offline.html',
    });

    const denied: string[] = [];
    dom.window.fetch = ((input: unknown) => {
      denied.push(String(input));
      return Promise.reject(new Error('network disabled'));
    }) as typeof fetch;

    const mount = dom.window.document.getElementById('btz-calculator-root')!;
    await vi.waitFor(
      () => {
        expect(mount.querySelector('input')).not.toBeNull();
      },
      { timeout: 45000, interval: 100 },
    );

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

    // Nothing is projected before the dates are in, and it says what it needs.
    expect(mount.textContent).toContain('INCOMPLETE');
    expect(mount.textContent).not.toContain('15 FEB 2028');

    // The maintainer's worked example, driven through the real page.
    setValue(doc.getElementById('btz-dead') as HTMLInputElement, '2025-08-15');
    setValue(doc.getElementById('btz-grade') as HTMLSelectElement, 'a1c');
    setValue(doc.getElementById('btz-dor') as HTMLInputElement, '2026-06-15');

    await vi.waitFor(
      () => {
        expect(mount.textContent).toContain('15 FEB 2028');
      },
      { timeout: 10000, interval: 50 },
    );

    const text = mount.textContent ?? '';
    expect(text).toContain('15 AUG 2028');   // fully qualified
    expect(text).toContain('OCT \u2013 NOV 2027'); // consideration window, en dash as rendered
    expect(text).toContain('DEC 2027');      // board
    expect(text).toContain('If selected');
    // It must never render as a plain eligibility verdict.
    expect(text).not.toMatch(/\bis eligible\b/i);
    // The unverified-data banner is deliberately not rendered (see the header
    // comment in BtzCalculator.tsx). The source stamp still has to carry the
    // provenance, so that is what is asserted -- and this data is transcribed
    // from the instruction, so it must not read as a stub.
    expect(text).not.toContain('Unverified data');
    expect(text).not.toContain('(stub)');
    expect(text).toContain('AFI 36-2502');
    expect(text).toContain('2 July 2026');
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 90000);
});

/**
 * Constraint 3 for the toolkit.
 *
 * This is the tool most likely to be wanted with no network -- a directory of
 * who to call is worth carrying on a thumb drive -- so the offline copy has to
 * do the whole job: route a situation and produce a real, dialable number.
 */
describeBuilt('single-file offline First Sergeant Toolkit', () => {
  const file = join(dist, 'first-sergeant-offline.html');
  let html: string;
  beforeAll(() => {
    html = readFileSync(file, 'utf8');
  });

  it('has no subresources at all', () => {
    const markup = html
      .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
      .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
    const refs = [...markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]!);
    expect(refs.filter((r) => !r.startsWith('#'))).toEqual([]);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  it('routes a situation to a real number with no network available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///first-sergeant-offline.html',
    });

    const denied: string[] = [];
    dom.window.fetch = ((input: unknown) => {
      denied.push(String(input));
      return Promise.reject(new Error('network disabled'));
    }) as typeof fetch;

    const mount = dom.window.document.getElementById('first-sergeant-root')!;
    await vi.waitFor(
      () => {
        expect(mount.querySelector('input')).not.toBeNull();
      },
      { timeout: 15000, interval: 50 },
    );

    // It says what it is before it says anything else.
    expect(mount.textContent).toContain('Routing, not policy');

    // Open the situation a Shirt least wants to be looking up.
    const buttons = [...mount.querySelectorAll('button')];
    const crisis = buttons.find((b) => (b.textContent ?? '').includes('Is in crisis'));
    expect(crisis, 'crisis situation card is missing').toBeDefined();
    crisis!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await vi.waitFor(
      () => {
        expect(mount.textContent).toContain('Start here');
      },
      { timeout: 5000, interval: 50 },
    );

    const text = mount.textContent ?? '';
    expect(text).toContain('Questions to establish first');
    // With no installation selected it must still hand over something dialable
    // rather than an empty card.
    expect(text).toContain('Military OneSource');
    expect(mount.querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 30000);
});

/**
 * Constraint 3 for the memorandum generator.
 *
 * The whole point of this tool is producing a file, so the offline copy has to
 * do that from disk with no network: type a memorandum, and get a real PDF and
 * a real .docx out of the same page.
 */
describeBuilt('single-file offline MFR generator', () => {
  const file = join(dist, 'mfr-generator-offline.html');
  let html: string;
  beforeAll(() => {
    html = readFileSync(file, 'utf8');
  });

  it('has no subresources at all', () => {
    const markup = html
      .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
      .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
    const refs = [...markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]!);
    expect(refs.filter((r) => !r.startsWith('#'))).toEqual([]);
  });

  it('states the unofficial-project disclaimer', () => {
    expect(html).toContain('Unofficial personal project');
    expect(html).toContain('Official guidance governs');
  });

  // The letterhead is the document's, not the site's: the seal and the
  // letterhead face both have to be in the file, or an offline copy prints a
  // memorandum that does not look like one.
  it('carries the seal and the letterhead face inline', () => {
    expect(html).toMatch(/data:image\/jpeg;base64,/i);
    expect(html).toMatch(/data:font\/truetype;charset=utf-8;base64,/i);
  });

  it('writes a memorandum and builds both files with no network available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///mfr-generator-offline.html',
    });

    const denied: string[] = [];
    dom.window.fetch = ((input: unknown) => {
      denied.push(String(input));
      return Promise.reject(new Error('network disabled'));
    }) as typeof fetch;

    const mount = dom.window.document.getElementById('mfr-generator-root')!;
    await vi.waitFor(
      () => {
        expect(mount.querySelector('input')).not.toBeNull();
      },
      { timeout: 45000, interval: 100 },
    );

    const doc = dom.window.document;
    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto =
        el.tagName === 'TEXTAREA'
          ? dom.window.HTMLTextAreaElement.prototype
          : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };

    // It says where the text goes before it says anything else.
    expect(mount.textContent).toContain('stays on this device');

    // The letterhead is editable -- that is the reason this tool exists as a
    // public one rather than a unit's.
    setValue(doc.getElementById('mfr-lh2') as HTMLInputElement, '82D RECONNAISSANCE SQUADRON');
    setValue(doc.getElementById('mfr-from') as HTMLInputElement, '82 RS/MXAA');
    setValue(doc.getElementById('mfr-subject') as HTMLInputElement, 'Request for Additional Manning');
    setValue(doc.getElementById('mfr-sig-name') as HTMLInputElement, 'Smith, John Daniel');
    setValue(doc.getElementById('mfr-sig-rank') as HTMLInputElement, 'TSG');

    await vi.waitFor(
      () => {
        // The preview renders the signature block from the name as typed.
        expect(mount.textContent).toContain('JOHN D. SMITH, TSgt, USAF');
      },
      { timeout: 10000, interval: 50 },
    );

    expect(mount.textContent).toContain('82D RECONNAISSANCE SQUADRON');
    expect(mount.textContent).toContain('SUBJECT:');

    // Both exports are built in the page. jsdom has no download, so the click
    // is observed at createObjectURL -- what matters is that real bytes were
    // produced without a request.
    const blobs: Blob[] = [];
    dom.window.URL.createObjectURL = ((blob: Blob) => {
      blobs.push(blob);
      return 'blob:offline';
    }) as typeof URL.createObjectURL;
    dom.window.URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    const buttons = [...mount.querySelectorAll('button')];
    const pdfButton = buttons.find((b) => b.textContent?.trim() === 'Download PDF')!;
    const wordButton = buttons.find((b) => b.textContent?.trim() === 'Download Word')!;
    pdfButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    wordButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await vi.waitFor(
      () => {
        expect(blobs.length).toBe(2);
      },
      { timeout: 10000, interval: 50 },
    );

    // The PDF is built asynchronously and the .docx synchronously, so they are
    // identified by type rather than by the order they arrive in.
    const pdf = blobs.find((b) => b.type === 'application/pdf')!;
    const docx = blobs.find((b) => b.type !== 'application/pdf')!;
    const pdfText = new TextDecoder('latin1').decode(new Uint8Array(await pdf.arrayBuffer()));
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    // The PDF places each word at its own measured coordinate, so the subject
    // appears word by word rather than as one string.
    expect(pdfText).toContain('(SUBJECT:) Tj');
    expect(pdfText).toContain('(Manning) Tj');
    // The letterhead is drawn as whole centred lines, so it appears intact.
    expect(pdfText).toContain('(82D RECONNAISSANCE SQUADRON) Tj');
    const docxBytes = new Uint8Array(await docx.arrayBuffer());
    expect(docxBytes[0]).toBe(0x50); // "PK"
    expect(docxBytes[1]).toBe(0x4b);

    // Switching template swaps the whole editor and the whole document. The
    // LOCAR's fixed paragraphs are not optional, so they must appear without
    // the user writing anything.
    const locarButton = [...mount.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('LOCAR'),
    )!;
    locarButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await vi.waitFor(
      () => {
        expect(mount.textContent).toContain('You are hereby counseled.');
      },
      { timeout: 10000, interval: 50 },
    );
    const locarText = mount.textContent ?? '';
    expect(locarText).toContain('Privacy Act');
    expect(locarText).toContain('ACKNOWLEDGEMENT');
    expect(locarText.replace(/\u00a0/g, ' ')).toContain('SUBJECT:  Letter of Counseling');
    // CUI defaults on for a letter that names a member and describes conduct.
    expect(locarText).toContain('CUI');

    expect(denied, `page attempted network requests: ${denied.join(', ')}`).toEqual([]);

    dom.window.close();
  }, 90000);
});

/**
 * The field boxes draw at the form's true width (765px for a 202.321mm line)
 * and scale down to fit their column. The scale must be computed against the
 * container's *content* box: clientWidth includes padding, and using it raw
 * left the inner box ~24px too wide, which overflow:hidden then clipped --
 * every line cut off mid-word at the right edge.
 */
describeBuilt('field boxes scale to fit rather than clip', () => {
  it('never renders wider than the space available', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(readFileSync(offlineFile, 'utf8'), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'file:///bullet-bench-offline.html',
    });
    const w = dom.window;

    // jsdom performs no layout, so supply a realistic column and padding.
    const COLUMN = 722;
    const PADDING = 12;
    Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', {
      value: COLUMN,
      configurable: true,
    });
    const realComputed = w.getComputedStyle.bind(w);
    w.getComputedStyle = ((el: Element) => {
      const style = realComputed(el as HTMLElement);
      return new Proxy(style, {
        get(target, key) {
          if (key === 'paddingLeft' || key === 'paddingRight') return `${PADDING}px`;
          return Reflect.get(target, key);
        },
      });
    }) as typeof w.getComputedStyle;

    const root = w.document.getElementById('bullet-bench-root')!;
    await vi.waitFor(
      () => {
        expect(root.textContent).toMatch(/[  ]/);
      },
      { timeout: 45000, interval: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const boxes = [...root.querySelectorAll('div')].filter((el) =>
      (el as HTMLElement).style.transform?.includes('scale'),
    );
    expect(boxes.length).toBeGreaterThan(0);

    const available = COLUMN - PADDING * 2;
    for (const box of boxes) {
      const el = box as HTMLElement;
      const scale = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
      const width = parseFloat(el.style.width);
      expect(width).toBeGreaterThan(available); // true form width, not reflowed
      expect(width * scale).toBeLessThanOrEqual(available + 0.5);
    }
    dom.window.close();
  }, 90000);
});
