/**
 * Parsing and mapping for installation-run websites (*.af.mil, *.jb.mil).
 *
 * Split out of the importer so it can be tested against fixture HTML rather
 * than against the live web. Every function here is pure: HTML in, structured
 * values out, no fetching, no clock, no randomness. The importer does the
 * network and the file writing; this file does the judgement, and the tests
 * pin the judgement down.
 *
 * The one rule the whole module exists to enforce: a value is only ever
 * *read* off a page. Nothing is inferred from an area code, a base name, or
 * what a number "usually" is. A label the rules do not recognise is dropped,
 * and a label that two categories both claim is dropped as ambiguous, because
 * a missing helping-agency number is an inconvenience and a wrong one is a
 * catastrophe.
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
};

export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** Block-level elements. Splitting on these is what keeps one entry per line. */
const BLOCK = 'p|br|li|tr|td|th|div|h[1-6]|dt|dd|section|article|option';

/**
 * The visible text of a page, one line per block-level element.
 *
 * Scripts and styles go first, or a stylesheet's `width:300px` reads as a
 * phone number and a tracking script's numbers read as anything at all.
 */
export function textLines(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(new RegExp('<(script|style|noscript)\\b[^>]*>[\\s\\S]*?</\\1>', 'gi'), ' ');
  s = s.replace(new RegExp(`<(?:${BLOCK})\\b[^>]*>`, 'gi'), '\n');
  s = s.replace(new RegExp(`</(?:${BLOCK})>`, 'gi'), '\n');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * A North American number, optionally parenthesised, optionally with a country
 * or DSN prefix. Deliberately narrow: a loose pattern turns building numbers,
 * dates and zip codes into phone numbers, and a wrong number here is the worst
 * output this project can produce.
 */
const PHONE = /(?:\+?1[ .-])?\(?([2-9]\d{2})\)?[ .-]?([2-9]\d{2})[ .-](\d{4})\b/;
const PHONE_G = new RegExp(PHONE.source, 'g');

/** Digits only, for comparing two renderings of the same number. */
export function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function samePhone(a, b) {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  return x.length > 0 && x === y;
}

/** 530-634-2941, matching the shape the MilitaryINSTALLATIONS import writes. */
export function formatPhone(match) {
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * A directory label is a name, not a sentence.
 *
 * Base pages mix the two freely -- "Command Post: 229-257-9308" sits three
 * lines from "For emergencies after duty hours, contact the Command Post at
 * (229) 257-9308". Reading prose gives labels that are whole sentences, and
 * worse, it attributes numbers that the sentence only mentions in passing:
 * "contact the Defense Finance and Accounting Service (DFAS) at (800)
 * 321-1080" is not the base comptroller's line. Both are rejected here.
 */
const MAX_LABEL_WORDS = 8;

/** Words no directory label ends with. A label ending in one is a sentence. */
const PROSE_TAIL = new Set([
  'at', 'on', 'to', 'the', 'a', 'an', 'of', 'for', 'by', 'or', 'and', 'is',
  'are', 'call', 'contact', 'dial', 'phone', 'reach', 'visit', 'see', 'email',
]);

/**
 * Words no directory label starts with.
 *
 * The other half of the same problem, and the one that survives a short
 * sentence: "For additional questions, please call the Chapel" is seven words,
 * ends in a noun, and is still prose. A label names an agency; it does not
 * address the reader.
 */
const PROSE_HEAD = new Set([
  'for', 'to', 'please', 'call', 'contact', 'if', 'when', 'you', 'your', 'we',
  'our', 'all', 'this', 'that', 'dial', 'visit', 'see', 'email', 'in', 'once',
  'before', 'note', 'members', 'personnel', 'anyone', 'those', 'there', 'it',
]);

/**
 * Toll-free numbers.
 *
 * An installation's chapel, command post and comptroller are not reachable on
 * an 800 number. A toll-free number on a base page belongs to something
 * national -- DFAS, TRICARE, the Safe Helpline -- and filing it as the base's
 * own agency sends a Shirt to a call centre that has never heard of them. The
 * one national number this toolkit does carry, Military OneSource, comes from
 * national.json where it is verified, not from a base page.
 */
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);

/**
 * One directory line -> a label, a commercial number, and a DSN if the line
 * names one. Returns null when the line is not a directory entry.
 *
 * "Command Post: (405) 734-7313, DSN 884-7313" is the shape being read. The
 * first number is the commercial one; a number introduced by the letters DSN
 * is recorded as DSN rather than as a second phone.
 */
export function parseDirectoryLine(line) {
  if (line.length > 220) return null;
  PHONE_G.lastIndex = 0;
  const first = PHONE_G.exec(line);
  if (!first) return null;
  if (TOLL_FREE.has(first[1])) return null;
  // A digit immediately before the match means this is the tail of a longer
  // number, not a number. Osan publishes "Comm 0505-784-7000"; reading ten
  // digits out of the middle of that produces a number that dials nowhere,
  // which is precisely the failure this project cannot have.
  if (/\d/.test(line[first.index - 1] ?? '')) return null;

  let label = line.slice(0, first.index).replace(/[\s:;.,\-–—•*|]+$/, '').trim();
  // Some pages put the number first and the agency in brackets after it --
  // "580-213-7211 (Chapel)". Still a label read off the page, just on the
  // other side of the number.
  if (!label) {
    label = /^\s*[-–—:]?\s*\(([^)]{2,60})\)/.exec(line.slice(first.index + first[0].length))?.[1]?.trim() ?? '';
  }
  if (!label) return null;

  const words = label.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  if (words.length === 0 || words.length > MAX_LABEL_WORDS) return null;
  if (PROSE_HEAD.has(words[0])) return null;
  if (PROSE_TAIL.has(words[words.length - 1])) return null;

  let dsn = '';
  const rest = line.slice(first.index + first[0].length);
  const dsnMatch = new RegExp(`DSN[^0-9a-z]{0,12}(?:${PHONE.source}|(\\d{3}-\\d{4}))`, 'i').exec(rest);
  if (dsnMatch) dsn = dsnMatch[4] ?? formatPhone(dsnMatch);
  // A line whose label itself is the letters DSN is a DSN-only entry.
  const labelIsDsn = /\bdsn\b/i.test(label);

  return {
    label: labelIsDsn ? label.replace(/[\s(]*\bdsn\b[\s):]*/gi, ' ').replace(/\s+/g, ' ').trim() : label,
    phone: labelIsDsn ? '' : formatPhone(first),
    dsn: labelIsDsn ? formatPhone(first) : dsn,
  };
}

/** Every directory entry on a page, in page order. */
export function parseDirectory(html) {
  const seen = new Set();
  const entries = [];
  for (const line of textLines(html)) {
    const entry = parseDirectoryLine(line);
    if (!entry) continue;
    if (!entry.phone && !entry.dsn) continue;
    const key = `${entry.label.toLowerCase()}|${entry.phone}|${entry.dsn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Label -> category
// ---------------------------------------------------------------------------

/**
 * Labels are written by seventy different web maintainers, so they are folded
 * hard before matching: case, ampersands and punctuation all go, and a slash
 * becomes a space so that "Family Advocacy/Mental Health" reads as the two
 * agencies it names and gets dropped as ambiguous rather than filed under one.
 */
export function normalizeLabel(label) {
  return String(label ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const contains = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

/**
 * The category a label names, or null.
 *
 * Null covers two different failures on purpose. Nothing matched, or more than
 * one category matched -- "Family Advocacy / Mental Health" is a real label on
 * a real base page and there is no honest way to file one number under one of
 * them. Both end the same way: the entry is dropped. Rule 3 of the brief.
 */
export function matchCategory(label, rules) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  const hits = [];
  for (const rule of rules) {
    if ((rule.exclude ?? []).some((phrase) => contains(normalized, normalizeLabel(phrase)))) continue;
    if ((rule.labels ?? []).some((phrase) => contains(normalized, normalizeLabel(phrase)))) {
      hits.push(rule.id);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Ranks two candidates for the same category. Lower sorts first.
 *
 * Exact match to a listed synonym beats a longer label that merely contains
 * one ("Chapel" over "Chapel Annex Scheduling"), then the shorter label, then
 * the URL. Total and content-derived, so the same pages always yield the same
 * pick -- the importer has to be re-runnable with a readable diff.
 */
function rank(candidate, rule) {
  const normalized = normalizeLabel(candidate.label);
  const exact = (rule.labels ?? []).some((phrase) => normalizeLabel(phrase) === normalized) ? 0 : 1;
  return [exact, normalized.length, normalized, candidate.url, candidate.phone];
}

function compare(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Picks one contact per category out of everything read across a base's pages.
 *
 * `pages` is [{ url, entries }] as returned by parseDirectory.
 */
export function chooseContacts(pages, rules) {
  const byCategory = new Map();
  for (const page of pages) {
    for (const entry of page.entries) {
      const categoryId = matchCategory(entry.label, rules);
      if (!categoryId) continue;
      const candidate = { ...entry, url: page.url, categoryId };
      const rule = rules.find((r) => r.id === categoryId);
      const current = byCategory.get(categoryId);
      if (!current || compare(rank(candidate, rule), rank(current, rule)) < 0) {
        byCategory.set(categoryId, candidate);
      }
    }
  }
  return byCategory;
}

// ---------------------------------------------------------------------------
// Finding the pages worth reading
// ---------------------------------------------------------------------------

/**
 * Same-host links whose own wording says they lead to a directory, best first.
 *
 * Hints come from the data file, not from here, and their ORDER there is the
 * priority: a link saying "Directory" outranks one saying "Resources". That
 * ranking is what makes a page budget work -- a site with forty "Contact"
 * links in its navigation would otherwise spend the whole budget before
 * reaching the one page that actually lists the agencies.
 *
 * News articles and documents are dropped: an article that happens to print a
 * number is a snapshot of one day, and a PDF is not text this parser can read
 * honestly.
 */
export function directoryLinks(html, pageUrl, hints) {
  const base = new URL(pageUrl);
  const found = new Map();
  const patterns = hints.map((h) => new RegExp(h, 'i'));
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(decodeEntities(match[1]), base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    // https only. These sites all serve it, and a cited source has to be a
    // link worth following from a page people trust.
    if (url.protocol !== 'https:') continue;
    if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|zip)$/i.test(url.pathname)) continue;
    if (/\/(news|article-display|photos|videos|biographies)\//i.test(url.pathname)) continue;
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // The link's own path counts as wording too. Half these sites hang the
    // directory off an image or an icon with no text at all, and the path
    // ("/Contact-Us/Directory/") is then the only thing that says what it is.
    const path = url.pathname.replace(/[^a-z0-9]+/gi, ' ').trim();
    const rank = patterns.findIndex((p) => p.test(text) || p.test(path));
    if (rank < 0) continue;
    url.hash = '';
    const href = url.toString();
    if (!found.has(href) || found.get(href) > rank) found.set(href, rank);
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([href]) => href);
}

/**
 * A page really does belong to this installation.
 *
 * Guessing a hostname is fine; *keeping* one you guessed is not. The site is
 * only accepted when the page it serves says the installation's own name back,
 * so a lucky DNS hit on some other unit's site cannot end up filed as this
 * base's chapel number.
 */
export function pageTitle(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return decodeEntities(title.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Everything on a page that says which installation it belongs to.
 *
 * The title alone is not enough. A good third of these sites run the same CMS
 * skin with `<title>Home</title>` and put the installation's name only in the
 * description and keywords -- "The official website for Dyess Air Force Base".
 * Matching on the title alone silently rejected those sites as unidentifiable,
 * which is the safe failure but still the wrong answer.
 */
export function pageIdentity(html) {
  const parts = [pageTitle(html)];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /\b(?:name|property)="([^"]*)"/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!['description', 'keywords', 'og:site_name', 'og:title'].includes(name)) continue;
    const content = /\bcontent="([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (content) parts.push(decodeEntities(content));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** The words in an installation label that a site title would have to echo. */
const LABEL_NOISE = new Set([
  'afb', 'ab', 'air', 'force', 'base', 'joint', 'and', 'the', 'us', 'u', 's',
  'annex', 'naval', 'facility', 'station', 'field', 'region', 'element',
]);

export function siteMatchesInstallation(title, label) {
  const words = normalizeLabel(label).split(' ').filter((w) => w.length > 2 && !LABEL_NOISE.has(w));
  if (words.length === 0) return false;
  const haystack = normalizeLabel(title);
  return words.some((word) => haystack.includes(word));
}
