import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMeta, isPlaceholderString, isPlaceholderNumber } from '@/lib/data/loader';
import { FORMS, isFieldPopulated, isFormUsable, usableForms } from '@/lib/data/forms';
import { STOPWORDS, VERBS } from '@/lib/data/vocab';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import { normalizeAbbreviations } from '@/lib/data/abbreviations';
import { embeddedFontPaths } from '@/lib/metrics/registry';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'src', 'data');
const fontsDir = join(root, 'public', 'fonts');

function walkJson(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walkJson(full));
    else if (entry.endsWith('.json')) found.push(full);
  }
  return found;
}

const dataFiles = walkJson(dataDir).sort();

describe('data files on disk', () => {
  it('finds every data file', () => {
    expect(dataFiles.length).toBeGreaterThan(0);
  });

  // Walking the directory rather than an import list means a new data file
  // nobody wired up still gets validated.
  it.each(dataFiles.map((f) => [relative(root, f), f]))(
    '%s has a complete, parseable meta block',
    (rel, full) => {
      const raw = JSON.parse(readFileSync(full, 'utf8'));
      const meta = readMeta(rel, raw);

      expect(meta.source).not.toBe('');
      expect(meta.version).not.toBe('');
      expect(Number.isNaN(Date.parse(meta.verifiedDate))).toBe(false);
      expect(meta.verifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['stub', 'verified']).toContain(meta.status);
      expect(raw).toHaveProperty('data');
    },
  );

  // The whole point of the two-state marking: a file may hold placeholders, or
  // it may claim to be verified, but never both.
  it.each(dataFiles.map((f) => [relative(root, f), f]))(
    '%s does not claim verified while holding placeholders',
    (rel, full) => {
      const raw = JSON.parse(readFileSync(full, 'utf8'));
      const meta = readMeta(rel, raw);
      if (meta.status !== 'verified') return;

      expect(isPlaceholderString(meta.sourceUrl), 'verified data needs a real sourceUrl').toBe(false);
      expect(isPlaceholderString(meta.version), 'verified data needs a real version').toBe(false);
      expect(JSON.stringify(raw.data)).not.toMatch(/"TBD"/i);
    },
  );
});

describe('form definitions', () => {
  it('loads every form without error', () => {
    expect(FORMS.length).toBe(4);
    expect(FORMS.map((f) => f.data.id).sort()).toEqual(['af1206', 'af910', 'af911', 'sandbox']);
  });

  it.each(FORMS.map((f) => [f.data.id, f]))(
    '%s declares a constraint matching a populated field, or is marked stub',
    (_id, form) => {
      for (const field of form.data.fields) {
        if (form.meta.status === 'verified') {
          expect(isFieldPopulated(field), `${field.id} is unpopulated`).toBe(true);
        }
        // Whatever the status, a populated field must populate the metric its
        // own constraint names -- a width-constrained field with only maxChars
        // set is a definition error, not a stub.
        if (field.constraint === 'width' && !isPlaceholderNumber(field.widthMm)) {
          expect(field.widthMm!).toBeGreaterThan(0);
        }
        if (field.constraint === 'chars' && !isPlaceholderNumber(field.maxChars)) {
          expect(field.maxChars!).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each(FORMS.map((f) => [f.data.id, f]))(
    '%s references a font file that exists and is embedded',
    (_id, form) => {
      const file = form.data.font.file;
      if (isPlaceholderString(file)) {
        // Unpopulated font is only acceptable on a stub.
        expect(form.meta.status).toBe('stub');
        return;
      }
      expect(file.startsWith('/fonts/')).toBe(true);
      expect(existsSync(join(fontsDir, file.replace('/fonts/', '')))).toBe(true);
      // Present on disk is not enough; measurement reads the embedded copy.
      expect(embeddedFontPaths()).toContain(file);
    },
  );

  // The AF forms carry widths taken from AF-VCD/pdf-bullets, whose own field
  // name is "likelyWidth". That is good enough to measure against and not good
  // enough to call verified, so they are usable AND still stub -- the banner
  // stays up until someone reads the real XFA stream.
  it('has the AF forms populated but still marked unverified', () => {
    for (const id of ['af1206', 'af910', 'af911']) {
      const form = FORMS.find((f) => f.data.id === id)!;
      expect(isFormUsable(form.data)).toBe(true);
      expect(form.isStub).toBe(true);
      expect(form.meta.status).toBe('stub');
      expect(form.meta.sourceUrl).toContain('AF-VCD/pdf-bullets');
      for (const field of form.data.fields) {
        expect(field.constraint).toBe('width');
        expect(field.widthMm).toBeCloseTo(202.321, 3);
      }
    }
  });

  it('defaults to the 1206, not the synthetic sandbox', () => {
    expect(usableForms()[0]!.data.id).toBe('af1206');
  });

  it('keeps the synthetic sandbox form marked stub so it can never pose as real', () => {
    const sandbox = FORMS.find((f) => f.data.id === 'sandbox')!;
    expect(sandbox.isStub).toBe(true);
    expect(isFormUsable(sandbox.data)).toBe(true);
    expect(sandbox.data.label.toLowerCase()).toContain('not a real form');
  });
});

describe('other datasets', () => {
  it('loads the abbreviation tables', () => {
    expect(HQ_APPROVED.data.entries.length).toBeGreaterThan(100);
    expect(COMMON.data.entries.length).toBeGreaterThan(100);
    // HQ comes from the official AFPC page; Common is locally variable by
    // definition and so stays unverified however long it gets.
    expect(HQ_APPROVED.isStub).toBe(false);
    expect(COMMON.isStub).toBe(true);
  });

  it('sorts both tables longest phrase first, whatever the file order', () => {
    for (const table of [HQ_APPROVED.data, COMMON.data]) {
      const lengths = table.entries.map((e) => e.phrase.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    }
  });

  // applyAbbreviations is single-pass, so it is idempotent only while no
  // abbreviation is itself a phrase in the same table. Real data could break
  // that invariant, so it is checked against the real data, not a fixture.
  it('has no abbreviation that is also a phrase in the same table', () => {
    for (const table of [HQ_APPROVED.data, COMMON.data]) {
      const phrases = new Set(table.entries.map((e) => e.phrase.toLowerCase()));
      const offenders = table.entries
        .filter((e) => phrases.has(e.abbr.toLowerCase()))
        .map((e) => `${e.phrase} -> ${e.abbr}`);
      expect(offenders).toEqual([]);
    }
  });

  /**
   * A phrase may legitimately carry two abbreviations -- "Quarterly" is both
   * QTR and QTRLY, and a bullet using either should be recognised. Replacement
   * still has to pick one, so what matters is not that collisions are absent
   * but that resolving them does not depend on the file's line order.
   */
  it('resolves a phrase with two abbreviations the same way whatever the file order', () => {
    for (const dataset of [HQ_APPROVED, COMMON]) {
      const entries = [...dataset.data.entries];
      const shuffled = [...entries].reverse();
      const rebuilt = normalizeAbbreviations(shuffled, {} as never, 'shuffled.json');
      expect([...rebuilt.byPhrase.entries()].sort()).toEqual(
        [...dataset.data.byPhrase.entries()].sort(),
      );
    }
  });

  it('loads stopwords lowercased', () => {
    expect(STOPWORDS.data.has('the')).toBe(true);
    expect(STOPWORDS.data.has('THE'.toLowerCase())).toBe(true);
    expect(STOPWORDS.data.size).toBeGreaterThan(20);
  });

  it('loads the (empty) verb bank', () => {
    expect(VERBS.data).toEqual([]);
  });
});

describe('fonts', () => {
  it('embeds every font in public/fonts', () => {
    const onDisk = readdirSync(fontsDir)
      .filter((f) => f.endsWith('.ttf'))
      .map((f) => `/fonts/${f}`)
      .sort();
    expect(embeddedFontPaths().sort()).toEqual(onDisk);
  });

  it('ships the Liberation licence alongside the fonts', () => {
    expect(existsSync(join(fontsDir, 'LICENSE-Liberation.txt'))).toBe(true);
  });
});
