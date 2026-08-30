import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LIST_LABEL,
  COMMON_NOTE,
  EMPTY_OVERRIDES,
  entryKey,
  fromCsv,
  loadOverrides,
  resolveList,
  saveOverrides,
  shippedEntries,
  shippedMeta,
  toCsv,
  type ListId,
  type Overrides,
  type ResolvedEntry,
} from '@/lib/data/abbreviationStore';

/**
 * The abbreviation lists, editable.
 *
 * Edits are deltas against the shipped files rather than a copy of them, so
 * "reset" is just dropping the delta and a future data update still reaches
 * anyone who has not deliberately overridden that entry. Everything is written
 * to localStorage and read straight back by Bullet Bench, so switching an entry
 * off here changes the shaped output there.
 *
 * Switching entries off is the point, not a nicety: the shipped Common list
 * includes platform designators like "Eagle" -> "F-15", which rewrite any use
 * of the word. Before this page the only remedy was disabling the whole list.
 */

const LISTS: ListId[] = ['hq', 'common'];

type Filter = 'all' | 'enabled' | 'disabled' | 'custom';

export default function AbbreviationManager() {
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  const [loaded, setLoaded] = useState(false);
  const [list, setList] = useState<ListId>('hq');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [draft, setDraft] = useState({ phrase: '', abbr: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  // Read after mount so server-rendered markup and first client render agree.
  useEffect(() => {
    setOverrides(loadOverrides());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveOverrides(overrides);
  }, [overrides, loaded]);

  function flash(message: string) {
    setNote(message);
    window.setTimeout(() => setNote(null), 4000);
  }

  const entries = useMemo(() => resolveList(list, overrides), [list, overrides]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'enabled' && !entry.enabled) return false;
      if (filter === 'disabled' && entry.enabled) return false;
      if (filter === 'custom' && !entry.custom) return false;
      if (needle === '') return true;
      return (
        entry.phrase.toLowerCase().includes(needle) ||
        entry.abbr.toLowerCase().includes(needle)
      );
    });
  }, [entries, query, filter]);

  const enabledCount = entries.filter((e) => e.enabled).length;
  const customCount = entries.filter((e) => e.custom).length;
  const meta = shippedMeta(list);

  function toggle(entry: ResolvedEntry) {
    setOverrides((current) => {
      const disabled = new Set(current[list].disabled);
      if (entry.enabled) disabled.add(entry.key);
      else disabled.delete(entry.key);
      return { ...current, [list]: { ...current[list], disabled: [...disabled] } };
    });
  }

  function setAll(enabled: boolean) {
    setOverrides((current) => ({
      ...current,
      [list]: {
        ...current[list],
        // Only the rows currently on screen, so a search then "disable all"
        // does what it looks like it does.
        disabled: enabled
          ? current[list].disabled.filter((k) => !shown.some((e) => e.key === k))
          : [...new Set([...current[list].disabled, ...shown.map((e) => e.key)])],
      },
    }));
  }

  function addEntry() {
    const phrase = draft.phrase.trim().replace(/\s+/g, ' ');
    const abbr = draft.abbr.trim();
    if (phrase === '' || abbr === '') return;

    const key = entryKey({ phrase, abbr });
    if (entries.some((e) => e.key === key)) {
      flash('That entry is already in this list.');
      return;
    }
    setOverrides((current) => ({
      ...current,
      [list]: {
        ...current[list],
        custom: [{ phrase, abbr }, ...current[list].custom],
        disabled: current[list].disabled.filter((k) => k !== key),
      },
    }));
    setDraft({ phrase: '', abbr: '' });
    flash(`Added "${phrase}" to ${LIST_LABEL[list]}.`);
  }

  function removeCustom(entry: ResolvedEntry) {
    setOverrides((current) => ({
      ...current,
      [list]: {
        ...current[list],
        custom: current[list].custom.filter((e) => entryKey(e) !== entry.key),
      },
    }));
  }

  function exportCsv() {
    const csv = toCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${list}-abbreviations.csv`;
    link.click();
    URL.revokeObjectURL(url);
    flash(`Exported ${entries.length} entries.`);
  }

  async function importCsv(file: File) {
    const { entries: parsed, skipped } = fromCsv(await file.text());
    if (parsed.length === 0) {
      flash('No usable rows found. Expected phrase,abbreviation per line.');
      return;
    }

    const shippedKeys = new Set(shippedEntries(list).map(entryKey));
    setOverrides((current) => {
      const custom = [...current[list].custom];
      const customKeys = new Set(custom.map(entryKey));
      const disabled = new Set(current[list].disabled);

      for (const entry of parsed) {
        const key = entryKey(entry);
        // An imported row that matches a shipped entry only sets its enabled
        // state; duplicating it as a custom entry would shadow the original.
        if (!shippedKeys.has(key) && !customKeys.has(key)) {
          custom.push({ phrase: entry.phrase, abbr: entry.abbr });
          customKeys.add(key);
        }
        if (entry.enabled) disabled.delete(key);
        else disabled.add(key);
      }
      return { ...current, [list]: { custom, disabled: [...disabled] } };
    });

    flash(
      `Imported ${parsed.length} row${parsed.length === 1 ? '' : 's'}` +
        (skipped > 0 ? `, skipped ${skipped} unreadable.` : '.'),
    );
  }

  function resetList() {
    if (!resetArmed) {
      setResetArmed(true);
      window.setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    setResetArmed(false);
    setOverrides((current) => ({ ...current, [list]: { disabled: [], custom: [] } }));
    flash(`${LIST_LABEL[list]} reset to defaults.`);
  }

  const control = {
    background: 'var(--panel)',
    borderColor: 'var(--rule-strong)',
    color: 'var(--ink)',
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* ---- List selector ------------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {LISTS.map((id) => {
          const active = id === list;
          const total = resolveList(id, overrides).length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setList(id)}
              className="util border px-3 py-2 text-left"
              style={{
                background: active ? 'var(--panel-raised)' : 'transparent',
                borderColor: active ? 'var(--ok)' : 'var(--rule-strong)',
                color: active ? 'var(--ink)' : 'var(--ink-muted)',
                letterSpacing: '0.08em',
              }}
            >
              {LIST_LABEL[id]} ({total})
            </button>
          );
        })}

        <a
          href={meta.sourceUrl || undefined}
          target="_blank"
          rel="noreferrer noopener"
          className="util ml-auto"
          style={{
            color: meta.sourceUrl ? 'var(--accent)' : 'var(--ink-faint)',
            pointerEvents: meta.sourceUrl ? undefined : 'none',
          }}
        >
          {meta.sourceUrl ? 'Verify source ↗' : 'No published source'}
        </a>
      </div>

      {list === 'common' && (
        <p className="m-0 text-[11.5px]" style={{ color: 'var(--warn)' }}>
          {COMMON_NOTE}
        </p>
      )}

      {/* ---- Controls ------------------------------------------------------ */}
      <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phrase or abbreviation"
          aria-label="Search"
          className="w-full border px-2.5 py-1.5 text-[12px] sm:w-[260px]"
          style={control}
        />

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="Filter"
          className="border px-2 py-1.5 text-[12px]"
          style={control}
        >
          <option value="all">All</option>
          <option value="enabled">Enabled only</option>
          <option value="disabled">Disabled only</option>
          <option value="custom">Mine only</option>
        </select>

        <span className="util">
          {shown.length} shown · {enabledCount} on · {customCount} mine
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAll(true)} className="util border px-2.5 py-1.5" style={control}>
            Enable shown
          </button>
          <button type="button" onClick={() => setAll(false)} className="util border px-2.5 py-1.5" style={control}>
            Disable shown
          </button>
          <button type="button" onClick={exportCsv} className="util border px-2.5 py-1.5" style={control}>
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="util border px-2.5 py-1.5"
            style={control}
          >
            Import CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importCsv(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={resetList}
            className="util border px-2.5 py-1.5"
            style={{
              ...control,
              borderColor: resetArmed ? 'var(--bad)' : 'var(--rule-strong)',
              color: resetArmed ? 'var(--bad)' : 'var(--ink-muted)',
            }}
          >
            {resetArmed ? 'Reset — confirm' : 'Reset to defaults'}
          </button>
        </div>

        {note && (
          <p role="status" className="m-0 w-full text-[11.5px]" style={{ color: 'var(--ok)' }}>
            {note}
          </p>
        )}
      </div>

      {/* ---- Add ----------------------------------------------------------- */}
      <form
        className="panel flex flex-wrap items-end gap-x-3 gap-y-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          addEntry();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="util">Phrase</span>
          <input
            type="text"
            value={draft.phrase}
            onChange={(e) => setDraft((d) => ({ ...d, phrase: e.target.value }))}
            placeholder="Operations Support Squadron"
            className="w-full border px-2.5 py-1.5 text-[12px] sm:w-[300px]"
            style={control}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="util">Abbreviation</span>
          <input
            type="text"
            value={draft.abbr}
            onChange={(e) => setDraft((d) => ({ ...d, abbr: e.target.value }))}
            placeholder="OSS"
            className="w-full border px-2.5 py-1.5 text-[12px] sm:w-[160px]"
            style={control}
          />
        </label>
        <button
          type="submit"
          className="util border px-3 py-2"
          style={{ ...control, background: 'var(--panel-raised)' }}
        >
          Add to this list
        </button>
        <span className="util" style={{ textTransform: 'none' }}>
          Longer phrases always win over shorter ones, whatever order you add them in.
        </span>
      </form>

      {/* ---- Table --------------------------------------------------------- */}
      <div className="panel">
        <div
          className="flex items-center gap-3 border-b px-3 py-2"
          style={{ borderColor: 'var(--rule)' }}
        >
          <span className="util w-8">On</span>
          <span className="util flex-1">Phrase</span>
          <span className="util w-[120px]">Abbreviation</span>
          <span className="util w-24 text-right">Origin</span>
        </div>

        {shown.length === 0 ? (
          <p className="m-0 px-3 py-4 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
            Nothing matches.
          </p>
        ) : (
          <ol className="m-0 max-h-[60vh] list-none overflow-auto p-0">
            {shown.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center gap-3 px-3 py-1.5 text-[12px]"
                style={{
                  borderTop: '1px solid var(--rule)',
                  opacity: entry.enabled ? 1 : 0.45,
                }}
              >
                <span className="w-8">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={() => toggle(entry)}
                    aria-label={`${entry.phrase} to ${entry.abbr}`}
                    style={{ accentColor: 'var(--ok)' }}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink)' }}>
                  {entry.phrase}
                </span>
                <span className="w-[120px]" style={{ color: 'var(--ok)' }}>
                  {entry.abbr}
                </span>
                <span className="flex w-24 items-center justify-end gap-2">
                  {entry.custom ? (
                    <>
                      <span className="util" style={{ color: 'var(--ok)' }}>
                        Yours
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCustom(entry)}
                        className="util"
                        style={{ color: 'var(--bad)' }}
                        title="Delete this entry you added"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="util" title="Came with the app; switch it off rather than deleting it">
                      Built-in
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="util m-0" style={{ textTransform: 'none' }}>
        Changes save to this browser and take effect in Bullet Bench immediately. Reset
        restores the shipped list; entries you added are removed with it.
      </p>
    </div>
  );
}
