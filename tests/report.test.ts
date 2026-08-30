import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, readEnvironment, type Environment } from '@/lib/report';
import { ISSUES_URL, NEW_ISSUE_URL, REPO, REPO_URL, VERSION } from '@/lib/site';

/**
 * The bug report.
 *
 * Two things matter here and the rest is formatting. The report must never
 * carry what somebody typed into a tool -- these tools hold duty history and
 * service dates, and a GitHub issue is public and permanent. And the repository
 * URL must be true, because a dead "report a bug" link is worse than none: it
 * costs the reporter their time and tells the maintainer nothing.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

const ENV: Environment = {
  build: 'hosted',
  page: '/tools/btz-calculator/',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
  language: 'en-US',
  timeZone: 'America/Chicago',
  viewport: '1440x900',
  theme: 'light',
  reducedMotion: false,
  storage: 'available',
};

const SOURCES = [
  {
    source: 'AFI 36-2502, Enlisted Airman Promotion and Demotion Programs',
    version: '2 July 2026',
    verifiedDate: '2026-08-30',
    sourceUrl: 'https://example.invalid/afi36-2502.pdf',
    status: 'verified' as const,
  },
];

function report(over: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return buildReport({
    tool: 'BTZ Calculator',
    description: 'The projected date was a day early.',
    expected: '15 FEB 2028.',
    steps: '1. Enter two dates',
    environment: ENV,
    sources: SOURCES,
    ...over,
  });
}

describe('the report', () => {
  it('carries the tool, the version, and what the reporter wrote', () => {
    const text = report();
    expect(text).toContain('BTZ Calculator');
    expect(text).toContain(VERSION);
    expect(text).toContain('The projected date was a day early.');
    expect(text).toContain('15 FEB 2028.');
    expect(text).toContain('1. Enter two dates');
  });

  it('carries the environment, which is where layout and date bugs hide', () => {
    const text = report();
    for (const value of Object.values(ENV)) {
      if (typeof value === 'string') expect(text, value).toContain(value);
    }
    expect(text).toContain('Reduced motion');
  });

  it('names each data source with its version and verified state', () => {
    const text = report();
    expect(text).toContain('AFI 36-2502');
    expect(text).toContain('v2 July 2026');
    expect(text).toContain('verified');
    expect(text).toContain('2026-08-30');
  });

  it('says which fields were left blank rather than dropping them silently', () => {
    const text = report({ expected: '', steps: '   ' });
    expect(text).toContain('WHAT I EXPECTED\n(not given)');
    expect(text).toContain('STEPS TO REPRODUCE\n(not given)');
  });

  it('still produces a usable report when the environment is unavailable', () => {
    const text = report({ environment: null });
    expect(text).toContain('ENVIRONMENT\n(unavailable)');
    expect(text).toContain('The projected date was a day early.');
  });

  /**
   * The load-bearing test. Nothing entered into a tool may reach the report,
   * and the report has to say so in the text itself -- the reporter is the one
   * deciding what to paste into a public tracker, so they have to be told what
   * they are holding.
   */
  it('warns, in the report itself, against pasting a real record', () => {
    const text = report();
    expect(text).toContain('Nothing entered into the tool is included');
    expect(text).toContain('Never paste a real duty history or service record');
  });

  it('has no field through which tool entries could reach it', () => {
    // The builder's whole input surface. If a future edit adds a way to attach
    // what a user typed, it lands here and this test is the argument against it.
    const text = report();
    const accepted = ['tool', 'description', 'expected', 'steps', 'environment', 'sources'];
    expect(accepted).toEqual(['tool', 'description', 'expected', 'steps', 'environment', 'sources']);
    // A bullet or a date of rank only appears if the reporter typed it into
    // one of the three prose fields, which they can see and edit.
    expect(text).not.toContain('localStorage');
    expect(text).not.toContain('ocg.');
  });
});

describe('reading the environment', () => {
  /** A stub window, so every field is pinned rather than whatever CI has. */
  function stubWindow(over: Record<string, unknown> = {}) {
    return {
      location: { protocol: 'https:', pathname: '/report/', search: '?x=1' },
      navigator: { userAgent: 'StubBrowser/1.0', language: 'en-GB' },
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 2,
      localStorage: { setItem: () => {}, removeItem: () => {} },
      matchMedia: () => ({ matches: true }),
      document: { documentElement: { getAttribute: () => 'dark' } },
      ...over,
    } as unknown as Window;
  }

  it('reads what the browser reports', () => {
    const env = readEnvironment(stubWindow());
    expect(env).toMatchObject({
      build: 'hosted',
      page: '/report/',
      userAgent: 'StubBrowser/1.0',
      language: 'en-GB',
      viewport: '800x600 @2x',
      theme: 'dark',
      reducedMotion: true,
      storage: 'available',
    });
  });

  // A query string can carry entered values, so only the path is taken.
  it('takes the path but never the query string', () => {
    const env = readEnvironment(stubWindow());
    expect(env.page).toBe('/report/');
    expect(JSON.stringify(env)).not.toContain('x=1');
  });

  it('tells a saved-to-disk copy from a hosted page', () => {
    const env = readEnvironment(
      stubWindow({ location: { protocol: 'file:', pathname: '/btz.html', search: '' } }),
    );
    expect(env.build).toBe('offline file');
  });

  it('reports blocked storage instead of throwing', () => {
    const env = readEnvironment(
      stubWindow({
        localStorage: {
          setItem: () => {
            throw new Error('blocked');
          },
          removeItem: () => {},
        },
      }),
    );
    expect(env.storage).toBe('blocked');
  });

  it('omits the pixel ratio when there is nothing to say', () => {
    expect(readEnvironment(stubWindow({ devicePixelRatio: 1 })).viewport).toBe('800x600');
  });
});

describe('the repository URL', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  it('is well formed', () => {
    expect(REPO).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(REPO_URL).toBe(`https://github.com/${REPO}`);
    expect(ISSUES_URL).toBe(`${REPO_URL}/issues`);
    expect(NEW_ISSUE_URL).toBe(`${REPO_URL}/issues/new`);
  });

  /**
   * Three copies of this URL exist -- here, package.json, and the offline
   * build's own shell, which cannot import from src. Copies drift, so they are
   * checked against each other rather than trusted.
   */
  it('agrees with package.json', () => {
    expect(pkg.repository.url).toContain(REPO);
    expect(pkg.bugs.url).toBe(ISSUES_URL);
    expect(pkg.homepage).toContain(REPO);
    expect(pkg.version).toBe(VERSION);
  });

  it('agrees with the offline build script', () => {
    const script = readFileSync(join(root, 'scripts', 'build-offline.mjs'), 'utf8');
    expect(script).toContain(ISSUES_URL);
  });

  it('carries no prefilled issue body, which the browser would truncate', () => {
    expect(NEW_ISSUE_URL).not.toContain('?');
    expect(NEW_ISSUE_URL).not.toContain('body=');
  });
});
