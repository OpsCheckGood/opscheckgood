import type { DataMeta } from './data/types';
import { VERSION } from './site';

/**
 * Builds a bug report the user copies and pastes into a GitHub issue.
 *
 * Nothing is sent from the page. There is no backend to send it to, and hard
 * constraint 1 forbids the request even if there were -- so this produces text,
 * the user reads it, and the user decides where it goes.
 *
 * WHAT THIS DELIBERATELY DOES NOT COLLECT: anything typed into a tool. Bullet
 * Bench holds real duty history and the BTZ calculator holds real service dates
 * (constraint 2). A checkbox offering to attach them would be convenient
 * roughly once and would put somebody's record into a public issue tracker the
 * other times, so the report describes the environment and the data versions
 * and stops there. If a bug depends on the input, the reporter writes their own
 * redacted example in the description, where they can see exactly what they are
 * sharing.
 *
 * The page renders the finished report verbatim before the copy button, for the
 * same reason: a report you cannot read before you send it is a report you have
 * to trust, and this project does not ask anyone to do that.
 */

export interface Environment {
  /** 'hosted' or 'offline file' -- file:// behaves differently in real ways. */
  build: string;
  /** Path only. Never the query string, which could carry entered values. */
  page: string;
  userAgent: string;
  language: string;
  timeZone: string;
  viewport: string;
  theme: string;
  reducedMotion: boolean;
  /** Private mode and locked-down browsers block it, which breaks drafts. */
  storage: string;
}

export interface ReportInput {
  tool: string;
  /** What happened, in the reporter's words. */
  description: string;
  /** What they expected instead. */
  expected: string;
  /** How to make it happen again. */
  steps: string;
  environment: Environment | null;
  /** Provenance of the data behind the tool, which is usually the answer. */
  sources: readonly DataMeta[];
}

/** The label column width, so the report reads as a table in a monospace font. */
const PAD = 14;

function row(label: string, value: string): string {
  return `${label.padEnd(PAD)}${value}`;
}

function section(title: string, body: string): string {
  return `${title}\n${body.trim() === '' ? '(not given)' : body.trim()}`;
}

/**
 * Reads what the browser will tell us. Takes the window rather than reaching
 * for a global so the tests can hand it a stub and pin every field.
 */
export function readEnvironment(win: Window): Environment {
  const doc = win.document;

  let storage = 'available';
  try {
    const probe = '__ocg_probe__';
    win.localStorage.setItem(probe, '1');
    win.localStorage.removeItem(probe);
  } catch {
    storage = 'blocked';
  }

  let timeZone = 'unknown';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    /* Older or stripped-down runtimes. Not worth failing the report over. */
  }

  const ratio = win.devicePixelRatio;
  return {
    build: win.location.protocol === 'file:' ? 'offline file' : 'hosted',
    // Path only, deliberately: a query string can carry entered values.
    page: win.location.pathname || '/',
    userAgent: win.navigator.userAgent,
    language: win.navigator.language,
    timeZone,
    viewport:
      `${win.innerWidth}x${win.innerHeight}` +
      (typeof ratio === 'number' && ratio !== 1 ? ` @${ratio}x` : ''),
    theme: doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    reducedMotion: win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    storage,
  };
}

export function buildReport(input: ReportInput): string {
  const { environment: env } = input;

  const lines = [
    'OPS CHECK GOOD — BUG REPORT',
    '',
    row('Tool', input.tool),
    row('Version', VERSION),
    '',
    section('WHAT HAPPENED', input.description),
    '',
    section('WHAT I EXPECTED', input.expected),
    '',
    section('STEPS TO REPRODUCE', input.steps),
    '',
    'ENVIRONMENT',
  ];

  if (env === null) {
    lines.push('(unavailable)');
  } else {
    lines.push(
      row('Build', env.build),
      row('Page', env.page),
      row('Browser', env.userAgent),
      row('Language', env.language),
      row('Time zone', env.timeZone),
      row('Viewport', env.viewport),
      row('Theme', env.theme),
      row('Reduced motion', env.reducedMotion ? 'yes' : 'no'),
      row('Storage', env.storage),
    );
  }

  if (input.sources.length > 0) {
    lines.push('', 'DATA SOURCES');
    for (const meta of input.sources) {
      lines.push(
        `${meta.source} — v${meta.version} — ${meta.status} — checked ${meta.verifiedDate}`,
      );
    }
  }

  lines.push(
    '',
    '--',
    'Nothing entered into the tool is included in this report. If the bug depends',
    'on what was typed, describe it above — redacted, and only as much as it takes',
    'to reproduce. Never paste a real duty history or service record into a public',
    'issue.',
  );

  return lines.join('\n');
}
