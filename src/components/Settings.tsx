import { useEffect, useState } from 'react';
import { FORMS, getForm, isFormUsable } from '@/lib/data/forms';
import {
  DEFAULT_BENCH_PREFS,
  clearAllStored,
  formatBytes,
  loadBenchPrefs,
  loadTheme,
  removeStored,
  saveBenchPrefs,
  saveTheme,
  storedItems,
  type BenchPrefs,
  type StoredItem,
  type Theme,
} from '@/lib/settings';

/**
 * Preferences, and an inventory of what this site keeps on the device.
 *
 * The inventory is the part that earns the page. Every tool here claims nothing
 * leaves your browser, and until now that claim was made in the footer with no
 * way to see or manage what was actually kept. It is built by scanning storage
 * rather than from a list of known keys, so a tool added later still appears --
 * a hardcoded list would make "clear everything" quietly incomplete.
 */
export default function Settings() {
  const [prefs, setPrefs] = useState<BenchPrefs>(DEFAULT_BENCH_PREFS);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [items, setItems] = useState<StoredItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function refresh() {
    setItems(storedItems());
  }

  useEffect(() => {
    setPrefs(loadBenchPrefs());
    setTheme(loadTheme());
    refresh();
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveBenchPrefs(prefs);
  }, [prefs, loaded]);

  function flash(message: string) {
    setNote(message);
    window.setTimeout(() => setNote(null), 4000);
  }

  function update<K extends keyof BenchPrefs>(key: K, value: BenchPrefs[K]) {
    setPrefs((current) => ({ ...current, [key]: value }));
    // The listing includes this page's own preference key, so keep it honest.
    window.setTimeout(refresh, 0);
  }

  function pickTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
    window.setTimeout(refresh, 0);
  }

  function clearOne(item: StoredItem) {
    removeStored(item.key);
    refresh();
    flash(`Removed ${item.label}.`);
  }

  function clearEverything() {
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    setClearArmed(false);
    const cleared = clearAllStored();
    setPrefs(DEFAULT_BENCH_PREFS);
    setTheme(null);
    refresh();
    flash(`Cleared ${cleared.length} item${cleared.length === 1 ? '' : 's'}.`);
  }

  const usable = FORMS.filter((f) => isFormUsable(f.data));
  const selectedForm = prefs.formId ? getForm(prefs.formId) : undefined;
  const totalBytes = items.reduce((n, item) => n + item.bytes, 0);

  const control = {
    background: 'var(--panel)',
    borderColor: 'var(--rule-strong)',
    color: 'var(--ink)',
  };

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-6 py-5">
      {note && (
        <p role="status" className="m-0 text-[11.5px]" style={{ color: 'var(--ok)' }}>
          {note}
        </p>
      )}

      {/* ---- Appearance ---------------------------------------------------- */}
      <section className="panel p-4">
        <h2 className="title m-0">Appearance</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(['dark', 'light'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => pickTheme(option)}
              className="util border px-3 py-2"
              style={{
                ...control,
                borderColor: theme === option ? 'var(--ok)' : 'var(--rule-strong)',
                color: theme === option ? 'var(--ink)' : 'var(--ink-muted)',
              }}
            >
              {option}
            </button>
          ))}
          <span className="util" style={{ textTransform: 'none' }}>
            {theme ? 'Chosen explicitly.' : 'No choice stored; the site default applies.'}
          </span>
        </div>
      </section>

      {/* ---- Bullet Bench -------------------------------------------------- */}
      <section className="panel p-4">
        <h2 className="title m-0">Bullet Bench</h2>
        <p className="m-0 mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          How the editor opens. These used to reset every visit.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <Toggle
            checked={prefs.autoSpace}
            onChange={(v) => update('autoSpace', v)}
            label="Auto-Space"
            hint="Substitute half spaces to fit the line."
          />
          <Toggle
            checked={prefs.abbreviate}
            onChange={(v) => update('abbreviate', v)}
            label="Abbreviate"
            hint="Replace approved phrases before shaping."
          />
          <Toggle
            checked={prefs.showDuplicates}
            onChange={(v) => update('showDuplicates', v)}
            label="Show Duplicates"
            hint="Highlight repeated words in the draft."
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex flex-col gap-1.5">
            <span className="util">Form it opens on</span>
            <select
              value={prefs.formId}
              onChange={(e) => {
                update('formId', e.target.value);
                update('fieldId', '');
              }}
              className="border px-2.5 py-1.5 text-[12.5px]"
              style={control}
            >
              <option value="">First available</option>
              {usable.map((f) => (
                <option key={f.data.id} value={f.data.id}>
                  {f.data.label}
                </option>
              ))}
            </select>
          </label>

          {selectedForm && selectedForm.data.fields.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="util">Section</span>
              <select
                value={prefs.fieldId}
                onChange={(e) => update('fieldId', e.target.value)}
                className="border px-2.5 py-1.5 text-[12.5px]"
                style={control}
              >
                <option value="">First section</option>
                {selectedForm.data.fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {/* ---- Stored data ---------------------------------------------------- */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title m-0">Stored on this device</h2>
          <span className="util">
            {items.length} item{items.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
          </span>
        </div>
        <p className="m-0 mt-1 max-w-[70ch] text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          Everything this site keeps, kept in this browser alone. None of it is uploaded,
          and clearing it here removes it for good.
        </p>

        {items.length === 0 ? (
          <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
            Nothing stored yet.
          </p>
        ) : (
          <ul className="m-0 mt-3 list-none p-0">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                style={{ borderTop: '1px solid var(--rule)' }}
              >
                <span className="text-[12px]" style={{ color: 'var(--ink)' }}>
                  {item.label}
                </span>
                <span className="util">{formatBytes(item.bytes)}</span>
                <span
                  className="w-full text-[11px] sm:w-auto sm:flex-1"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {item.description}
                </span>
                <button
                  type="button"
                  onClick={() => clearOne(item)}
                  className="util"
                  style={{ color: 'var(--bad)' }}
                  title={item.key}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={clearEverything}
          disabled={items.length === 0}
          className="util mt-4 border px-3 py-2"
          style={{
            ...control,
            borderColor: clearArmed ? 'var(--bad)' : 'var(--rule-strong)',
            color: items.length === 0 ? 'var(--ink-faint)' : clearArmed ? 'var(--bad)' : 'var(--ink-muted)',
          }}
        >
          {clearArmed ? 'Clear everything — confirm' : 'Clear everything'}
        </button>
      </section>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex flex-wrap items-baseline gap-x-2.5 text-[12px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--ok)' }}
      />
      <span style={{ color: 'var(--ink)' }}>{label}</span>
      <span className="util" style={{ textTransform: 'none' }}>
        {hint}
      </span>
    </label>
  );
}
