import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BENCH_PREFS_KEY,
  DEFAULT_BENCH_PREFS,
  KEY_PREFIX,
  clearAllStored,
  formatBytes,
  loadBenchPrefs,
  parseBenchPrefs,
  removeStored,
  saveBenchPrefs,
  storedItems,
} from '@/lib/settings';

/**
 * A minimal localStorage, since the settings module is the one place that has
 * to survive every state the real one can be in: absent, blocked, and holding
 * junk.
 */
class FakeStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function install(storage: unknown) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => install(new FakeStorage()));
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis as object, 'localStorage');
});

describe('bench preferences', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadBenchPrefs()).toEqual(DEFAULT_BENCH_PREFS);
  });

  it('round-trips a saved preference', () => {
    saveBenchPrefs({ ...DEFAULT_BENCH_PREFS, abbreviate: false, formId: 'af1206' });
    expect(loadBenchPrefs()).toMatchObject({ abbreviate: false, formId: 'af1206' });
  });

  /**
   * Merging over the defaults rather than replacing them: a preference added
   * later must not read as undefined for someone with an older stored object.
   */
  it('fills in a preference missing from an older stored object', () => {
    expect(parseBenchPrefs(JSON.stringify({ autoSpace: false }))).toEqual({
      ...DEFAULT_BENCH_PREFS,
      autoSpace: false,
    });
  });

  it('ignores junk rather than throwing', () => {
    expect(parseBenchPrefs('not json')).toEqual(DEFAULT_BENCH_PREFS);
    expect(parseBenchPrefs('{"autoSpace":"yes"}')).toEqual(DEFAULT_BENCH_PREFS);
    expect(parseBenchPrefs(null)).toEqual(DEFAULT_BENCH_PREFS);
  });
});

describe('stored data inventory', () => {
  it('lists only this site’s keys', () => {
    localStorage.setItem('ocg.theme', 'dark');
    localStorage.setItem('ocg.bullet-bench.draft.v2', 'hello');
    localStorage.setItem('unrelated.key', 'someone else');

    const keys = storedItems().map((i) => i.key);
    expect(keys).toContain('ocg.theme');
    expect(keys).toContain('ocg.bullet-bench.draft.v2');
    expect(keys).not.toContain('unrelated.key');
  });

  /**
   * The inventory is built by scanning, not from a list of known keys. A tool
   * added later has to appear, or "clear everything" is quietly incomplete.
   */
  it('shows a key it has never heard of', () => {
    localStorage.setItem('ocg.some-future-tool.v3', 'x');
    const found = storedItems().find((i) => i.key === 'ocg.some-future-tool.v3');
    expect(found).toBeDefined();
    expect(found!.description).toMatch(/another tool/i);
  });

  it('describes the keys it does know', () => {
    localStorage.setItem('ocg.abbreviations.v1', '{}');
    const found = storedItems().find((i) => i.key === 'ocg.abbreviations.v1')!;
    expect(found.label).toBe('Abbreviation edits');
    expect(found.description).not.toMatch(/another tool/i);
  });

  it('reports a size that grows with the value', () => {
    localStorage.setItem('ocg.a', 'x');
    localStorage.setItem('ocg.b', 'x'.repeat(500));
    const [a, b] = storedItems().sort((x, y) => x.key.localeCompare(y.key));
    expect(b!.bytes).toBeGreaterThan(a!.bytes);
  });

  it('removes one key without touching the rest', () => {
    localStorage.setItem('ocg.theme', 'dark');
    localStorage.setItem('ocg.thesaurus.recent', '[]');
    removeStored('ocg.theme');
    expect(storedItems().map((i) => i.key)).toEqual(['ocg.thesaurus.recent']);
  });

  it('clears everything of ours and leaves other origins’ keys alone', () => {
    localStorage.setItem('ocg.theme', 'dark');
    localStorage.setItem('ocg.pt.draft', '{}');
    localStorage.setItem('somebody-else', 'keep me');

    const cleared = clearAllStored();
    expect(cleared).toHaveLength(2);
    expect(storedItems()).toEqual([]);
    expect(localStorage.getItem('somebody-else')).toBe('keep me');
  });
});

describe('storage that is unavailable or hostile', () => {
  /**
   * On an opaque origin -- a page opened from file://, which is the offline
   * copy's situation -- even reading `typeof localStorage` throws. Every access
   * has to be inside the try, or the whole component goes down with it.
   */
  it('survives a localStorage that throws on every access', () => {
    install(
      new Proxy(
        {},
        {
          get() {
            throw new DOMException('denied', 'SecurityError');
          },
        },
      ),
    );
    expect(() => loadBenchPrefs()).not.toThrow();
    expect(loadBenchPrefs()).toEqual(DEFAULT_BENCH_PREFS);
    expect(() => saveBenchPrefs(DEFAULT_BENCH_PREFS)).not.toThrow();
    expect(storedItems()).toEqual([]);
    expect(() => clearAllStored()).not.toThrow();
  });

  it('survives localStorage being absent entirely', () => {
    Reflect.deleteProperty(globalThis as object, 'localStorage');
    expect(loadBenchPrefs()).toEqual(DEFAULT_BENCH_PREFS);
    expect(storedItems()).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('scales its unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('key namespacing', () => {
  it('keeps the preference key under the site prefix, so it is inventoried', () => {
    expect(BENCH_PREFS_KEY.startsWith(KEY_PREFIX)).toBe(true);
  });
});
