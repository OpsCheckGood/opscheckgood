import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMeta, isPlaceholderString, isPlaceholderNumber } from '@/lib/data/loader';
import { FORMS, isFieldPopulated, isFormUsable, usableForms } from '@/lib/data/forms';
import { STOPWORDS, VERBS } from '@/lib/data/vocab';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
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

  it('marks the unpopulated AF forms unusable and keeps them out of the picker', () => {
    for (const id of ['af1206', 'af910', 'af911']) {
      const form = FORMS.find((f) => f.data.id === id)!;
      expect(form.isStub).toBe(true);
      expect(isFormUsable(form.data)).toBe(false);
    }
    expect(usableForms().map((f) => f.data.id)).toEqual(['sandbox']);
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
    expect(HQ_APPROVED.data.entries).toEqual([]);
    expect(COMMON.data.entries).toEqual([]);
    expect(HQ_APPROVED.isStub).toBe(true);
    expect(COMMON.isStub).toBe(true);
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
