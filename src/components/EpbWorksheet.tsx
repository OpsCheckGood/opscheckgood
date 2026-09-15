import { useEffect, useState } from 'react';
import { EPB, type EpbSection } from '@/lib/data/epb';
import { characterLabel, count, emptyDraft, isEmpty, worksheetText, type Draft } from '@/lib/epb/worksheet';
import { downloadBytes, downloadName, epbWorksheetPdf } from '@/lib/pdfform/downloads';
import { DownloadBar } from './DownloadBar';
import { SourceStamp } from './SourceStamp';

/**
 * EPB Worksheet.
 *
 * The Enlisted Performance Brief, box by box, each counted to the limit
 * myEval enforces: the duty description, the four major performance areas
 * with their definitions and the Airman Leadership Qualities under each,
 * and the higher level reviewer assessment. A counter beside every box
 * reads "n remaining" as you type and "n over" once you pass the limit, so
 * a statement is cut to fit here rather than in myEval. A scratch area at
 * the end holds the drafts that are not ready yet.
 *
 * Nothing typed here leaves the device: the draft lives in localStorage.
 */

const DRAFT_KEY = 'ocg.epb-worksheet.draft.v1';

const dataset = EPB;
const data = dataset.data;

const CONTROL = {
  background: 'var(--panel-sunk)',
  borderColor: 'var(--rule-strong)',
  color: 'var(--ink)',
} as const;

export default function EpbWorksheet() {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(data));
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved) as Partial<Draft>;
        const next = emptyDraft(data);
        for (const key of Object.keys(next)) if (typeof parsed[key] === 'string') next[key] = parsed[key]!;
        setDraft(next);
      }
    } catch {
      /* Private mode, blocked storage, or a draft from an older shape. */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* The worksheet still works; the boxes simply are not remembered. */
    }
  }, [draft, loaded]);

  const set = (id: string, value: string) => setDraft((d) => ({ ...d, [id]: value }));
  const blank = isEmpty(draft);

  function flash(text: string) {
    setNote(text);
    window.setTimeout(() => setNote(null), 3000);
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash('Copy blocked — select and Ctrl+C');
    }
  }

  /** The worksheet as a fillable PDF: blank, or carrying what is on the page. */
  async function downloadPdf(withEntries: boolean) {
    const bytes = await epbWorksheetPdf(withEntries ? draft : null, data);
    downloadBytes(bytes, downloadName('EPB Worksheet', withEntries ? 'filled' : 'blank'));
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 sm:px-6 py-6">
      <DownloadBar
        items={[
          {
            label: 'Blank PDF builder',
            detail: 'The EPB Worksheet as a fillable PDF. Fill it in Acrobat or Reader; every box counts as you type.',
            run: () => downloadPdf(false),
            primary: true,
          },
          {
            label: 'PDF builder with these entries',
            detail: 'The same PDF with everything on this page already entered.',
            run: () => downloadPdf(true),
            disabled: blank,
          },
        ]}
      />

      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h2 className="title m-0">Worksheet</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {note && (
              <span role="status" className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {note}
              </span>
            )}
            <button
              type="button"
              onClick={() => void copyText(worksheetText(data, draft), 'Worksheet')}
              disabled={blank}
              className="util border px-3.5 py-2"
              style={{
                background: blank ? 'var(--panel)' : 'var(--control)',
                borderColor: blank ? 'var(--rule-strong)' : 'var(--control)',
                color: blank ? 'var(--ink-faint)' : 'var(--ground)',
                letterSpacing: '0.09em',
              }}
            >
              Copy all
            </button>
            <button
              type="button"
              onClick={() => setDraft(emptyDraft(data))}
              className="util flex items-center gap-2 border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: 'var(--accent)', color: 'var(--accent)', letterSpacing: '0.09em' }}
            >
              <span aria-hidden>&#8635;</span> Clear all
            </button>
          </div>
        </div>
        <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Each box is held to the limit myEval enforces, counting every character, spaces included.
          Write past the limit if you need to; the counter says how far over you are. Nothing typed
          here leaves this device.
        </p>
      </section>

      {data.sections.map((section, i) => (
        <Box
          key={section.id}
          step={i + 1}
          section={section}
          value={draft[section.id] ?? ''}
          onChange={(v) => set(section.id, v)}
          onCopy={() => void copyText(draft[section.id] ?? '', section.title)}
        />
      ))}

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StepTitle step={data.sections.length + 1} title="Workbench" />
          <span className="util">No limit</span>
          <Counter text={characterLabel(draft.workbench ?? '')} tone="plain" />
        </div>
        <textarea
          id="epb-workbench"
          aria-label="Workbench"
          value={draft.workbench ?? ''}
          onChange={(e) => set('workbench', e.target.value)}
          rows={8}
          spellCheck
          className="w-full resize-y border px-3 py-2 text-[13.5px] leading-relaxed"
          style={{ ...CONTROL, fontFamily: 'inherit' }}
          placeholder="Room to draft before a statement is cut to fit. Nothing here has a limit."
        />
      </section>

      <SourceStamp sources={[dataset.meta]} />
    </div>
  );
}

function Box({ step, section, value, onChange, onCopy }: { step: number; section: EpbSection; value: string; onChange: (v: string) => void; onCopy: () => void }) {
  const c = count(value, section.limit);
  const tone: Tone = c.over ? 'bad' : c.remaining === 0 ? 'ok' : 'plain';
  const id = `epb-${section.id}`;
  const rows = Math.max(3, Math.ceil(section.limit / 110) + 1);
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <StepTitle step={step} title={section.title} />
        <span className="util">{section.limit} characters</span>
        <Counter text={c.label} tone={tone} />
      </div>
      {section.description && (
        <p className="m-0 mb-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>
          {section.description}
        </p>
      )}
      {section.qualities.length > 0 && (
        <details className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          <summary className="util cursor-pointer select-none" style={{ color: 'var(--accent)' }}>
            Airman Leadership Qualities
          </summary>
          <ul className="m-0 mt-2 list-none p-0 flex flex-col gap-1.5">
            {section.qualities.map((q) => (
              <li key={q.name}>
                <strong className="font-semibold" style={{ color: 'var(--ink)' }}>
                  {q.name}:
                </strong>{' '}
                {q.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <label className="sr-only" htmlFor={id}>
        {section.title}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck
        className="w-full resize-y border px-3 py-2 text-[13.5px] leading-relaxed"
        style={{ ...CONTROL, fontFamily: 'inherit', borderColor: c.over ? 'var(--warn)' : CONTROL.borderColor }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          disabled={value.trim() === ''}
          className="util border px-3 py-1.5"
          style={{
            background: 'var(--panel)',
            borderColor: value.trim() === '' ? 'var(--rule)' : 'var(--ink)',
            color: value.trim() === '' ? 'var(--ink-faint)' : 'var(--ink)',
            letterSpacing: '0.09em',
          }}
        >
          Copy
        </button>
        <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
          {c.length} of {section.limit}
          {c.over && `. Cut ${-c.remaining} character${c.remaining === -1 ? '' : 's'} before it goes into myEval`}
        </span>
      </div>
    </section>
  );
}

type Tone = 'plain' | 'ok' | 'bad';

function Counter({ text, tone }: { text: string; tone: Tone }) {
  const tones = {
    plain: { background: 'var(--panel-raised)', color: 'var(--ink-muted)', border: 'var(--rule)' },
    ok: { background: 'var(--ok-dim)', color: 'var(--ok)', border: 'var(--ok-dim)' },
    bad: { background: 'var(--warn-dim)', color: 'var(--warn)', border: 'var(--warn-dim)' },
  }[tone];
  return (
    <output
      className="tabular ml-auto block border px-3 py-1.5 text-[13px] font-semibold"
      style={{ background: tones.background, borderColor: tones.border, color: tones.color, borderRadius: 6 }}
    >
      {text}
    </output>
  );
}

function StepTitle({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="m-0 flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: 'var(--accent)', color: '#ffffff' }}
      >
        {step}
      </span>
      <span className="title">{title}</span>
    </h2>
  );
}
