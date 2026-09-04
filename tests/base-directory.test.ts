import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  chooseContacts,
  directoryLinks,
  matchCategory,
  normalizeLabel,
  pageIdentity,
  pageTitle,
  parseDirectory,
  parseDirectoryLine,
  samePhone,
  siteMatchesInstallation,
  textLines,
  type CategoryRule,
} from '../scripts/lib/baseDirectory.js';
import categoriesFile from '@/data/firstsergeant/categories.json';
import baseSitesFile from '@/data/firstsergeant/base-sites.json';
import nationalFile from '@/data/firstsergeant/national.json';

/**
 * The second source.
 *
 * MilitaryINSTALLATIONS does not publish a command post, chaplain, SARC,
 * mental health, security forces, finance, MPF or EO number for any
 * installation, so those come off each base's own website instead. That is
 * seventy differently-built pages read by one parser, which is exactly the
 * kind of thing that degrades quietly: a changed layout yields no matches, the
 * data stays as it was, and nobody notices.
 *
 * So these tests pin the parser to a fixture rather than to the live web, and
 * pin the mapping to the data file rather than to the script. What they are
 * really protecting is the invariant in constraint 5 -- a number is read off a
 * page or it is absent, and it is never anything in between.
 */

const fixture = readFileSync(join(__dirname, 'fixtures', 'base-directory.html'), 'utf8');

const rules: CategoryRule[] = categoriesFile.data.categories.map((c) => ({
  id: c.id,
  labels: c.siteLabels,
  exclude: c.siteExcludeLabels,
}));

const entry = (label: string) => parseDirectory(fixture).find((e) => e.label === label);

describe('reading a base directory page', () => {
  it('reads the label and the number a human sees on the page', () => {
    expect(entry('Command Post')).toEqual({
      label: 'Command Post',
      phone: '505-555-5700',
      dsn: '',
    });
  });

  /**
   * These pages are hand-edited in a CMS, and a number routinely ends up split
   * across two colour spans. Rendered it reads as one number, so it has to
   * parse as one number.
   */
  it('rejoins a number broken across inline markup', () => {
    expect(entry('Finance (Military/Travel Pay)')?.phone).toBe('505-555-2218');
  });

  it('records a DSN as a DSN rather than as a second phone number', () => {
    expect(entry('Military Personnel Flight')).toEqual({
      label: 'Military Personnel Flight',
      phone: '505-555-3187',
      dsn: '555-3187',
    });
  });

  // A stylesheet width and a script literal are not phone numbers, and a
  // sentence that happens to contain a building number is not a directory
  // entry. Anything that gets past this becomes a wrong number in a tool
  // people dial from.
  it('reads nothing out of scripts, styles, or prose', () => {
    const labels = parseDirectory(fixture).map((e) => e.label);
    expect(labels.some((l) => l.includes('phone ='))).toBe(false);
    expect(labels.some((l) => l.includes('card'))).toBe(false);
    expect(labels.some((l) => l.includes('exchange moved'))).toBe(false);
    expect(textLines(fixture).some((l) => l.includes('867-5309'))).toBe(false);
    expect(parseDirectory(fixture).every((e) => e.phone !== '867-530-9000')).toBe(true);
  });

  it('reads a label written after the number, in brackets', () => {
    expect(parseDirectoryLine('(505) 555-2941 (Medical Group Appointment Line)')).toEqual({
      label: 'Medical Group Appointment Line',
      phone: '505-555-2941',
      dsn: '',
    });
  });

  it('takes the first number when a line lists two', () => {
    expect(entry('Equal Opportunity Office (Military and Civilian)')?.phone).toBe('505-555-2077');
  });

  it('drops a line with no label and a label with no number', () => {
    expect(parseDirectoryLine('(505) 555-1234')).toBeNull();
    expect(parseDirectoryLine('Command Post')).toBeNull();
  });

  /**
   * The failure that matters most, and the subtlest.
   *
   * A page's prose mentions the same agencies its directory lists, so reading
   * sentences yields entries that look right and are not: the number in "for
   * emergencies, contact the Command Post at ..." might be the after-hours
   * line rather than the command post, and "contact DFAS at (800) 321-1080" is
   * not the base comptroller at all. A label is a name, not a sentence.
   */
  it('reads directory entries, not sentences that happen to contain a number', () => {
    expect(
      parseDirectoryLine('For emergencies after duty hours, contact the Command Post at (505) 555-5701.'),
    ).toBeNull();
    expect(parseDirectoryLine('Legal Assistance appointments, call: (505) 555-3251')).toBeNull();
    expect(parseDirectory(fixture).some((e) => e.label.includes('emergencies'))).toBe(false);
  });

  // Short prose passes a word count and still is not a label.
  it('rejects a short sentence that addresses the reader', () => {
    expect(parseDirectoryLine('For questions, please call the Chapel 501-555-6014')).toBeNull();
    expect(parseDirectoryLine('Call the desk and pass this on (505) 555-2200')).toBeNull();
    expect(parseDirectoryLine('After Hours: Command Post 757 555-5411')).toEqual({
      label: 'After Hours: Command Post',
      phone: '757-555-5411',
      dsn: '',
    });
  });

  /**
   * Osan publishes its command post as "Comm 0505-784-7000". Ten digits read
   * out of the middle of that is a number that dials nowhere -- a wrong number
   * that looks entirely plausible, which is the exact failure this project
   * cannot have.
   */
  it('never reads a number out of the middle of a longer one', () => {
    expect(parseDirectoryLine('Command Post: Comm 0505-555-7000')).toBeNull();
    expect(parseDirectory(fixture).every((e) => e.phone !== '505-555-7000')).toBe(true);
  });

  /**
   * An installation's chapel is not on an 800 number. A toll-free number on a
   * base page belongs to something national -- DFAS, TRICARE, the Safe
   * Helpline -- and filing it under a local agency sends a Shirt to a call
   * centre that has never heard of their base.
   */
  it('never files a toll-free number as a local agency', () => {
    expect(parseDirectoryLine('TRICARE Nurse Advice Line: (800) 874-2273')).toBeNull();
    expect(parseDirectory(fixture).every((e) => !e.phone.startsWith('800-'))).toBe(true);
    expect(parseDirectory(fixture).some((e) => e.label.includes('DFAS'))).toBe(false);
  });

  it('is deterministic', () => {
    expect(parseDirectory(fixture)).toEqual(parseDirectory(fixture));
  });
});

describe('mapping a label to an agency', () => {
  it('maps the labels a base site actually uses', () => {
    expect(matchCategory('Command Post', rules)).toBe('command-post');
    expect(matchCategory('9th Security Forces Squadron', rules)).toBe('security-forces');
    expect(matchCategory('Sexual Assault Response Coordinator (SAPR) Hotline', rules)).toBe('sarc');
    expect(matchCategory('Airman & Family Readiness Center', rules)).toBe('mfrc');
    expect(matchCategory('Military and Family Readiness Center', rules)).toBe('mfrc');
    expect(matchCategory('Equal Opportunity Office (Military and Civilian)', rules)).toBe(
      'equal-opportunity',
    );
  });

  /**
   * The conservative half of the brief. A label two agencies both claim is not
   * guessed at, and a label that merely contains an agency's name is not that
   * agency: the visitor centre is not the law enforcement desk, and civilian
   * personnel is not the MPF.
   */
  it('drops a label two agencies both claim', () => {
    expect(matchCategory('Family Advocacy/Mental Health', rules)).toBeNull();
  });

  it('drops a label that is not the agency it sounds like', () => {
    expect(matchCategory('Security Forces Visitor Center', rules)).toBeNull();
    expect(matchCategory('Civilian Personnel Office', rules)).toBeNull();
    expect(matchCategory('Dental Clinic', rules)).toBeNull();
    expect(matchCategory('Command Post Fax', rules)).toBeNull();
  });

  it('drops a label it does not recognise rather than guessing', () => {
    expect(matchCategory('Base Operator', rules)).toBeNull();
    expect(matchCategory('Auto Hobby Center', rules)).toBeNull();
    expect(matchCategory('', rules)).toBeNull();
  });

  it('folds case, ampersands, slashes and punctuation before matching', () => {
    expect(normalizeLabel('Airman & Family Readiness Center')).toBe(
      'airman and family readiness center',
    );
    expect(normalizeLabel('Hospital/Medical Treatment Facility')).toBe(
      'hospital medical treatment facility',
    );
  });
});

describe('choosing one contact per agency', () => {
  const pages = [{ url: 'https://www.example.af.mil/Contact-Us/Directory/', entries: parseDirectory(fixture) }];

  it('prefers the label that exactly names the agency', () => {
    // "Chapel" and "Chapels Foothills Chapel" are both on the page; the plain
    // one is the office, the other is one building.
    expect(chooseContacts(pages, rules).get('chaplain')?.label).toBe('Chapel');
  });

  it('attaches the URL of the page the number was read from', () => {
    for (const contact of chooseContacts(pages, rules).values()) {
      expect(contact.url).toBe('https://www.example.af.mil/Contact-Us/Directory/');
      expect(contact.phone || contact.dsn).not.toBe('');
    }
  });

  it('does not depend on the order the pages were read in', () => {
    const split = [
      { url: 'https://www.example.af.mil/b/', entries: parseDirectory(fixture).slice(4) },
      { url: 'https://www.example.af.mil/a/', entries: parseDirectory(fixture).slice(0, 4) },
    ];
    const forward = chooseContacts(split, rules);
    const backward = chooseContacts([...split].reverse(), rules);
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('leaves an agency the page never named alone', () => {
    expect(chooseContacts(pages, rules).has('mental-health')).toBe(false);
    expect(chooseContacts(pages, rules).has('housing')).toBe(false);
  });
});

describe('finding the pages worth reading', () => {
  const links = directoryLinks(fixture, 'https://www.example.af.mil/', baseSitesFile.data.pageHints);

  /**
   * Order is the point, not just membership. A base with forty "Contact" links
   * in its navigation would spend the whole page budget before reaching the
   * one page that lists the agencies, so the directory has to come first --
   * and which wording outranks which is the order of `pageHints` in the data.
   */
  it('follows links whose wording says they lead to a directory, best first', () => {
    expect(links).toEqual([
      'https://www.example.af.mil/Contact-Us/Directory/',
      'https://www.example.af.mil/Contact-Us/',
    ]);
  });

  // A news article is one day's snapshot, a PDF is not text this parser reads
  // honestly, and another base's site is another base's numbers.
  it('never leaves the installation, and never follows news, documents, or http', () => {
    expect(links.some((l) => l.includes('example-other'))).toBe(false);
    expect(links.some((l) => l.endsWith('.pdf'))).toBe(false);
    expect(links.some((l) => l.includes('/News/'))).toBe(false);
    expect(links.some((l) => l.startsWith('http://'))).toBe(false);
  });

  it('does not read "Defense Logistics Agency" as a list of agencies', () => {
    expect(links.some((l) => l.includes('Defense-Logistics-Agency'))).toBe(false);
  });
});

describe('confirming a site belongs to an installation', () => {
  it('reads the page title', () => {
    expect(pageTitle(fixture)).toBe('Example Air Force Base > Contact Us');
  });

  it('accepts a site whose own page names the installation', () => {
    expect(siteMatchesInstallation('Minot Air Force Base', 'Minot AFB')).toBe(true);
    expect(siteMatchesInstallation('Davis-Monthan Air Force Base > Home', 'Davis-Monthan AFB')).toBe(
      true,
    );
  });

  /**
   * A third of these sites ship the same CMS skin with the title "Home" and
   * name the installation only in the meta description. Reading the title
   * alone rejected them -- safe, but wrong.
   */
  it('reads the description and keywords when the title is just "Home"', () => {
    const page =
      '<html><head><title>Home</title>' +
      '<meta name="description" content="The official website for Dyess Air Force Base.">' +
      '<meta name="keywords" content="Dyess AFB, 7th Bomb Wing"></head><body></body></html>';
    expect(pageTitle(page)).toBe('Home');
    expect(siteMatchesInstallation(pageTitle(page), 'Dyess AFB')).toBe(false);
    expect(siteMatchesInstallation(pageIdentity(page), 'Dyess AFB')).toBe(true);
  });

  it('does not let one site’s metadata vouch for another installation', () => {
    const page =
      '<html><head><title>Home</title>' +
      '<meta name="description" content="The official website for Dyess Air Force Base."></head></html>';
    expect(siteMatchesInstallation(pageIdentity(page), 'Cannon AFB')).toBe(false);
  });

  /**
   * The guard that makes guessing a hostname safe. Guessing is fine; keeping a
   * guess that the page then contradicts is how one base's numbers end up
   * filed under another base's name.
   */
  it('refuses a site that names a different installation', () => {
    expect(siteMatchesInstallation('Minot Air Force Base', 'Beale AFB')).toBe(false);
    expect(siteMatchesInstallation('Air Force Base', 'Beale AFB')).toBe(false);
    expect(siteMatchesInstallation('', 'Beale AFB')).toBe(false);
  });
});

describe('phone comparison', () => {
  it('sees through formatting, and never calls two blanks equal', () => {
    expect(samePhone('(530) 634-2941', '530-634-2941')).toBe(true);
    expect(samePhone('1-530-634-2941', '530-634-2941')).toBe(true);
    expect(samePhone('530-634-2941', '530-634-2942')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The data the importer reads, and the data it wrote
// ---------------------------------------------------------------------------

describe('the label rules live in data', () => {
  it('gives every agency a rule list, even an empty one', () => {
    for (const category of categoriesFile.data.categories) {
      expect(Array.isArray(category.siteLabels), category.id).toBe(true);
      expect(Array.isArray(category.siteExcludeLabels), category.id).toBe(true);
    }
  });

  /**
   * Every synonym an agency claims has to resolve back to that agency. A
   * phrase two agencies both list is not a typo, it is a rule that can never
   * fire -- the matcher drops anything ambiguous -- and it would sit there
   * looking like coverage.
   */
  it('has no synonym that another agency also claims', () => {
    for (const category of categoriesFile.data.categories) {
      for (const label of category.siteLabels) {
        expect(matchCategory(label, rules), `${category.id}: "${label}"`).toBe(category.id);
      }
    }
  });

  // One worldwide number, already verified in national.json. Reading it off a
  // base page instead would be seventy chances to read it wrong.
  it('never reads Military OneSource off a base page', () => {
    const oneSource = categoriesFile.data.categories.find((c) => c.id === 'military-onesource');
    expect(oneSource?.siteLabels).toEqual([]);
  });
});

describe('the installation sites that were resolved', () => {
  const installationDir = join(process.cwd(), 'src', 'data', 'firstsergeant', 'installations');
  const onDisk = new Set(
    readdirSync(installationDir)
      .filter((f) => f.endsWith('.json') && f !== 'example.json')
      .map((f) => f.replace(/\.json$/, '')),
  );

  it('names only installations the toolkit actually ships', () => {
    for (const site of baseSitesFile.data.sites) {
      expect(onDisk.has(site.id), site.id).toBe(true);
    }
  });

  it('records what it read off the page as the evidence for each site', () => {
    for (const site of baseSitesFile.data.sites) {
      expect(site.url.startsWith('https://'), site.id).toBe(true);
      expect(new URL(site.url).hostname.endsWith('.mil'), site.id).toBe(true);
      expect(site.evidence.trim().length, site.id).toBeGreaterThan(0);
      expect(
        siteMatchesInstallation(site.evidence, `${site.label} ${site.id.replace(/-/g, ' ')}`),
        site.id,
      ).toBe(true);
    }
  });

  it('claims one site per installation', () => {
    const ids = baseSitesFile.data.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what the importers wrote', () => {
  const installationDir = join(process.cwd(), 'src', 'data', 'firstsergeant', 'installations');
  const files = readdirSync(installationDir)
    .filter((f) => f.endsWith('.json') && f !== 'example.json')
    .map((f) => ({
      id: f.replace(/\.json$/, ''),
      doc: JSON.parse(readFileSync(join(installationDir, f), 'utf8')) as {
        meta: { source: string; notes?: string };
        data: { contacts: Array<Record<string, string>> };
      },
    }));

  /**
   * The rule the whole exercise rests on. A number with no page behind it is
   * a number somebody typed in, and this project would rather ship nothing.
   */
  it('gives every number a page it was read from', () => {
    for (const { id, doc } of files) {
      for (const contact of doc.data.contacts) {
        if (!contact.phone && !contact.dsn) continue;
        expect(contact.url, `${id}/${contact.categoryId}`).not.toBe('');
        expect(new URL(contact.url).protocol, `${id}/${contact.categoryId}`).toBe('https:');
        expect(
          new URL(contact.url).hostname.endsWith('.mil'),
          `${id}/${contact.categoryId} -> ${contact.url}`,
        ).toBe(true);
      }
    }
  });

  it('names the base site in the meta of every file that read one', () => {
    const sites = new Map(baseSitesFile.data.sites.map((s) => [s.id, s]));
    for (const { id, doc } of files) {
      const fromSite = doc.data.contacts.filter(
        (c) => c.url !== '' && !c.url.includes('militaryonesource.mil'),
      );
      if (fromSite.length === 0) continue;
      const host = new URL(sites.get(id)!.url).hostname;
      for (const contact of fromSite) {
        expect(new URL(contact.url).hostname, `${id}/${contact.categoryId}`).toBe(host);
      }
      expect(doc.meta.notes ?? '', id).toContain('import-base-directories.mjs');
    }
  });

  // The worldwide number is copied, not transcribed, so a fat finger cannot
  // put a different Military OneSource number on one base out of seventy.
  it('uses the verified worldwide number for Military OneSource everywhere', () => {
    const national = nationalFile.data.resources.find((r) => r.categoryId === 'military-onesource')!;
    for (const { id, doc } of files) {
      const local = doc.data.contacts.find((c) => c.categoryId === 'military-onesource');
      if (!local || !local.phone) continue;
      expect(local.phone, id).toBe(national.phone);
      expect(local.url, id).toBe(national.url);
    }
  });

  it('leaves a contact wholly empty rather than half-filled', () => {
    for (const { id, doc } of files) {
      for (const contact of doc.data.contacts) {
        if (contact.phone || contact.dsn || contact.url) continue;
        expect(contact.name, `${id}/${contact.categoryId}`).toBe('');
        expect(contact.notes, `${id}/${contact.categoryId}`).toBe('');
      }
    }
  });
});
