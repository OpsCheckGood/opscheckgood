/// <reference types="astro/client" />
/**
 * The one list of tools the site knows about.
 *
 * The home page grid, the header dropdown, the footer column and the phone tab
 * bar all render from here. Keeping four copies of the same list is how a tool
 * ends up shipped but unlinked, or linked but renamed.
 */

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const home = import.meta.env.BASE_URL;

export interface Tool {
  /** Full name, as it appears on the tool's own page. */
  name: string;
  /**
   * Short label for the phone tab bar, where five of these share a screen
   * width and the full names would truncate.
   */
  short: string;
  /** The tool's own one-line tagline. */
  tagline: string;
  href: string;
  /** Home page card copy. */
  blurb: string;
  /**
   * False names the tool without linking it: a dead link is worse than an
   * honest "not yet".
   */
  ready: boolean;
}

/** Listed in build order. */
export const tools: Tool[] = [
  {
    name: 'Bullet Bench',
    short: 'Bullet',
    tagline: 'Write sharp. Get recognized.',
    href: `${base}/tools/bullet-bench/`,
    ready: true,
    blurb:
      'Fits a statement onto the single line a form allows by substituting half spaces, ' +
      'measured against the real rendered width rather than a character count.',
  },
  {
    name: 'PT Calculator',
    short: 'PT',
    tagline: 'Score a fitness assessment.',
    href: `${base}/tools/pt-calculator/`,
    ready: true,
    blurb:
      'Scores a Physical Fitness Assessment from the published tables, with component ' +
      'options handled as table entries rather than special cases. Includes the Tier 2 ' +
      'body fat worksheet, which opens only when the score actually calls for one.',
  },
  {
    name: 'BTZ Calculator',
    short: 'BTZ',
    tagline: 'Know the date. Build the package.',
    href: `${base}/tools/btz-calculator/`,
    ready: true,
    blurb:
      'Projects a below-the-zone consideration window, board quarter and promotion date ' +
      'from a date entered active duty and a date of rank, and shows the arithmetic.',
  },
  {
    name: 'MFR Generator',
    short: 'MFR',
    tagline: 'Format it once. Sign it.',
    href: `${base}/tools/mfr/`,
    ready: true,
    blurb:
      'Writes an official memorandum for record or a letter of counseling, admonishment or ' +
      'reprimand to Tongue-and-Quill format, with an editable letterhead, and exports a PDF or ' +
      'an editable Word document.',
  },
];

/**
 * A collection rather than a single tool, so it sits beside the list instead of
 * inside it: it has its own landing page and its own audience.
 */
export const firstSergeant = {
  name: 'First Sergeant Toolkit',
  short: 'First Sergeant',
  tagline: 'Where do I send them?',
  href: `${base}/first-sergeant/`,
  ready: true,
};

export const settings = {
  name: 'Settings',
  href: `${base}/settings/`,
  ready: true,
};
