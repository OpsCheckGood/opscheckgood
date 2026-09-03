import { useEffect, useMemo, useState } from 'react';
import { CURRENT_PROMOTIONS, btzPromotions } from '@/lib/data/promotion';
import type { BtzCheck, PromotionRule } from '@/lib/data/types';
import {
  formatDate,
  formatMonth,
  describeGap,
  parseIso,
  toDayNumber,
  today as clockToday,
  type CivilDate,
} from '@/lib/promotion/dates';
import {
  monthRange,
  project,
  summarize,
  type BtzResult,
  type CheckResult,
  type Milestone,
  type PathResult,
} from '@/lib/promotion/btz';
import { SourceStamp } from './SourceStamp';

/**
 * BTZ calculator.
 *
 * Everything on screen comes out of the promotion data: the grades, the two
 * routes to a fully qualified promotion, how far below the zone BTZ sits, the
 * board calendar, and the wording of every check. Nothing here knows that the
 * numbers are 36, 20, 28 and 6 -- see constraint 4 in the README.
 *
 * Three things this tool refuses to do, all of them deliberate.
 *
 * It never prints "eligible". BTZ carries promotion eligibility conditions this
 * page cannot see and ends in a board's decision, so the strongest thing it
 * says is "projected BTZ promotion, if selected".
 *
 * It never guesses an A1C date of rank. A member below that grade gets a plain
 * statement of what is missing rather than a date extrapolated from their
 * enlistment, because a confident wrong date is the failure mode that matters
 * here.
 *
 * It never presents the result as a black box. "Why this date" opens the actual
 * arithmetic -- both routes, both bounds, and which one binds.
 *
 * Visual language follows the PT calculator: flat panels, uppercase utility
 * chrome, colour only where a state means something. The one place the design
 * budget goes is the timeline, because a supervisor's real question is "when do
 * I need to do something about this Airman", and the answer is a sequence.
 *
 * ONE DELIBERATE DEVIATION from the project's constraints, the maintainer's explicit call after
 * the constraint was raised, and the same one the PT calculator makes. Do not
 * "fix" it by putting the banner back.
 *
 * Constraint 5 asks for a persistent unverified-data banner while any source is
 * a stub. The promotion data is still `status: "stub"` and this tool does not
 * render one. Provenance is still on the page and still honest: the source
 * stamp at the foot reads "Source (stub)" and names the instruction and its
 * date, and the panel beside it says these are projected dates rather than an
 * eligibility determination. Reading the rules back against AFI 36-2502 and
 * marking the file `verified` makes the two agree again.
 */

const DRAFT_KEY = 'ocg.btz.draft';

const dataset = CURRENT_PROMOTIONS;
const standards = dataset.data;
const RULES: PromotionRule[] = btzPromotions(standards);

type Mode = 'quick' | 'advanced';
/** Three states, stored as strings so an unanswered question survives JSON. */
type Answer = '' | 'yes' | 'no';

interface Draft {
  mode: Mode;
  ruleId: string;
  gradeId: string;
  enteredActiveDuty: string;
  dateOfRank: string;
  answers: Record<string, Answer>;
}

function initialDraft(): Draft {
  const rule = RULES[0]!;
  return {
    mode: 'quick',
    ruleId: rule.id,
    // Opens on the grade BTZ is actually considered from, which is the answer
    // for almost everyone who loads this page.
    gradeId: rule.fromGrade,
    enteredActiveDuty: '',
    dateOfRank: '',
    answers: {},
  };
}

const STATUS: Record<BtzResult['status'], { word: string; detail: string }> = {
  incomplete: { word: 'INCOMPLETE', detail: 'Fill in both dates' },
  'awaiting-grade': { word: 'NOT YET', detail: 'Needs the date of rank in the considered grade' },
  'not-applicable': { word: 'PAST BTZ', detail: 'Already promoted beyond the considered grade' },
  blocked: { word: 'NOT CONSIDERED', detail: 'A requirement rules BTZ out' },
  projected: { word: 'PROJECTED', detail: 'Dates below, if selected' },
};

function statusColor(status: BtzResult['status']): string {
  if (status === 'projected') return 'var(--ok)';
  if (status === 'blocked') return 'var(--bad)';
  return 'var(--ink-faint)';
}

export default function BtzCalculator() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loaded, setLoaded] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /**
   * Today, read once after mount rather than during render.
   *
   * The page is prerendered at build time, so calling the clock in a render
   * would bake the build date into the static HTML and then disagree with it
   * on hydration. Null until mounted; nothing date-dependent draws before then,
   * and with an empty draft there is nothing to draw anyway.
   */
  const [now, setNow] = useState<CivilDate | null>(null);

  // localStorage only. Dates entered here are a person's service record, and
  // constraint 2 is the reason none of it leaves the device.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setDraft({ ...initialDraft(), ...(JSON.parse(saved) as Draft) });
    } catch {
      /* Private mode, blocked storage, or a draft from an older shape. */
    }
    setNow(clockToday());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* The calculator still works; the entries simply are not remembered. */
    }
  }, [draft, loaded]);

  const rule = RULES.find((r) => r.id === draft.ruleId) ?? RULES[0]!;

  const result = useMemo(
    () =>
      project(standards, rule, {
        enteredActiveDuty: parseIso(draft.enteredActiveDuty),
        gradeId: draft.gradeId,
        dateOfRank: parseIso(draft.dateOfRank),
        answers: Object.fromEntries(
          rule.btz!.checks.map((c) => {
            const answer = draft.answers[c.id];
            return [c.id, answer === 'yes' ? true : answer === 'no' ? false : null];
          }),
        ),
        today: now ?? { year: 1970, month: 1, day: 1 },
      }),
    [draft, rule, now],
  );

  const ready = now !== null;
  const fromGrade = standards.grades.find((g) => g.id === rule.fromGrade)!;
  const attested = rule.btz!.checks.filter((c) => c.kind === 'attested');

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summarize(result, standards));
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy blocked — select and Ctrl+C');
    }
    window.setTimeout(() => setCopyNote(null), 3000);
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 sm:px-6 py-6">
      {/* ---- Member ------------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionTitle step={1} title="Member" />
          <ModeToggle mode={draft.mode} onChange={(mode) => setDraft((d) => ({ ...d, mode }))} />
          <button
            type="button"
            onClick={() => setDraft(initialDraft())}
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

        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <Field label="Date entered active duty" htmlFor="btz-dead">
            <DateBox
              id="btz-dead"
              value={draft.enteredActiveDuty}
              onChange={(v) => setDraft((d) => ({ ...d, enteredActiveDuty: v }))}
            />
          </Field>

          <Field label="Current grade" htmlFor="btz-grade">
            <Select
              id="btz-grade"
              value={draft.gradeId}
              onChange={(v) => setDraft((d) => ({ ...d, gradeId: v }))}
              width="13rem"
              options={standards.grades.map((g) => ({
                value: g.id,
                label: `${g.abbr} — ${g.label}`,
              }))}
            />
          </Field>

          {/*
            The label names the grade the date belongs to. An A1C date of rank
            and an Amn date of rank are different facts, and a generic "date of
            rank" invites entering the wrong one.
          */}
          <Field
            label={`${standards.grades.find((g) => g.id === draft.gradeId)?.abbr ?? ''} date of rank`}
            htmlFor="btz-dor"
          >
            <DateBox
              id="btz-dor"
              value={draft.dateOfRank}
              onChange={(v) => setDraft((d) => ({ ...d, dateOfRank: v }))}
            />
          </Field>

          <Field label="Time in service">
            <Readout
              value={
                ready && parseIso(draft.enteredActiveDuty)
                  ? describeGap(parseIso(draft.enteredActiveDuty)!, now!)
                  : '—'
              }
              width="10rem"
              tone="plain"
            />
          </Field>

          <Field label="Time in grade">
            <Readout
              value={
                ready && parseIso(draft.dateOfRank)
                  ? describeGap(parseIso(draft.dateOfRank)!, now!)
                  : '—'
              }
              width="10rem"
              tone="plain"
            />
          </Field>
        </div>

        <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          BTZ is considered from {fromGrade.abbr}, so the {fromGrade.abbr} date of rank is what
          drives it — not the enlistment alone. Dates stay on this device.
        </p>
      </section>

      {/* ---- Checks ------------------------------------------------------- */}
      <ChecksPanel
        step={2}
        checks={result.checks}
        mode={draft.mode}
        answers={draft.answers}
        hasQuestions={attested.length > 0}
        onAnswer={(id, answer) =>
          setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: answer } }))
        }
      />

      {/* ---- Projection --------------------------------------------------- */}
      <Projection
        step={3}
        result={result}
        ready={ready}
        now={now}
        onCopy={copySummary}
        copyNote={copyNote}
      />

      {/* ---- Timeline ----------------------------------------------------- */}
      {ready && result.timeline.length > 0 && (
        <Timeline step={4} timeline={result.timeline} now={now!} />
      )}

      {/* ---- Provenance --------------------------------------------------- */}
      <section className="panel flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
        <SourceStamp sources={[dataset.meta]} />
        <p
          className="m-0 ml-auto max-w-[42ch] text-[11px] leading-relaxed"
          style={{ color: 'var(--ink-faint)' }}
        >
          Projected dates only. Not an eligibility determination and not a selection. The
          servicing MPF and official guidance govern.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

const CONTROL = {
  background: 'var(--panel-sunk)',
  borderColor: 'var(--rule-strong)',
  color: 'var(--ink)',
} as const;

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
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label className="util" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="util">{label}</span>
      )}
      {children}
    </div>
  );
}

/**
 * A native date input. Not a set of three text boxes: the native control gets
 * the locale's own field order, a keyboard-accessible picker, and validation
 * for free, and it hands back an unambiguous ISO string.
 */
function DateBox({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width: '11rem' }}
    />
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  width,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  width: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width, maxWidth: '100%' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Readout({
  value,
  width,
  tone = 'computed',
  strong,
}: {
  value: string;
  width: string;
  tone?: 'computed' | 'plain' | 'ok' | 'warn' | 'bad';
  strong?: boolean;
}) {
  const tones = {
    computed: { background: 'var(--accent-dim)', color: 'var(--accent-strong)', border: 'var(--rule)' },
    plain: { background: 'var(--panel-raised)', color: 'var(--ink-muted)', border: 'var(--rule)' },
    ok: { background: 'var(--ok-dim)', color: 'var(--ok)', border: 'var(--ok-dim)' },
    warn: { background: 'var(--warn-dim)', color: 'var(--warn)', border: 'var(--warn-dim)' },
    bad: { background: 'var(--bad-dim)', color: 'var(--bad)', border: 'var(--bad-dim)' },
  }[tone];
  return (
    <output
      className="tabular block truncate border px-3 py-2 text-[13px]"
      style={{
        background: tones.background,
        borderColor: tones.border,
        color: tones.color,
        fontWeight: strong ? 600 : 400,
        borderRadius: 6,
        width,
        maxWidth: '100%',
      }}
    >
      {value}
    </output>
  );
}

/**
 * Quick against Advanced.
 *
 * Quick asks for the two dates and nothing else, because that is the whole
 * calculation. Advanced adds the questions the instruction attaches conditions
 * to -- none of which this tool can know on its own, and all of which change
 * the answer.
 */
function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: { id: Mode; label: string }[] = [
    { id: 'quick', label: 'Quick' },
    { id: 'advanced', label: 'Advanced' },
  ];
  return (
    <div
      role="group"
      aria-label="Detail level"
      className="flex overflow-hidden"
      style={{ border: '1px solid var(--rule-strong)', borderRadius: 6 }}
    >
      {options.map((option) => {
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className="util px-3.5 py-2"
            style={{
              background: active ? 'var(--accent)' : 'var(--panel)',
              color: active ? '#ffffff' : 'var(--ink-muted)',
              letterSpacing: '0.09em',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Marks read at a glance down the left edge: met, flagged, unanswered. */
const CHECK_MARK: Record<CheckResult['state'], { glyph: string; color: string }> = {
  pass: { glyph: '✓', color: 'var(--ok)' },
  fail: { glyph: '!', color: 'var(--bad)' },
  unanswered: { glyph: '–', color: 'var(--ink-faint)' },
};

function checkTone(check: CheckResult): { glyph: string; color: string } {
  // An advisory that failed is a flag, not a stop: prior service does not rule
  // BTZ out by itself, it means somebody has to go and look.
  if (check.state === 'fail' && check.check.mode === 'advise') {
    return { glyph: '⚠', color: 'var(--warn)' };
  }
  return CHECK_MARK[check.state];
}

function ChecksPanel({
  step,
  checks,
  mode,
  answers,
  hasQuestions,
  onAnswer,
}: {
  step: number;
  checks: CheckResult[];
  mode: Mode;
  answers: Record<string, Answer>;
  hasQuestions: boolean;
  onAnswer: (id: string, answer: Answer) => void;
}) {
  const advanced = mode === 'advanced';
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionTitle step={step} title="Eligibility checks" />
        {!advanced && hasQuestions && (
          <span className="util" style={{ letterSpacing: '0.06em' }}>
            (switch to Advanced to answer)
          </span>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-0 p-0">
        {checks.map((check, index) => {
          const tone = checkTone(check);
          return (
            <li
              key={check.check.id}
              className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3"
              style={{ borderTop: index === 0 ? 'none' : '1px solid var(--rule)' }}
            >
              <span
                aria-hidden
                className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[12px] font-bold"
                style={{ color: tone.color }}
              >
                {tone.glyph}
              </span>

              <div className="min-w-[14rem] flex-1">
                <p className="util m-0 flex flex-wrap items-baseline gap-x-2" style={{ color: 'var(--ink)' }}>
                  {check.check.label}
                  {check.check.authority && (
                    <span style={{ color: 'var(--ink-faint)', letterSpacing: '0.06em' }}>
                      {check.check.authority}
                    </span>
                  )}
                </p>
                <p
                  className="m-0 mt-1 text-[12px] leading-relaxed"
                  style={{
                    color:
                      check.state === 'fail'
                        ? check.check.mode === 'advise'
                          ? 'var(--warn)'
                          : 'var(--bad)'
                        : 'var(--ink-muted)',
                  }}
                >
                  {check.message}
                </p>
              </div>

              {advanced && check.check.kind === 'attested' && (
                <AnswerControl
                  check={check.check}
                  value={answers[check.check.id] ?? ''}
                  onChange={(answer) => onAnswer(check.check.id, answer)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AnswerControl({
  check,
  value,
  onChange,
}: {
  check: BtzCheck;
  value: Answer;
  onChange: (answer: Answer) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" style={{ minWidth: '15rem' }}>
      <label className="util" htmlFor={`btz-answer-${check.id}`}>
        {check.question}
      </label>
      <Select
        id={`btz-answer-${check.id}`}
        value={value}
        onChange={(v) => onChange(v as Answer)}
        width="8rem"
        options={[
          { value: '', label: '—' },
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function Projection({
  step,
  result,
  ready,
  now,
  onCopy,
  copyNote,
}: {
  step: number;
  result: BtzResult;
  ready: boolean;
  now: CivilDate | null;
  onCopy: () => void;
  copyNote: string | null;
}) {
  const status = STATUS[result.status];
  const color = statusColor(result.status);
  const show = ready && result.btzDate !== null;

  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SectionTitle step={step} title="Projection" />
        <div className="ml-auto flex items-center gap-3">
          {copyNote && <span className="util">{copyNote}</span>}
          <button
            type="button"
            onClick={onCopy}
            className="util flex items-center gap-2 border px-4 py-2.5"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink)',
              letterSpacing: '0.1em',
            }}
          >
            <span aria-hidden>&#9099;</span> Copy summary
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <div className="flex flex-col gap-1">
          <span className="util">Status</span>
          <output style={{ fontSize: 20, lineHeight: 1.15, fontWeight: 700, color }}>
            {status.word}
          </output>
          <span className="util" style={{ letterSpacing: '0.06em' }}>
            {status.detail}
          </span>
        </div>

        <Headline
          label="Projected BTZ promotion"
          value={show ? formatDate(result.btzDate!) : '—'}
          caption={
            show && now
              ? `If selected · ${describeGap(now, result.btzDate!)}`
              : 'If selected'
          }
          emphasis
        />

        <Headline
          label={`Fully qualified ${result.rule.label}`}
          value={show ? formatDate(result.fullyQualifiedDate!) : '—'}
          caption={show && now ? describeGap(now, result.fullyQualifiedDate!) : 'Without BTZ'}
        />

        <Headline
          label="Advance"
          value={show ? `${result.monthsEarly} months` : '—'}
          caption="Earlier than fully qualified"
        />

        <Headline
          label="Consideration window"
          value={
            show && result.cycle
              ? monthRange(result.cycle.processing.year, result.cycle.processing.months)
              : '—'
          }
          caption={
            show && result.cycle
              ? `Board ${formatMonth(result.cycle.selection.year, result.cycle.selection.month)}`
              : 'Set by the cycle'
          }
        />
      </div>

      {show && now && <AdvanceRail result={result} now={now} />}

      {result.missing.length > 0 && (
        <p className="m-0 mt-4 text-[12px]" style={{ color: 'var(--accent)' }}>
          Needs: {result.missing.join(', ')}.
        </p>
      )}

      {show && <WhyThisDate result={result} />}

      {result.notes.length > 0 && (
        <ul className="m-0 mt-4 flex list-none flex-col gap-1.5 p-0">
          {result.notes.map((note) => (
            <li
              key={note}
              className="flex gap-2 text-[12px] leading-relaxed"
              style={{ color: 'var(--ink-muted)' }}
            >
              <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
                &middot;
              </span>
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Headline({
  label,
  value,
  caption,
  emphasis,
}: {
  label: string;
  value: string;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1"
      style={emphasis ? { paddingLeft: 14, borderLeft: '2px solid var(--accent)' } : undefined}
    >
      <span className="util">{label}</span>
      <output
        className="tabular"
        style={{
          fontSize: emphasis ? 20 : 17,
          lineHeight: 1.15,
          fontWeight: emphasis ? 700 : 600,
          color: emphasis ? 'var(--accent-strong)' : 'var(--ink)',
        }}
      >
        {value}
      </output>
      <span className="util" style={{ letterSpacing: '0.06em' }}>
        {caption}
      </span>
    </div>
  );
}

/**
 * The advance, drawn to scale.
 *
 * A caliper rather than a chart: the track runs from today to the fully
 * qualified date, and the span BTZ saves is the marked band at the end. The
 * point is proportion -- how much of the wait is left against how much BTZ
 * takes off it -- which a pair of dates alone does not convey.
 */
function AdvanceRail({ result, now }: { result: BtzResult; now: CivilDate }) {
  const btz = result.btzDate!;
  const full = result.fullyQualifiedDate!;

  const start = Math.min(toDayNumber(now), toDayNumber(btz));
  const end = toDayNumber(full);
  const span = end - start;
  if (span <= 0) return null;

  const at = (date: CivilDate) =>
    Math.max(0, Math.min(100, ((toDayNumber(date) - start) / span) * 100));
  const btzAt = at(btz);

  return (
    <div className="mt-6">
      <div
        className="relative h-2.5 w-full overflow-hidden"
        style={{ background: 'var(--panel-sunk)', border: '1px solid var(--rule)', borderRadius: 3 }}
        role="img"
        aria-label={`From ${formatDate(now)}, BTZ promotion ${formatDate(btz)}, fully qualified ${formatDate(full)}, an advance of ${result.monthsEarly} months`}
      >
        {/* The wait, then the band BTZ removes. */}
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${btzAt}%`, background: 'var(--accent-dim)' }}
        />
        <div
          className="absolute inset-y-0"
          style={{ left: `${btzAt}%`, right: 0, background: 'var(--mark-dim)' }}
        />
        <div
          className="absolute inset-y-0"
          style={{ left: `${btzAt}%`, width: 2, background: 'var(--accent)' }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="util" style={{ letterSpacing: '0.06em' }}>
          Today
        </span>
        <span className="util" style={{ letterSpacing: '0.06em', color: 'var(--mark)' }}>
          {result.monthsEarly} months earlier
        </span>
        <span className="util" style={{ letterSpacing: '0.06em' }}>
          Fully qualified
        </span>
      </div>
    </div>
  );
}

/**
 * The arithmetic, on request.
 *
 * A projected promotion date that cannot be checked is a number somebody has to
 * take on faith, and nobody should take a promotion date on faith. This lays
 * out both routes, both bounds on each, which one binds, and the subtraction.
 * A native <details> so it is keyboard-operable and needs no animation.
 */
function WhyThisDate({ result }: { result: BtzResult }) {
  return (
    <details className="mt-5" style={{ borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
      <summary className="util cursor-pointer" style={{ color: 'var(--accent)' }}>
        Why this date?
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" style={{ minWidth: '34rem' }}>
          <caption className="util pb-2 text-left">
            The promotion lands on the earliest date any route allows. Each route needs all of
            its own bounds met, so it resolves to the later of them.
          </caption>
          <thead>
            <tr>
              {['Route', 'Time in service', 'Time in grade', 'Route met'].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="util px-3 py-2 text-left"
                  style={{ borderBottom: '1px solid var(--rule-strong)' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.paths.map((path) => (
              <PathRow key={path.path.id} path={path} />
            ))}
          </tbody>
        </table>
      </div>

      <dl className="m-0 mt-3 grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-[auto_1fr]">
        <dt className="util pt-[2px]">Earliest route</dt>
        <dd className="tabular m-0" style={{ color: 'var(--ink)' }}>
          {formatDate(result.fullyQualifiedDate!)} — fully qualified
        </dd>
        <dt className="util pt-[2px]">Less {result.monthsEarly} months</dt>
        <dd className="tabular m-0" style={{ color: 'var(--accent-strong)', fontWeight: 600 }}>
          {formatDate(result.btzDate!)} — projected BTZ promotion
        </dd>
      </dl>
    </details>
  );
}

function PathRow({ path }: { path: PathResult }) {
  // "binds" only means something where there is a choice between two bounds.
  // On the 28-month route, which constrains time in grade alone, the tag would
  // read as "this is the binding constraint overall" -- which it is not.
  const contested = path.tisDate !== null && path.tigDate !== null;
  const cell = (date: CivilDate | null, binds: boolean) => (
    <td
      className="tabular px-3 py-2"
      style={{
        borderBottom: '1px solid var(--rule)',
        color: binds ? 'var(--ink)' : 'var(--ink-muted)',
        fontWeight: binds ? 600 : 400,
      }}
    >
      {date === null ? '—' : formatDate(date)}
      {binds && contested && (
        <span className="util ml-2" style={{ letterSpacing: '0.06em' }}>
          binds
        </span>
      )}
    </td>
  );

  return (
    <tr style={path.governing ? { background: 'var(--mark-dim)' } : undefined}>
      <th
        scope="row"
        className="px-3 py-2 text-left font-normal"
        style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink)' }}
      >
        {path.path.label}
        {path.governing && (
          <span className="util ml-2" style={{ color: 'var(--mark)', letterSpacing: '0.06em' }}>
            earliest
          </span>
        )}
      </th>
      {cell(path.tisDate, path.binds === 'tis')}
      {cell(path.tigDate, path.binds === 'tig')}
      <td
        className="tabular px-3 py-2"
        style={{
          borderBottom: '1px solid var(--rule)',
          color: path.governing ? 'var(--mark)' : 'var(--ink-muted)',
          fontWeight: path.governing ? 700 : 400,
        }}
      >
        {path.date === null ? '—' : formatDate(path.date)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * The supervisor's answer to "when do I need to do something about this".
 *
 * A rail rather than a table: the sequence is the information. Today sits on it
 * as a node, so the next thing to do is simply the next node down, and anything
 * already behind is dimmed rather than removed -- a date that has passed is
 * still part of the story.
 *
 * Vertical at every width on purpose. A horizontal rail collides its own labels
 * on a phone, and this is a page people open on a phone in a squadron hallway.
 */
function Timeline({ step, timeline, now }: { step: number; timeline: Milestone[]; now: CivilDate }) {
  return (
    <section className="panel p-5">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionTitle step={step} title="Timeline" />
      </div>
      <p className="m-0 mb-4 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Processing and board months come from the quarterly cycle. The unit's own nomination
        suspense sits inside the processing window and is set locally.
      </p>

      <ol className="m-0 flex list-none flex-col p-0">
        {timeline.map((item, index) => {
          const isNow = item.id === 'today';
          const last = index === timeline.length - 1;
          const color = item.emphasis
            ? 'var(--accent)'
            : isNow
              ? 'var(--ink)'
              : item.past
                ? 'var(--ink-faint)'
                : 'var(--ink-muted)';

          return (
            <li key={item.id} className="flex gap-4" style={{ opacity: item.past ? 0.55 : 1 }}>
              {/* Spine: a node, and a line down to the next one. */}
              <div className="flex w-[18px] shrink-0 flex-col items-center">
                <span
                  aria-hidden
                  className="mt-[5px] block shrink-0"
                  style={{
                    width: item.emphasis ? 13 : 9,
                    height: item.emphasis ? 13 : 9,
                    borderRadius: '50%',
                    background: item.emphasis || isNow ? color : 'var(--panel)',
                    border: `2px solid ${color}`,
                  }}
                />
                {!last && (
                  <span
                    aria-hidden
                    className="w-px flex-1"
                    style={{ background: 'var(--rule-strong)', minHeight: 22 }}
                  />
                )}
              </div>

              <div className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${last ? 'pb-0' : 'pb-5'}`}>
                <output
                  className="tabular"
                  style={{
                    minWidth: '9.5rem',
                    fontSize: item.emphasis ? 15 : 13,
                    fontWeight: item.emphasis ? 700 : 600,
                    color,
                  }}
                >
                  {item.display}
                </output>

                <div className="min-w-[12rem] flex-1">
                  <p className="util m-0" style={{ color: item.emphasis ? 'var(--accent)' : undefined }}>
                    {item.label}
                    {item.local && (
                      <span className="ml-2" style={{ color: 'var(--warn)' }}>
                        local timeline may differ
                      </span>
                    )}
                  </p>
                  {item.detail && (
                    <p
                      className="m-0 mt-1 text-[12px] leading-relaxed"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {item.detail}
                    </p>
                  )}
                </div>

                {!isNow && (
                  <span className="util" style={{ letterSpacing: '0.06em' }}>
                    {describeGap(now, item.at)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
