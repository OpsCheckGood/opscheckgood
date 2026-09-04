#!/usr/bin/env node
/**
 * Imports installation directories from MilitaryINSTALLATIONS (Military OneSource).
 *
 * This is the answer to "where do the phone numbers come from". They are not
 * typed in, and they are certainly not generated: this script fetches the
 * official page for each agency at each installation, parses the contact card
 * the site renders, and writes it to JSON with the source URL attached. Re-run
 * it to refresh; the diff shows exactly what the official directory changed.
 *
 * Build time only. Hard constraint 1 forbids the shipped page making any
 * request at all -- the data is baked in, and nothing is fetched at runtime.
 *
 * Which program page carries which agency lives in categories.json as
 * `mosPages`, not here, so adding a mapping is a data edit -- constraint 4.
 *
 *   node scripts/import-installations.mjs --list                 # what it would fetch
 *   node scripts/import-installations.mjs --air-force            # every AF installation
 *   node scripts/import-installations.mjs kadena-ab ramstein-ab  # named installations
 *
 * Options:
 *   --all          every installation in the sitemap, not just Air Force
 *   --limit N      stop after N installations
 *   --delay MS     pause between requests (default 250)
 *   --cache DIR    where landing pages are kept (default $TMPDIR/ops-check-good-mos)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data', 'firstsergeant');
const outDir = join(dataDir, 'installations');

const ORIGIN = 'https://installations.militaryonesource.mil';
const SITEMAP = `${ORIGIN}/sitemap.xml`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const named = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));

const DELAY = Number(value('delay', 250));
const LIMIT = Number(value('limit', 0));
const CACHE = value('cache', join(tmpdir(), 'ops-check-good-mos'));

/**
 * Which installations are Air Force.
 *
 * Read off the page, not guessed from the slug. Every installation's landing
 * page carries the branch banner the site renders for it -- ".../Branch of
 * Service Images/MI_Branch_of_Service_AirForce.jpg" -- so the answer comes
 * from the source rather than from the shape of a name. Guessing by name is
 * what it used to do, and it quietly missed Osan, Hurlburt, the four RAF
 * bases, the Air Force Academy and every Air National Guard wing, all of which
 * are Air Force and none of which have "AFB" in their slug.
 */
const AIR_FORCE_BANNER = /MI_Branch_of_Service_AirForce\.jpg/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(CACHE, { recursive: true });

/**
 * Landing pages, cached on disk.
 *
 * Deciding which of four hundred installations are Air Force means reading
 * four hundred landing pages, and the same pages are then read again for their
 * names. Caching them makes `--list` cost nothing on the second run and makes
 * an interrupted import cheap to resume. Only successes are cached, so a
 * resumed run retries what failed.
 */
async function getCached(url) {
  const file = join(CACHE, `${url.replace(/[^a-z0-9]+/gi, '-').slice(-120)}.html`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const html = await get(url);
  writeFileSync(file, html);
  await sleep(DELAY);
  return html;
}

async function get(url) {
  const response = await fetch(url, {
    headers: {
      // Identify the client honestly rather than pretending to be a browser.
      'user-agent': 'ops-check-good-importer/1.0 (+https://github.com/ops-check-good)',
      accept: 'text/html,application/xhtml+xml,application/xml',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ');

function decode(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

const clean = (text) => decode(stripTags(text)).replace(/\s+/g, ' ').trim();

/**
 * Pulls the contact cards out of one program page.
 *
 * The site renders these server-side into a stable structure, so this is
 * parsing rather than guessing -- but it is still someone else's markup. If a
 * card yields no phone, no DSN and no website it is dropped rather than written
 * as an empty contact, because an empty contact is indistinguishable from a
 * missing one and the toolkit treats the two differently.
 */
function parseCards(html) {
  const cards = [];
  const blocks = html.split('<li class="t-Cards-item">').slice(1);

  for (const block of blocks) {
    const body = block.split('</li>')[0] ?? '';

    const name = /class="card-subtitle-text card-bold topic-title">([^<]+)</.exec(body)?.[1];
    if (!name) continue;

    const address = /<div class="card-item card-text arvo\s*">([\s\S]*?)<\/div>/.exec(body)?.[1];

    // Each telephone block labels itself COMM or DSN in its print-only span.
    let phone = '';
    let dsn = '';
    for (const tel of body.split('<div class="telephone">').slice(1)) {
      const chunk = tel.split('</div></div>')[0] ?? tel;
      const label = /class="visible-print-inline">([^<]*)</.exec(chunk)?.[1] ?? '';
      const fromLink = /<a href="tel:([^"]+)"/.exec(chunk)?.[1];
      const fromText = /(\+?[0-9][0-9\-(). ]{6,}[0-9])/.exec(clean(chunk.replace(/<!--[\s\S]*?-->/g, '')))?.[1];
      const number = (fromLink ?? fromText ?? '').trim();
      if (!number) continue;
      if (/DSN/i.test(label)) dsn ||= number;
      else phone ||= number;
    }

    const url = /<a data-type="website"[^>]*href="([^"]+)"/.exec(body)?.[1] ?? '';

    // Anything after the structured fields is the site's own free text: hours,
    // appointment rules, eligibility. Kept verbatim, never summarised.
    const notes = [...body.matchAll(/<div class="card-item arvo">([\s\S]*?)<\/div>/g)]
      .map((m) => clean(m[1]))
      .filter((t) => t.length > 0)
      .join(' ');

    if (!phone && !dsn && !url) continue;

    cards.push({
      name: clean(name),
      phone,
      dsn,
      location: address ? clean(address) : '',
      hours: '',
      url,
      notes: notes.slice(0, 600),
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const categoriesFile = JSON.parse(readFileSync(join(dataDir, 'categories.json'), 'utf8'));
const categories = categoriesFile.data.categories;

async function installationSlugs() {
  const xml = await get(SITEMAP);
  const slugs = new Set();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const path = m[1].replace(ORIGIN, '');
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'military-installation' && parts[1]) slugs.add(parts[1]);
  }
  return [...slugs].sort();
}

/**
 * The installation's own name, from its landing page.
 *
 * Taken from <title>, which carries the installation ("Kadena AB | Military
 * INSTALLATIONS"). A program page's heading names the programme, not the base,
 * so reading it from there gets you "Health Care" as an installation name.
 * Falls back to title-casing the slug if the page cannot be read.
 */
async function landingFor(slug) {
  let html = '';
  try {
    html = await getCached(`${ORIGIN}/military-installation/${slug}`);
  } catch {
    /* Fall through to the slug. */
  }
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  const name = clean(title.split('|')[0] ?? '');
  const fallback = slug
    .split('-')
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
  return {
    label: name.length > 1 ? name : fallback,
    airForce: AIR_FORCE_BANNER.test(html),
  };
}

async function importInstallation(slug) {
  const contacts = [];
  let anyPage = false;
  const { label } = await landingFor(slug);

  for (const category of categories) {
    for (const page of category.mosPages ?? []) {
      const url = `${ORIGIN}/military-installation/${slug}/${page}`;
      let html;
      try {
        html = await get(url);
      } catch {
        await sleep(DELAY);
        continue;
      }
      anyPage = true;

      const card = parseCards(html)[0];
      if (card) {
        contacts.push({
          categoryId: category.id,
          name: card.name,
          phone: card.phone,
          dsn: card.dsn,
          location: card.location,
          hours: card.hours,
          // Point at the page the details were read from, not the site root.
          url: url,
          notes: card.notes,
        });
      }
      await sleep(DELAY);
    }
  }

  if (!anyPage || contacts.length === 0) return null;

  // Categories with no contact still appear, empty, so the UI can say "not
  // populated here" rather than silently omitting an agency that exists.
  const covered = new Set(contacts.map((c) => c.categoryId));
  for (const category of categories) {
    if (!covered.has(category.id)) {
      contacts.push({
        categoryId: category.id,
        name: '', phone: '', dsn: '', location: '', hours: '', url: '', notes: '',
      });
    }
  }
  contacts.sort(
    (a, b) =>
      categories.findIndex((c) => c.id === a.categoryId) -
      categories.findIndex((c) => c.id === b.categoryId),
  );

  return {
    meta: {
      source: `MilitaryINSTALLATIONS — ${label}`,
      version: `1 (retrieved ${new Date().toISOString().slice(0, 10)})`,
      verifiedDate: new Date().toISOString().slice(0, 10),
      sourceUrl: `${ORIGIN}/military-installation/${slug}`,
      status: 'verified',
      notes:
        'Imported by scripts/import-installations.mjs from the official ' +
        'MilitaryINSTALLATIONS pages for this installation. Every contact carries ' +
        'the URL of the page it was read from. Nothing here was typed in or ' +
        'generated. Re-run the importer to refresh; the diff is the change. ' +
        'Agencies Military OneSource does not publish per installation — command ' +
        'post, mental health, chaplain, SARC, security forces, finance, MPF, EO — ' +
        'are present but empty, and the toolkit falls back to Military OneSource ' +
        'for those.',
    },
    data: { id: slug, label, example: false, contacts },
  };
}

/** Static imports, so both Vite and the esbuild offline build can see them. */
function writeIndex(slugs) {
  const lines = [
    '/**',
    ' * Installation directories, generated.',
    ' *',
    ' * GENERATED by scripts/import-installations.mjs -- do not edit by hand.',
    ' * Static imports on purpose: the offline single-file build runs through',
    ' * esbuild, which cannot see a Vite glob.',
    ' */',
    "import type { DataFileRef } from '../../../lib/data/installationIndex';",
    '',
    ...slugs.map((s, i) => `import i${i} from './${s}.json';`),
    '',
    'export const INSTALLATION_FILES: DataFileRef[] = [',
    ...slugs.map((s, i) => `  ['src/data/firstsergeant/installations/${s}.json', i${i}],`),
    '];',
    '',
  ];
  writeFileSync(join(outDir, 'index.ts'), lines.join('\n'));
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  let slugs = named;
  if (slugs.length === 0) {
    const all = await installationSlugs();
    if (flag('all')) {
      slugs = all;
    } else {
      // One landing page each, cached, so this is paid once and then free.
      slugs = [];
      for (const [index, slug] of all.entries()) {
        process.stderr.write(`\rchecking branch ${index + 1}/${all.length}`);
        const { airForce } = await landingFor(slug);
        if (airForce) slugs.push(slug);
      }
      process.stderr.write('\n');
    }
  }
  if (LIMIT > 0) slugs = slugs.slice(0, LIMIT);

  if (flag('list')) {
    console.log(slugs.join('\n'));
    console.log(`\n${slugs.length} installation(s)`);
    return;
  }

  const written = [];
  for (const [index, slug] of slugs.entries()) {
    process.stdout.write(`[${index + 1}/${slugs.length}] ${slug} … `);
    try {
      const file = await importInstallation(slug);
      if (!file) {
        console.log('no contacts, skipped');
        continue;
      }
      writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(file, null, 2) + '\n');
      const populated = file.data.contacts.filter((c) => c.phone || c.dsn || c.url).length;
      written.push(slug);
      console.log(`${populated} agencies`);
    } catch (error) {
      console.log(`failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // The index lists every installation on disk, not just this run's, so
  // importing one base does not drop the rest.
  const onDisk = readdirSync(outDir)
    .filter((f) => f.endsWith('.json') && f !== 'example.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  writeIndex(onDisk);
  console.log(
    `\nWrote ${written.length} installation file(s); index now lists ${onDisk.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
