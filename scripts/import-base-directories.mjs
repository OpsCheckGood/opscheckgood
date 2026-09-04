#!/usr/bin/env node
/**
 * Fills the gaps MilitaryINSTALLATIONS leaves, from each installation's own
 * official website.
 *
 * Military OneSource publishes a fixed set of programme pages, and nine of the
 * seventeen agencies a First Sergeant actually routes to are not among them:
 * command post, mental health, chaplain, SARC, security forces, finance, MPF,
 * equal opportunity, and the worldwide Military OneSource line itself. Those
 * numbers are published — just on www.<base>.af.mil, in a base directory or a
 * "Contact Us" page, in seventy different layouts.
 *
 * So this script reads those pages and fills only the empty slots. It never
 * overwrites a MilitaryINSTALLATIONS value; where the two sources disagree the
 * imported value stands and the base site's is recorded in the contact's notes,
 * so the disagreement is visible instead of silently resolved.
 *
 * Build time only. Constraint 1 forbids the shipped page making any request at
 * all — this bakes JSON into the repository and nothing is fetched at runtime.
 *
 * Which label on a base page means which agency lives in categories.json as
 * `siteLabels` / `siteExcludeLabels`, and which pages are worth reading lives
 * in base-sites.json as `pageHints`. Neither is named here: widening what the
 * importer accepts is a data edit — constraint 4.
 *
 * Nothing in this file writes a number it did not read off a fetched page.
 * A label the rules do not recognise is dropped; a label two categories both
 * claim is dropped as ambiguous. An empty field is a correct answer.
 *
 *   node scripts/import-base-directories.mjs --discover     # resolve base websites
 *   node scripts/import-base-directories.mjs                # read them, fill the gaps
 *   node scripts/import-base-directories.mjs beale-afb      # one installation
 *
 * Options:
 *   --discover     resolve each installation's official site and record it
 *   --dry-run      report what would change, write nothing
 *   --limit N      stop after N installations
 *   --delay MS     pause between requests (default 1200)
 *   --cache DIR    where fetched pages are kept (default $TMPDIR/ops-check-good-pages)
 *   --pages N      most pages to read per installation (default 10)
 *   --refetch      ignore the cache
 *
 * *.af.mil answers a plain client with 403, so pages are fetched through a
 * text-extraction proxy (r.jina.ai). That is a build-time convenience and not
 * a dependency of the site; --proxy takes another one, and an empty --proxy
 * fetches directly for anyone on a network where that works.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';

import {
  chooseContacts,
  directoryLinks,
  pageIdentity,
  pageTitle,
  parseDirectory,
  samePhone,
  siteMatchesInstallation,
} from './lib/baseDirectory.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data', 'firstsergeant');
const outDir = join(dataDir, 'installations');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
/** Flags that consume the next argument, so a slug is never mistaken for one. */
const VALUE_FLAGS = new Set(['limit', 'delay', 'cache', 'pages', 'proxy']);
const named = args.filter(
  (a, i) => !a.startsWith('--') && !VALUE_FLAGS.has((args[i - 1] ?? '').replace(/^--/, '')),
);

const DELAY = Number(value('delay', 1200));
const LIMIT = Number(value('limit', 0));
const MAX_PAGES = Number(value('pages', 10));
const PROXY = value('proxy', 'https://r.jina.ai/');
const CACHE = value('cache', join(tmpdir(), 'ops-check-good-pages'));
const TODAY = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fetching, cached on disk so a re-run costs nothing and a failure part way
// through loses nothing.
// ---------------------------------------------------------------------------

mkdirSync(CACHE, { recursive: true });

function cachePath(url) {
  return join(CACHE, `${createHash('sha1').update(url).digest('hex')}.html`);
}

/**
 * Only successes are cached. A failed fetch leaves nothing behind, so resuming
 * an interrupted run retries what failed and re-reads nothing that worked --
 * which is what makes running this against seventy bases practical.
 */
async function get(url, attempts = 2) {
  const file = cachePath(url);
  if (!flag('refetch') && existsSync(file)) return readFileSync(file, 'utf8');

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let body = '';
    try {
      const response = await fetch(PROXY ? `${PROXY}${url}` : url, {
        headers: {
          'user-agent': 'ops-check-good-importer/1.0 (+https://opscheckgood.com)',
          accept: 'text/html,application/xhtml+xml',
          // Ask the proxy for the page's markup rather than its own prose
          // rendering: the rendering silently truncates long directories.
          'x-respond-with': 'html',
        },
        signal: AbortSignal.timeout(120_000),
      });
      body = response.ok ? await response.text() : '';
    } catch {
      body = '';
    }
    await sleep(DELAY * (attempt + 1));
    if (body !== '') {
      writeFileSync(file, body);
      return body;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value_) => writeFileSync(file, `${JSON.stringify(value_, null, 2)}\n`);

const SITES_FILE = join(dataDir, 'base-sites.json');
const categoriesFile = readJson(join(dataDir, 'categories.json'));
const categories = categoriesFile.data.categories;
const nationalFile = readJson(join(dataDir, 'national.json'));

/** The label rules, in the shape the matcher wants. Straight out of the data. */
const rules = categories.map((c) => ({
  id: c.id,
  labels: c.siteLabels ?? [],
  exclude: c.siteExcludeLabels ?? [],
}));

/** Which link text says "this page is a directory". Also straight out of the data. */
const PAGE_HINTS = readJson(SITES_FILE).data.pageHints;

const installationFiles = () =>
  readdirSync(outDir)
    .filter((f) => f.endsWith('.json') && f !== 'example.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

// ---------------------------------------------------------------------------
// Discovery: which website belongs to which installation
// ---------------------------------------------------------------------------

/**
 * Hostnames worth trying for an installation, cheapest first.
 *
 * A guessed hostname is not invented data — it is a guess that then has to
 * survive being fetched and having its own page name the installation back.
 * Guesses that fail that check are discarded, and an installation with no
 * surviving candidate simply gets no site.
 */
function hostCandidates(slug, extra) {
  const noise = new Set(['afb', 'ab', 'air', 'force', 'base', 'joint', 'and', 'annex', 'naval', 'facility']);
  const parts = slug.split('-');
  const core = parts.filter((p) => !noise.has(p));
  const names = [];
  const add = (name) => {
    const trimmed = name.replace(/^-|-$/g, '');
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  };
  add(core.join(''));
  add(core.join('-'));
  add(parts.join(''));
  if (core[0]) add(core[0]);
  if (core.length > 1) add(core.slice(0, 2).join(''));
  if (parts[0] === 'joint' && parts[1] === 'base') add(`jb${core.join('')}`);
  add(`${core.map((p) => p[0]).join('')}afb`);

  const hosts = [];
  for (const host of extra) if (!hosts.includes(host)) hosts.push(host);
  for (const name of names) {
    for (const domain of ['af.mil', 'jb.mil']) {
      const host = `www.${name}.${domain}`;
      if (!hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}

/**
 * Does this hostname exist at all.
 *
 * Cheap, and it prunes most of the guesses before any page is fetched. Capped
 * in time because a name that does not exist can otherwise sit through the
 * resolver's full retry schedule, and there are a dozen guesses per base.
 */
async function resolves(host) {
  try {
    await Promise.race([
      dns.lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000).unref()),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function discover() {
  const sites = readJson(SITES_FILE);
  const extraHosts = sites.data.extraHosts ?? {};
  const found = [];
  let slugs = named.length > 0 ? named : installationFiles();
  if (LIMIT > 0) slugs = slugs.slice(0, LIMIT);

  for (const [index, slug] of slugs.entries()) {
    const label = readJson(join(outDir, `${slug}.json`)).data.label;
    process.stdout.write(`[${index + 1}/${slugs.length}] ${slug} … `);
    let hit = null;
    for (const host of hostCandidates(slug, extraHosts[slug] ?? [])) {
      if (!(await resolves(host))) continue;
      const url = `https://${host}/`;
      const html = await get(url);
      if (!html) continue;
      // Checked against the slug as well as the label: MilitaryINSTALLATIONS
      // has renamed bases the base's own site has not, and the point of the
      // check is "is this the right installation", not "do two strings agree".
      const evidence = pageIdentity(html);
      if (!siteMatchesInstallation(evidence, `${label} ${slug.replace(/-/g, ' ')}`)) continue;
      hit = { id: slug, label, url, title: pageTitle(html), evidence, checked: TODAY };
      break;
    }
    if (hit) {
      found.push(hit);
      console.log(hit.url);
    } else {
      console.log('no site found');
    }
  }

  // Keep any site this run did not look at, so discovering one base does not
  // drop the rest.
  const kept = (sites.data.sites ?? []).filter((s) => !slugs.includes(s.id));
  const merged = [...kept, ...found].sort((a, b) => (a.id < b.id ? -1 : 1));

  /**
   * One site, one installation.
   *
   * A wing that hosts several installations runs one website for all of them
   * -- the 501st Combat Support Wing's site serves RAF Alconbury, Molesworth,
   * Croughton and Fairford, and names all four. Its directory cannot be
   * attributed to any one of them, so every installation claiming a shared
   * site loses it rather than one of them winning it arbitrarily.
   */
  const claims = new Map();
  for (const site of merged) claims.set(site.url, (claims.get(site.url) ?? 0) + 1);
  const shared = merged.filter((s) => claims.get(s.url) > 1);
  for (const site of shared) {
    console.log(`  dropped ${site.id}: ${site.url} is shared with another installation`);
  }
  sites.data.sites = merged.filter((s) => claims.get(s.url) === 1);
  sites.meta.verifiedDate = TODAY;
  sites.meta.version = `${Number(String(sites.meta.version).replace(/\D.*/, '') || 0) + 1} (retrieved ${TODAY})`;
  if (!flag('dry-run')) writeJson(SITES_FILE, sites);
  console.log(`\n${sites.data.sites.length} installation site(s) recorded`);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const isEmpty = (contact) => !contact.phone && !contact.dsn && !contact.url;

/** The worldwide Military OneSource entry, verbatim from national.json. */
function oneSourceContact() {
  const resource = nationalFile.data.resources.find((r) => r.categoryId === 'military-onesource');
  if (!resource) return null;
  return {
    categoryId: 'military-onesource',
    name: resource.name,
    phone: resource.phone,
    dsn: resource.dsn ?? '',
    location: resource.location ?? '',
    hours: resource.hours ?? '',
    url: resource.url,
    notes: resource.notes ?? '',
  };
}

/** Reads a base's site: its directory pages, and every entry on them. */
async function readSite(site) {
  const home = await get(site.url);
  if (!home) return [];
  const pages = [{ url: site.url, html: home }];
  const queue = directoryLinks(home, site.url, PAGE_HINTS);
  const seen = new Set([site.url]);

  for (const url of queue) {
    if (pages.length >= MAX_PAGES) break;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await get(url);
    if (!html) continue;
    pages.push({ url, html });
    // One hop further, so a "Contact Us" page that merely links the directory
    // still gets there.
    for (const next of directoryLinks(html, url, PAGE_HINTS)) {
      if (!seen.has(next) && !queue.includes(next)) queue.push(next);
    }
  }
  return pages.map((page) => ({ url: page.url, entries: parseDirectory(page.html) }));
}

async function importInstallation(slug, site) {
  const file = join(outDir, `${slug}.json`);
  const doc = readJson(file);
  const contacts = doc.data.contacts;
  const byId = new Map(contacts.map((c) => [c.categoryId, c]));

  const filled = [];
  const conflicts = [];

  // Military OneSource is one worldwide number, already verified in
  // national.json. It is copied in rather than read off a base page, so that a
  // base with an empty directory still leaves a Shirt with somebody to call.
  const oneSource = oneSourceContact();
  const localOneSource = byId.get('military-onesource');
  if (oneSource && localOneSource && isEmpty(localOneSource)) {
    Object.assign(localOneSource, oneSource);
    filled.push('military-onesource');
  }

  let pages = [];
  if (site) {
    pages = await readSite(site);
    const chosen = chooseContacts(pages, rules);
    for (const [categoryId, candidate] of chosen) {
      const existing = byId.get(categoryId);
      if (!existing) continue;
      if (isEmpty(existing)) {
        existing.name = candidate.label;
        existing.phone = candidate.phone;
        existing.dsn = candidate.dsn;
        existing.url = candidate.url;
        filled.push(categoryId);
        continue;
      }
      // Both sources have a number. The MilitaryINSTALLATIONS value stands --
      // it is the one that was verified first and is what the rest of the file
      // is -- but the disagreement is written down where a Shirt will see it
      // rather than thrown away.
      if (candidate.phone && !samePhone(existing.phone, candidate.phone)) {
        const note =
          `Base website lists ${candidate.phone} for “${candidate.label}” ` +
          `(${candidate.url}, read ${TODAY}).`;
        if (!existing.notes.includes(candidate.phone)) {
          existing.notes = existing.notes ? `${existing.notes} ${note}` : note;
          conflicts.push(categoryId);
        }
      }
    }
  }

  const stillEmpty = contacts.filter(isEmpty).map((c) => c.categoryId);

  if (filled.length > 0 || conflicts.length > 0) {
    doc.meta.source = site
      ? `MilitaryINSTALLATIONS — ${doc.data.label}; ${new URL(site.url).hostname}`
      : doc.meta.source;
    // The MilitaryINSTALLATIONS date is the one already recorded, not today's:
    // this run did not re-read those pages and must not claim it did.
    const importedOn =
      /MilitaryINSTALLATIONS retrieved (\d{4}-\d{2}-\d{2})/.exec(doc.meta.version)?.[1] ??
      doc.meta.verifiedDate;
    doc.meta.version = `2 (MilitaryINSTALLATIONS retrieved ${importedOn}, ${
      site ? 'base website' : 'Military OneSource'
    } read ${TODAY})`;
    doc.meta.verifiedDate = TODAY;
    doc.meta.notes =
      'Two sources, kept apart. The programme contacts (medical, family ' +
      'support, legal, housing, family advocacy, EFMP, child care, emergency ' +
      'relief) were imported by scripts/import-installations.mjs from the ' +
      'official MilitaryINSTALLATIONS pages for this installation. The ' +
      'agencies Military OneSource does not publish per installation were ' +
      (site
        ? `filled by scripts/import-base-directories.mjs from ${site.url}, `
        : 'left empty — no official installation website was resolved for it, ') +
      'and Military OneSource itself is copied from national.json. Every ' +
      'contact carries the URL of the page it was read from; nothing here was ' +
      'typed in, inferred, or generated. Where both sources published a number ' +
      'the MilitaryINSTALLATIONS value stands and the base site’s is recorded ' +
      'in that contact’s notes rather than discarded. ' +
      (stillEmpty.length > 0
        ? `Still empty here, because no source read published one: ${stillEmpty.join(', ')}.`
        : 'Every agency is populated.') +
      ' Re-run either importer to refresh; the diff is the change.';
    if (!flag('dry-run')) writeJson(file, doc);
  }

  return { filled, conflicts, stillEmpty, pages: pages.length };
}

async function main() {
  if (flag('discover')) return discover();

  const sites = readJson(SITES_FILE);
  const siteById = new Map((sites.data.sites ?? []).map((s) => [s.id, s]));

  let slugs = named.length > 0 ? named : installationFiles();
  if (LIMIT > 0) slugs = slugs.slice(0, LIMIT);

  let totalFilled = 0;
  let totalConflicts = 0;
  for (const [index, slug] of slugs.entries()) {
    process.stdout.write(`[${index + 1}/${slugs.length}] ${slug} … `);
    try {
      const result = await importInstallation(slug, siteById.get(slug) ?? null);
      totalFilled += result.filled.length;
      totalConflicts += result.conflicts.length;
      console.log(
        `${result.pages} page(s), filled ${result.filled.length}` +
          `${result.conflicts.length > 0 ? `, ${result.conflicts.length} conflict(s) noted` : ''}` +
          `${result.stillEmpty.length > 0 ? `, ${result.stillEmpty.length} still empty` : ''}`,
      );
    } catch (error) {
      console.log(`failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\nFilled ${totalFilled} contact(s); noted ${totalConflicts} disagreement(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
