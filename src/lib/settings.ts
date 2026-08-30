/**
 * Preferences and the inventory of what this site keeps on the device.
 *
 * Every access sits inside a try, including the existence check: on an opaque
 * origin -- a page opened from file://, which is exactly the offline copy's
 * situation -- merely evaluating `typeof localStorage` throws a SecurityError,
 * and a guard outside the try takes the whole component down with it.
 */

/** Every key this site writes is namespaced, which is what makes an inventory possible. */
export const KEY_PREFIX = 'ocg.';

export const THEME_KEY = 'ocg.theme';
export const BENCH_PREFS_KEY = 'ocg.bullet-bench.prefs.v1';

export type Theme = 'light' | 'dark';

export interface BenchPrefs {
  autoSpace: boolean;
  abbreviate: boolean;
  showDuplicates: boolean;
  /** Empty means "whatever the tool picks by default". */
  formId: string;
  fieldId: string;
}

export const DEFAULT_BENCH_PREFS: BenchPrefs = {
  autoSpace: true,
  abbreviate: true,
  showDuplicates: false,
  formId: '',
  fieldId: '',
};

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* Blocked storage: the choice applies for this page view only. */
  }
}

/**
 * Merges stored preferences over the defaults rather than replacing them, so a
 * preference added in a later version does not read as `undefined` for anyone
 * who already has a stored object.
 */
export function parseBenchPrefs(raw: string | null): BenchPrefs {
  if (!raw) return { ...DEFAULT_BENCH_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<BenchPrefs>;
    return {
      autoSpace: typeof parsed.autoSpace === 'boolean' ? parsed.autoSpace : DEFAULT_BENCH_PREFS.autoSpace,
      abbreviate: typeof parsed.abbreviate === 'boolean' ? parsed.abbreviate : DEFAULT_BENCH_PREFS.abbreviate,
      showDuplicates:
        typeof parsed.showDuplicates === 'boolean'
          ? parsed.showDuplicates
          : DEFAULT_BENCH_PREFS.showDuplicates,
      formId: typeof parsed.formId === 'string' ? parsed.formId : '',
      fieldId: typeof parsed.fieldId === 'string' ? parsed.fieldId : '',
    };
  } catch {
    return { ...DEFAULT_BENCH_PREFS };
  }
}

export function loadBenchPrefs(): BenchPrefs {
  return parseBenchPrefs(readRaw(BENCH_PREFS_KEY));
}

export function saveBenchPrefs(prefs: BenchPrefs): void {
  writeRaw(BENCH_PREFS_KEY, JSON.stringify(prefs));
}

export function loadTheme(): Theme | null {
  const stored = readRaw(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

/** Applies immediately as well as storing, so the page does not need a reload. */
export function saveTheme(theme: Theme): void {
  writeRaw(THEME_KEY, theme);
  try {
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    /* No document: nothing to repaint. */
  }
}

// ---------------------------------------------------------------------------
// Stored data inventory
// ---------------------------------------------------------------------------

export interface StoredItem {
  key: string;
  /** Plain-English name where the key is known, otherwise the key itself. */
  label: string;
  description: string;
  bytes: number;
}

/**
 * Descriptions for keys this site is known to write.
 *
 * Deliberately a lookup rather than the source of truth: the inventory is built
 * by scanning localStorage, so a key written by a tool added later still shows
 * up, just without a friendly description. Listing only known keys would make
 * "clear everything" quietly incomplete.
 */
const KNOWN: Record<string, { label: string; description: string }> = {
  'ocg.theme': { label: 'Theme', description: 'Light or dark, if you chose one.' },
  'ocg.bullet-bench.draft.v2': {
    label: 'Bullet Bench draft',
    description: 'The bullets currently in the editor.',
  },
  'ocg.bullet-bench.prefs.v1': {
    label: 'Bullet Bench settings',
    description: 'Auto-Space, Abbreviate, Show Duplicates, and the form you last used.',
  },
  'ocg.abbreviations.v1': {
    label: 'Abbreviation edits',
    description: 'Entries you switched off and any you added yourself.',
  },
  'ocg.thesaurus.recent': {
    label: 'Thesaurus history',
    description: 'The last few words you looked up.',
  },
};

function describe(key: string): { label: string; description: string } {
  return (
    KNOWN[key] ?? {
      label: key.slice(KEY_PREFIX.length) || key,
      description: 'Saved by another tool on this site.',
    }
  );
}

/** Everything this site has stored, newest listing built fresh each call. */
export function storedItems(): StoredItem[] {
  const items: StoredItem[] = [];
  try {
    if (typeof localStorage === 'undefined') return items;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const value = localStorage.getItem(key) ?? '';
      items.push({
        key,
        ...describe(key),
        // Rough: a UTF-16 code unit apiece, which is what browsers count.
        bytes: key.length * 2 + value.length * 2,
      });
    }
  } catch {
    return items;
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

export function removeStored(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* Nothing to remove. */
  }
}

/** Clears everything this site owns, leaving other origins' data alone. */
export function clearAllStored(): string[] {
  const cleared: string[] = [];
  for (const item of storedItems()) {
    removeStored(item.key);
    cleared.push(item.key);
  }
  return cleared;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
