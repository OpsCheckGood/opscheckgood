import { useEffect, useMemo, useState } from 'react';
import type { DataMeta } from '@/lib/data/types';
import { CONTACT_EMAIL, ISSUES_URL, NEW_ISSUE_URL, REPO_IS_PUBLIC } from '@/lib/site';
import { buildReport, readEnvironment, type Environment } from '@/lib/report';

/**
 * Report a bug.
 *
 * There is no backend, so this is not a form that submits -- it is a form that
 * assembles. The reporter writes what happened, the page adds the environment
 * and the data versions, and the whole thing goes to the clipboard for pasting
 * into a GitHub issue.
 *
 * The finished report is shown in full, above the copy button, before anything
 * is copied. That is the point: a tool whose entire promise is that nothing
 * leaves your device cannot then hand you an opaque blob and ask you to trust
 * it. You read exactly what you are about to share.
 *
 * Nothing entered in any tool reaches this page; see the header comment in
 * src/lib/report.ts for why that is a decision rather than an omission.
 */

interface Props {
  /** Tool names to choose between, supplied by the page from its routes. */
  tools: string[];
  /** Provenance for every dataset the site ships, gathered at build time. */
  sources: DataMeta[];
}

const DRAFT_KEY = 'ocg.report.draft';

interface Draft {
  tool: string;
  description: string;
  expected: string;
  steps: string;
}

export default function BugReport({ tools, sources }: Props) {
  const [draft, setDraft] = useState<Draft>(() => ({
    tool: tools[0] ?? 'Ops Check Good',
    description: '',
    expected: '',
    steps: '',
  }));
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Read after mount: the environment does not exist at build time, and a
  // stored draft has to be applied on the client or the static markup and the
  // first client render disagree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setDraft((d) => ({ ...d, ...(JSON.parse(saved) as Draft) }));
    } catch {
      /* Blocked storage, or a draft from an older shape. */
    }
    setEnvironment(readEnvironment(window));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* The report still works; it simply is not remembered. */
    }
  }, [draft, loaded]);

  const report = useMemo(
    () => buildReport({ ...draft, environment, sources }),
    [draft, environment, sources],
  );

  const written = draft.description.trim() !== '';

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy blocked — select the text below and press Ctrl+C');
    }
    window.setTimeout(() => setCopyNote(null), 4000);
  }

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-3 sm:px-6 py-6">
      {/* ---- What happened ------------------------------------------------ */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SectionTitle step={1} title="What went wrong" />
          <button
            type="button"
            onClick={() =>
              setDraft({ tool: tools[0] ?? 'Ops Check Good', description: '', expected: '', steps: '' })
            }
            className="util ml-auto flex items-center gap-2 border px-3.5 py-2"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              letterSpacing: '0.09em',
            }}
          >
            <span aria-hidden>&#8635;</span> Clear all
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Which tool" htmlFor="report-tool">
            <select
              id="report-tool"
              value={draft.tool}
              onChange={(e) => set('tool')(e.target.value)}
              className="border px-3 py-2 text-[12.5px]"
              style={{
                background: 'var(--panel-sunk)',
                borderColor: 'var(--rule-strong)',
                color: 'var(--ink)',
                width: '18rem',
                maxWidth: '100%',
              }}
            >
              {tools.map((tool) => (
                <option key={tool} value={tool}>
                  {tool}
                </option>
              ))}
            </select>
          </Field>

          <Field label="What happened" htmlFor="report-description">
            <TextArea
              id="report-description"
              value={draft.description}
              onChange={set('description')}
              rows={4}
              placeholder="The BTZ date came out a day earlier than the one my MPF gave me."
            />
          </Field>

          <Field label="What you expected instead" htmlFor="report-expected">
            <TextArea
              id="report-expected"
              value={draft.expected}
              onChange={set('expected')}
              rows={3}
              placeholder="15 FEB 2028, matching the roster."
            />
          </Field>

          <Field label="Steps to reproduce" htmlFor="report-steps">
            <TextArea
              id="report-steps"
              value={draft.steps}
              onChange={set('steps')}
              rows={4}
              placeholder={
                'Use made-up dates that still show the problem, not a real record.\n' +
                '1. Enter 15 AUG 2025 and 15 JUN 2026\n' +
                '2. Read the projected BTZ date'
              }
            />
          </Field>
        </div>

        {/*
          The one thing worth saying twice. People reporting a bug will reach
          for the input that caused it, and for these tools that input is
          somebody's service record.
        */}
        <p
          className="m-0 mt-4 px-3 py-2.5 text-[11.5px] leading-relaxed"
          style={{ background: 'var(--warn-dim)', color: 'var(--warn)', borderRadius: 6 }}
        >
          <strong className="font-semibold">Keep real records out of it.</strong> A GitHub
          issue is public and permanent. Reproduce the problem with invented dates or
          invented bullets — if it only happens with real ones, say so and describe the
          shape rather than pasting them.
        </p>
      </section>

      {/* ---- The report --------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SectionTitle step={2} title="Copy the report" />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {copyNote && <span className="util">{copyNote}</span>}
            <button
              type="button"
              onClick={copyReport}
              className="util flex items-center gap-2 border px-4 py-2.5"
              style={{
                background: written ? 'var(--accent)' : 'var(--panel)',
                borderColor: written ? 'var(--accent)' : 'var(--rule-strong)',
                color: written ? '#ffffff' : 'var(--ink)',
                letterSpacing: '0.1em',
              }}
            >
              <span aria-hidden>&#9099;</span> Copy report
            </button>
          </div>
        </div>

        <p className="m-0 mb-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          This is exactly what the button puts on your clipboard — nothing more. It is built
          here in your browser and sent nowhere.
        </p>

        <pre
          className="tabular m-0 overflow-x-auto px-3 py-3 text-[11.5px] leading-relaxed"
          style={{
            background: 'var(--panel-sunk)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {report}
        </pre>
      </section>

      {/* ---- Where it goes ------------------------------------------------ */}
      <Destination />
    </div>
  );
}

/**
 * Where the report goes, which depends on whether the repository is reachable.
 *
 * While it is private there are no GitHub links at all. A link to a private
 * repository 404s for everyone who is not a collaborator, and pointing a
 * reporter at a 404 spends their effort and returns nothing. The report still
 * assembles and still copies; only the destination is withheld, and the page
 * says so plainly rather than implying a tracker anyone can reach.
 */
function Destination() {
  if (!REPO_IS_PUBLIC) {
    return (
      <section className="panel p-5">
        <SectionTitle step={3} title="Send it" />
        <p
          className="m-0 mt-3 max-w-[70ch] text-[12px] leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          The source repository is private for now, so there is no public issue tracker to
          file this in. Copy the report above and send it to whoever gave you this tool.
          It is plain text and it keeps — nothing about it expires.
        </p>

        {CONTACT_EMAIL !== '' && (
          <div className="mt-4">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Ops Check Good — bug report')}`}
              className="util inline-flex items-center gap-2 border px-4 py-2.5 no-underline"
              style={{
                background: 'var(--panel)',
                borderColor: 'var(--rule-strong)',
                color: 'var(--ink)',
                letterSpacing: '0.1em',
              }}
            >
              Email the report
            </a>
            <p className="m-0 mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
              Opens your own mail app with the subject filled in. Paste the report into the
              body — this page sends nothing itself.
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel p-5">
      <SectionTitle step={3} title="Open an issue" />
      <p
        className="m-0 mt-3 max-w-[70ch] text-[12px] leading-relaxed"
        style={{ color: 'var(--ink-muted)' }}
      >
        Paste the report into a new issue. If GitHub is blocked on your network — it often
        is on .mil — copy the report now and open the issue later from a phone or a home
        machine. The report is plain text and keeps.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={NEW_ISSUE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="util flex items-center gap-2 border px-4 py-2.5 no-underline"
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--rule-strong)',
            color: 'var(--ink)',
            letterSpacing: '0.1em',
          }}
        >
          New issue <span aria-hidden style={{ color: 'var(--ink-faint)' }}>↗</span>
        </a>
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="util no-underline"
          style={{ color: 'var(--accent)', letterSpacing: '0.09em' }}
        >
          Browse existing issues ↗
        </a>
      </div>

      <p className="m-0 mt-4 text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
        Opening either link leaves this site. This page itself makes no network requests.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function SectionTitle({ step, title }: { step: number; title: string }) {
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="util" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function TextArea({
  id,
  value,
  onChange,
  rows,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder: string;
}) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border px-3 py-2 text-[12.5px] leading-relaxed"
      style={{
        background: 'var(--panel-sunk)',
        borderColor: 'var(--rule-strong)',
        color: 'var(--ink)',
        borderRadius: 6,
        resize: 'vertical',
      }}
    />
  );
}
