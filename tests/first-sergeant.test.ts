import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  INSTALLATIONS,
  NATIONAL,
  REFERENCES,
  SITUATIONS,
  categoriesByUrgency,
  contactFor,
  getCategory,
  isContactPopulated,
  isReferencePopulated,
  nationalFallbacks,
  realInstallations,
} from '@/lib/data/firstSergeant';
import { search, tokenize } from '@/lib/firstsergeant/search';
import {
  EMPTY_STATE,
  emptyContact,
  isUsable,
  parseState,
  serializeState,
} from '@/lib/firstsergeant/unitContacts';

/**
 * The toolkit's whole value is that a number is right, so these tests are
 * mostly about what it is NOT allowed to do: invent a contact, route to an
 * agency that does not exist, or let a file claim to be verified while the
 * agencies a Shirt needs at 0200 are still blank.
 */

const categoryLabel = (id: string) => getCategory(id)?.label ?? id;

describe('categories', () => {
  it('loads, with unique ids', () => {
    expect(CATEGORIES.data.length).toBeGreaterThan(5);
    const ids = CATEGORIES.data.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks the out-of-hours agencies as crisis and sorts them first', () => {
    const crisis = CATEGORIES.data.filter((c) => c.urgency === 'crisis').map((c) => c.id);
    expect(crisis).toContain('mental-health');
    expect(crisis).toContain('chaplain');
    expect(crisis).toContain('command-post');
    // Military OneSource is the fallback that always answers, so it belongs
    // with the agencies you reach for first, not in the general list.
    expect(crisis).toContain('military-onesource');

    const ordered = categoriesByUrgency();
    const lastCrisis = ordered.findLastIndex((c) => c.urgency === 'crisis');
    const firstStandard = ordered.findIndex((c) => c.urgency === 'standard');
    expect(lastCrisis).toBeLessThan(firstStandard);
  });
});

describe('situations', () => {
  it('loads, with unique ids', () => {
    const ids = SITUATIONS.data.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A routing card that points at an agency the toolkit does not know about
  // sends a Shirt nowhere. The loader rejects it; this proves it stays that way.
  it('routes only to agencies that exist, and never to the same one twice', () => {
    const known = new Set(CATEGORIES.data.map((c) => c.id));
    for (const situation of SITUATIONS.data) {
      expect(known.has(situation.startHere), `${situation.id} startHere`).toBe(true);
      for (const id of situation.alsoSee) {
        expect(known.has(id), `${situation.id} alsoSee ${id}`).toBe(true);
        expect(id).not.toBe(situation.startHere);
      }
      expect(new Set(situation.alsoSee).size).toBe(situation.alsoSee.length);
    }
  });

  /**
   * The cards prompt, they do not conclude. A "question" phrased as a statement
   * is the toolkit quietly starting to give advice, which is the one thing it
   * is not for.
   */
  it('asks questions rather than stating conclusions', () => {
    for (const situation of SITUATIONS.data) {
      expect(situation.questions.length, `${situation.id} has no questions`).toBeGreaterThan(0);
      for (const question of situation.questions) {
        expect(question.endsWith('?'), `${situation.id}: "${question}"`).toBe(true);
      }
    }
  });

  it('gives every situation search terms beyond its own wording', () => {
    for (const situation of SITUATIONS.data) {
      expect(situation.keywords.length, situation.id).toBeGreaterThan(0);
    }
  });

  it('covers the crisis case, and starts it at a crisis agency', () => {
    const crisis = SITUATIONS.data.find((s) => s.id === 'crisis');
    expect(crisis).toBeDefined();
    expect(getCategory(crisis!.startHere)!.urgency).toBe('crisis');
  });
});

describe('references', () => {
  it('loads, with unique ids', () => {
    const ids = REFERENCES.data.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Publication numbers and paragraph references are exactly the kind of value
  // that comes out plausible and wrong, so they ship empty on purpose.
  it('is honest about which topics point anywhere yet', () => {
    for (const entry of REFERENCES.data) {
      if (REFERENCES.meta.status === 'stub' && !isReferencePopulated(entry)) {
        expect(entry.publication).toBe('');
      }
      if (isReferencePopulated(entry)) {
        expect(entry.publication.trim().length).toBeGreaterThan(2);
      }
    }
  });
});

describe('contacts', () => {
  it('ships Military OneSource as a real, worldwide fallback', () => {
    const fallbacks = nationalFallbacks();
    expect(fallbacks.length).toBeGreaterThan(0);
    const oneSource = fallbacks.find((c) => c.categoryId === 'military-onesource');
    expect(oneSource).toBeDefined();
    expect(oneSource!.phone).not.toBe('');
    expect(oneSource!.url).toContain('militaryonesource.mil');
    // It is the one value the toolkit leans on when nothing else is populated,
    // so it has to come from a cited source rather than a stub.
    expect(NATIONAL.meta.status).toBe('verified');
    expect(NATIONAL.meta.sourceUrl).toContain('militaryonesource.mil');
  });

  it('falls back to the worldwide resource when the installation has nothing', () => {
    const example = INSTALLATIONS.find((i) => i.data.example)!.data;
    const found = contactFor(example, 'military-onesource');
    expect(found).not.toBeNull();
    expect(found!.scope).toBe('national');

    // And an agency with no local entry and no national one returns null rather
    // than an empty card that looks like a real number is missing.
    expect(contactFor(example, 'finance')).toBeNull();
    expect(contactFor(null, 'finance')).toBeNull();
  });

  it('counts a contact as usable only when there is something to dial or open', () => {
    expect(isContactPopulated({ categoryId: 'x', name: 'Legal', phone: '', dsn: '', location: 'Bldg 1', hours: '', url: '', notes: '' })).toBe(false);
    expect(isContactPopulated({ categoryId: 'x', name: '', phone: '555-0100', dsn: '', location: '', hours: '', url: '', notes: '' })).toBe(true);
    expect(isContactPopulated({ categoryId: 'x', name: '', phone: '', dsn: '', location: '', hours: '', url: 'https://example.mil', notes: '' })).toBe(true);
  });
});

describe('installations', () => {
  it('ships a template that can never pose as a real base', () => {
    const example = INSTALLATIONS.find((i) => i.data.example);
    expect(example).toBeDefined();
    expect(example!.data.label.toLowerCase()).toContain('not a real installation');
    expect(example!.isStub).toBe(true);
    expect(realInstallations().map((i) => i.data.id)).not.toContain(example!.data.id);
  });

  it('never invents a contact in a stub', () => {
    for (const installation of INSTALLATIONS) {
      if (installation.meta.status !== 'stub') continue;
      for (const contact of installation.data.contacts) {
        expect(isContactPopulated(contact), `${installation.data.id}/${contact.categoryId}`).toBe(false);
      }
    }
  });

  /**
   * The invariant that matters most, scoped to what is actually knowable.
   *
   * Military OneSource publishes a page type, not a guaranteed contact: it has
   * no command post, chaplain, mental health, SARC or security forces page at
   * all, and even a page it does have can carry no card (Barksdale has no
   * medical contact). So a verified directory cannot be held to a fixed list of
   * agencies. What it CAN be held to: it says something, and a Shirt opening it
   * at 0200 always has somebody to call.
   */
  it('requires a verified installation to be worth having', () => {
    for (const installation of INSTALLATIONS) {
      if (installation.meta.status !== 'verified') continue;
      const id = installation.data.id;

      expect(installation.data.example, `${id} is verified AND an example`).toBe(false);
      expect(installation.meta.sourceUrl, `${id} has no source`).not.toBe('');

      const populated = installation.data.contacts.filter(isContactPopulated);
      expect(populated.length, `${id} is verified with nothing in it`).toBeGreaterThan(0);

      // Every contact has to say where it came from, or it is untraceable.
      // Two sources now feed these files -- MilitaryINSTALLATIONS for the
      // programme pages, the installation's own site for the agencies Military
      // OneSource does not publish -- so what is required is a citation on an
      // official host, not one particular host.
      for (const contact of populated) {
        expect(contact.url, `${id}/${contact.categoryId} has no source URL`).not.toBe('');
        expect(
          new URL(contact.url).hostname.endsWith('.mil'),
          `${id}/${contact.categoryId} cites ${contact.url}`,
        ).toBe(true);
      }

      const crisis = CATEGORIES.data.filter((c) => c.urgency === 'crisis');
      const reachable = crisis.some((category) => contactFor(installation.data, category.id) !== null);
      expect(reachable, `${id} has no reachable crisis contact`).toBe(true);
    }
  });

  /**
   * A coverage floor, so a broken parser fails loudly.
   *
   * The importer reads someone else's markup. If that markup changes shape the
   * parse degrades quietly to zero contacts and every base falls back to the
   * worldwide number -- which still "works", which is exactly why it would go
   * unnoticed. The floors sit well under what the source currently yields.
   */
  it('keeps real coverage across the imported directories', () => {
    const imported = INSTALLATIONS.filter((i) => !i.data.example);
    if (imported.length === 0) return;

    const total = imported.reduce(
      (sum, i) => sum + i.data.contacts.filter(isContactPopulated).length,
      0,
    );
    expect(total / imported.length, 'contacts per installation collapsed').toBeGreaterThan(4);

    const withMedical = imported.filter((i) =>
      i.data.contacts.some((c) => c.categoryId === 'medical' && isContactPopulated(c)),
    ).length;
    expect(withMedical / imported.length, 'medical coverage collapsed').toBeGreaterThan(0.8);
  });

  // The agencies the source cannot give us are named here rather than left as
  // a surprise: they are why the worldwide fallback is load-bearing.
  //
  // crisis-line and military-onesource are excluded: they are worldwide lines
  // with one number each, so they are not per-installation gaps at all -- there
  // is nothing for MilitaryINSTALLATIONS to have published.
  const WORLDWIDE = new Set(['crisis-line', 'military-onesource']);

  it('records which crisis agencies Military OneSource does not publish', () => {
    const unpublished = CATEGORIES.data
      .filter((c) => c.urgency === 'crisis' && c.mosPages.length === 0)
      .map((c) => c.id)
      .filter((id) => !WORLDWIDE.has(id))
      .sort();
    expect(unpublished).toEqual([
      'chaplain',
      'command-post',
      'mental-health',
      'sarc',
      'security-forces',
    ]);
  });

  it('carries the crisis line as a worldwide resource with its overseas routings', () => {
    const crisis = NATIONAL.data.find((c) => c.categoryId === 'crisis-line');
    expect(crisis, 'the crisis line must ship').toBeDefined();
    expect(crisis!.phone).toBe('988');
    expect(crisis!.phoneNote).toContain('press 1');
    expect(crisis!.url).toContain('veteranscrisisline.net');
    // Osan, Kadena, Yokota, Aviano and the RAF bases are in this directory, and
    // 988 does not dial from any of them.
    const commands = (crisis!.overseas ?? []).map((o) => o.command).sort();
    expect(commands).toEqual(['AFRICOM', 'CENTCOM', 'EUCOM', 'NORTHCOM', 'PACOM', 'SOUTHCOM']);
    for (const o of crisis!.overseas ?? []) expect(o.phone).not.toBe('');
  });
});

describe('search', () => {
  it('folds apostrophes so "cant" finds "cannot"', () => {
    expect(tokenize("can’t pay")).toEqual(['cant', 'pay']);
    expect(tokenize('  PCS/move  ')).toEqual(['pcs', 'move']);
    expect(tokenize('')).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(search('   ', SITUATIONS.data, CATEGORIES.data, categoryLabel)).toEqual([]);
  });

  it('puts the situation above the agency for a plain-English query', () => {
    const results = search('money', SITUATIONS.data, CATEGORIES.data, categoryLabel);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.kind).toBe('situation');
  });

  it('finds a situation by a keyword that is not in its label', () => {
    const results = search('landlord', SITUATIONS.data, CATEGORIES.data, categoryLabel);
    expect(results.some((r) => r.id === 'landlord')).toBe(true);

    const lease = search('lease', SITUATIONS.data, CATEGORIES.data, categoryLabel);
    expect(lease.some((r) => r.id === 'landlord')).toBe(true);
  });

  it('finds an agency by name', () => {
    const results = search('chaplain', SITUATIONS.data, CATEGORIES.data, categoryLabel);
    expect(results.some((r) => r.kind === 'category' && r.id === 'chaplain')).toBe(true);
  });

  it('is deterministic and independent of file order', () => {
    const once = search('pay', SITUATIONS.data, CATEGORIES.data, categoryLabel);
    const twice = search('pay', [...SITUATIONS.data].reverse(), [...CATEGORIES.data].reverse(), categoryLabel);
    expect(twice.map((r) => r.id)).toEqual(once.map((r) => r.id));
  });
});

describe('unit contacts store', () => {
  it('round-trips', () => {
    const state = {
      installationId: 'example',
      unitContacts: [{ role: 'Commander', name: 'Lt Col Smith', phone: '555-0101' }],
    };
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it('drops blank rows rather than persisting them', () => {
    const serialized = serializeState({
      installationId: '',
      unitContacts: [emptyContact('Commander'), emptyContact()],
    });
    expect(parseState(serialized).unitContacts).toEqual([
      { role: 'Commander', name: '', phone: '' },
    ]);
    expect(isUsable(emptyContact())).toBe(false);
  });

  // This page gets opened in a hurry. Bad stored state must degrade to an empty
  // toolkit, never to a crash.
  it('survives missing, malformed, and foreign stored state', () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState('not json')).toEqual(EMPTY_STATE);
    expect(parseState('{"installationId":42,"unitContacts":"nope"}')).toEqual(EMPTY_STATE);
    expect(parseState('{"unitContacts":[{"role":null},7]}')).toEqual(EMPTY_STATE);
  });
});
