import { useEffect, useMemo, useState } from 'react';
import { CURRENT_STANDARDS } from '@/lib/data/pt';
import type { ComponentDefinition, EventDefinition, Sex } from '@/lib/data/types';
import {
  chartFor,
  combineTime,
  formatInches,
  formatTime,
  parseNumber,
  ratioChart,
  score,
  walkMaxSeconds,
  type BfaOutcome,
  type ComponentEntry,
  type ComponentResult,
  type PtInput,
  type PtResult,
  type Rating,
} from '@/lib/pt/score';
import { SourceStamp } from './SourceStamp';

/**
 * PT calculator.
 *
 * Everything on screen is read out of the standards data: the components, the
 * events each one offers, the input captions, the chart, the pass and
 * excellent thresholds. Nothing here knows what a push-up is. Adding an event
 * or a new AFMAN edition is a data edit -- see constraint 4 in the README.
 *
 * Ported from the maintainer's fillable PDF, and checked against it: the
 * differential test in tests/pt-score.test.ts scores several hundred cases
 * through both this engine and the PDF's own script and compares the answers.
 *
 * Visual language follows Bullet Bench: mono, uppercase utility chrome, flat
 * charcoal panels, colour only where a state means something. The one place
 * that spends any budget is the scoring chart, because that is what a user
 * actually stares at -- the row you landed on is marked in gold, as in the
 * source PDF.
 *
 * Two DELIBERATE DEVIATIONS from the project's constraints, both the maintainer's explicit
 * call after the constraint was raised. Neither is an oversight; do not "fix"
 * either by putting the removed text back.
 *
 * Constraint 2 asks each tool to carry a visible note saying the entries stay
 * on the device. This tool no longer prints one. The behaviour is unchanged --
 * entries go to localStorage and nowhere else, and the offline copy still says
 * so in its own footer -- but on the hosted page the closest thing left is the
 * layout footer's "Everything runs in your browser".
 *
 * Constraint 5 asks for a persistent unverified-data banner while any source
 * is a stub. The standards data is still `status: "stub"` and this tool does
 * not render one. Provenance is still on the page: the source stamp at the
 * foot reads "Source (stub)". Marking the data `verified`, once the tables
 * have been checked against AFMAN 36-2905 itself, makes the two agree again.
 */

const DRAFT_KEY = 'ocg.pt.draft';

/** Free-text input state, keyed so a component can hold several boxes. */
type Boxes = Record<string, string>;

interface Draft {
  age: string;
  sex: Sex;
  trackId: string;
  events: Record<string, string>;
  exempt: Record<string, boolean>;
  boxes: Boxes;
}

const dataset = CURRENT_STANDARDS;
const standards = dataset.data;

function initialDraft(): Draft {
  return {
    age: '',
    sex: 'male',
    trackId: standards.tracks[0]!.id,
    events: Object.fromEntries(standards.components.map((c) => [c.id, c.events[0]!.id])),
    exempt: {},
    boxes: {},
  };
}

/**
 * The rating, split so the verdict reads at a glance and the reason sits under
 * it. "UNSATISFACTORY" is the headline; why it is unsatisfactory is the detail,
 * and running both into one string makes both harder to read at this size.
 */
const RATING: Record<Rating, { word: string; detail: string }> = {
  excellent: { word: 'EXCELLENT', detail: 'Ready' },
  satisfactory: { word: 'SATISFACTORY', detail: 'Ready' },
  unsatisfactory: { word: 'UNSATISFACTORY', detail: 'Not ready' },
  'component-fail': { word: 'UNSATISFACTORY', detail: 'Not ready — component minimum missed' },
  'no-score': { word: 'NO SCORE', detail: 'PFRA hold — every component exempt' },
};

/**
 * Colours the risk readout by which band it is, without hard-coding the band
 * names: the first band in the data is the good one, the last is the bad one,
 * and anything between is a warning.
 */
function riskTone(label: string | null): 'ok' | 'warn' | 'bad' | 'plain' {
  const bands = standards.components.find((c) => c.kind === 'ratio')?.riskBands ?? [];
  const index = bands.findIndex((b) => b.label === label);
  if (index < 0) return 'plain';
  if (index === 0) return 'ok';
  return index === bands.length - 1 ? 'bad' : 'warn';
}

function ratingTone(rating: Rating): 'ok' | 'bad' | 'plain' {
  if (rating === 'excellent' || rating === 'satisfactory') return 'ok';
  return rating === 'no-score' ? 'plain' : 'bad';
}

function ratingColor(rating: Rating | null): string {
  if (rating === 'excellent' || rating === 'satisfactory') return 'var(--ok)';
  if (rating === null || rating === 'no-score') return 'var(--ink-faint)';
  return 'var(--bad)';
}

export default function PtCalculator() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loaded, setLoaded] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // localStorage only. Read after mount so the static markup and the first
  // client render agree; see constraint 2 in the README -- nothing is uploaded.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setDraft({ ...initialDraft(), ...(JSON.parse(saved) as Draft) });
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
      /* The calculator still works; the entries simply are not remembered. */
    }
  }, [draft, loaded]);

  const setBox = (key: string, value: string) =>
    setDraft((d) => ({ ...d, boxes: { ...d.boxes, [key]: value } }));

  const eventFor = (component: ComponentDefinition): EventDefinition =>
    component.events.find((e) => e.id === draft.events[component.id]) ?? component.events[0]!;

  const input: PtInput = useMemo(() => {
    const entries: Record<string, ComponentEntry> = {};
    for (const component of standards.components) {
      const event = eventFor(component);
      const box = (suffix: string) => draft.boxes[`${component.id}.${suffix}`] ?? '';

      let value: number | null = null;
      if (event.input === 'time') value = combineTime(box('min'), box('sec'));
      else if (event.input === 'count') value = parseNumber(box('value'));

      entries[component.id] = {
        eventId: event.id,
        exempt: draft.exempt[component.id] === true,
        value,
        heightIn: event.input === 'waist' ? parseNumber(box('height')) : undefined,
        waists:
          event.input === 'waist'
            ? [parseNumber(box('w1')), parseNumber(box('w2')), parseNumber(box('w3'))]
            : undefined,
      };
    }
    // The tape sites live in the same box map, keyed by site id, so switching
    // sex keeps the neck measurement and picks up the sites that sex is taped at.
    const bodyFat: Record<string, number | null> = {};
    for (const site of standards.bodyFat?.bySex[draft.sex]?.sites ?? []) {
      bodyFat[site.id] = parseNumber(draft.boxes[`bfa.${site.id}`] ?? '');
    }

    return {
      age: parseNumber(draft.age),
      sex: draft.sex,
      trackId: draft.trackId,
      entries,
      bodyFat,
    };
  }, [draft]);

  const result: PtResult = useMemo(() => score(standards, input), [input]);
  const byComponent = useMemo(
    () => new Map(result.components.map((c) => [c.componentId, c])),
    [result],
  );

  const track = standards.tracks.find((t) => t.id === draft.trackId) ?? standards.tracks[0]!;

  async function copySummary() {
    const rating = result.rating ? RATING[result.rating] : null;
    const text = [
      `PT SCORE — ${standards.label}`,
      `Age ${draft.age || '—'} · ${draft.sex === 'female' ? 'Female' : 'Male'} · ${track.label}` +
        (result.ageGroup && !result.neutral ? ` · ${result.ageGroup.label}` : ''),
      '',
      ...result.components.map(
        (c) =>
          `${c.label} (${c.event.label}): ${c.display || '—'}` +
          (c.minimumDisplay ? `   min ${c.minimumDisplay}` : ''),
      ),
      '',
      `Composite: ${result.percent === null ? '—' : result.percent.toFixed(1)} / 100`,
      `Rating: ${rating ? `${rating.word} — ${rating.detail}` : '—'}`,
      ...(result.bfa.required
        ? [
            '',
            `${standards.bodyFat?.label ?? 'Tier 2 body fat assessment'}: ${result.bfa.requirement}`,
            ...result.bfa.assessment.measurements.map(
              (m) =>
                `${m.site.label}: ${m.raw === null ? '—' : m.raw} in` +
                (m.rounded === null ? '' : ` (uses ${formatInches(m.rounded)})`),
            ),
            `Circumference: ${result.bfa.assessment.circumference === null ? '—' : formatInches(result.bfa.assessment.circumference)}`,
            `Body fat: ${result.bfa.assessment.percent === null ? '—' : `${result.bfa.assessment.percent}%`}` +
              (result.bfa.assessment.standard ? ` (${result.bfa.assessment.standard.standardLabel})` : ''),
            `Result: ${result.bfa.assessment.result === null ? '—' : result.bfa.assessment.result.toUpperCase()}`,
          ]
        : []),
      ...(result.notes.length ? ['', ...result.notes.map((n) => `- ${n}`)] : []),
      '',
      'Unofficial worksheet. Official scores are the ones in myFitness on AF Form 4446.',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy blocked — select and Ctrl+C');
    }
    window.setTimeout(() => setCopyNote(null), 3000);
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-3 sm:px-6 py-6">
      {/* ---- Personal information ---------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SectionTitle step={1} title="Personal information" />
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
          <Field label="Age (yrs)" htmlFor="pt-age">
            <TextBox
              id="pt-age"
              value={draft.age}
              onChange={(v) => setDraft((d) => ({ ...d, age: v }))}
              width="5.5rem"
            />
          </Field>

          <Field label="Sex" htmlFor="pt-sex">
            <Select
              id="pt-sex"
              value={draft.sex}
              onChange={(v) => setDraft((d) => ({ ...d, sex: v as Sex }))}
              width="9rem"
              options={standards.sexes.map((s) => ({ value: s.id, label: s.label }))}
            />
          </Field>

          <Field label="Standards" htmlFor="pt-track">
            <Select
              id="pt-track"
              value={draft.trackId}
              onChange={(v) => setDraft((d) => ({ ...d, trackId: v }))}
              width="13rem"
              options={standards.tracks.map((t) => ({ value: t.id, label: t.label }))}
            />
          </Field>

          <Field label="Age group">
            <Readout
              value={track.neutral ? 'Age and sex neutral' : (result.ageGroup?.label ?? '—')}
              width="10rem"
              tone="plain"
            />
          </Field>
        </div>
      </section>

      {/* ---- One panel per component ------------------------------------- */}
      {standards.components.map((component, index) => (
        <ComponentPanel
          key={component.id}
          step={index + 2}
          component={component}
          event={eventFor(component)}
          result={byComponent.get(component.id)}
          exempt={draft.exempt[component.id] === true}
          boxes={draft.boxes}
          age={input.age}
          sex={draft.sex}
          whtr={result.whtr}
          waist={result.waist}
          riskLabel={result.riskLabel}
          onEvent={(eventId) =>
            setDraft((d) => ({ ...d, events: { ...d.events, [component.id]: eventId } }))
          }
          onExempt={(value) =>
            setDraft((d) => ({ ...d, exempt: { ...d.exempt, [component.id]: value } }))
          }
          onBox={setBox}
        />
      ))}

      <Composite result={result} onCopy={copySummary} copyNote={copyNote} />

      {standards.bodyFat && (
        <Tier2Panel
          bfa={result.bfa}
          rating={result.rating}
          whtr={result.whtr}
          boxes={draft.boxes}
          onBox={setBox}
        />
      )}

      <Charts result={result} selected={draft.events} sex={draft.sex} />

      <section className="panel p-4">
        <SourceStamp sources={[dataset.meta]} />
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

/**
 * A numbered section heading.
 *
 * The steps are what turn five similar panels into an order of operations --
 * you fill them top to bottom, and the number tells you where you are without
 * reading any of the labels.
 */
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

function TextBox({
  id,
  value,
  onChange,
  width,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  width: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular border px-3 py-2 text-[12.5px]"
      style={{ ...CONTROL, width }}
    />
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  width,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  width: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="border px-3 py-2 text-[12.5px]"
      style={{ ...CONTROL, width, maxWidth: '100%', opacity: disabled ? 0.5 : 1 }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A computed value. Same shape as an input so a row of them stays on one line,
 * but tinted rather than white: at a glance you can tell what you type from
 * what the calculator worked out.
 *
 * `tone` colours the whole box for values that carry a state of their own --
 * the risk band, and a component that failed its minimum.
 */
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
      className="tabular block truncate border px-3 py-2 text-[12.5px]"
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

// ---------------------------------------------------------------------------
// Component panels
// ---------------------------------------------------------------------------

function ComponentPanel({
  step,
  component,
  event,
  result,
  exempt,
  boxes,
  age,
  sex,
  whtr,
  waist,
  riskLabel,
  onEvent,
  onExempt,
  onBox,
}: {
  step: number;
  component: ComponentDefinition;
  event: EventDefinition;
  result: ComponentResult | undefined;
  exempt: boolean;
  boxes: Boxes;
  age: number | null;
  sex: Sex;
  whtr: number | null;
  waist: number | null;
  riskLabel: string | null;
  onEvent: (id: string) => void;
  onExempt: (value: boolean) => void;
  onBox: (key: string, value: string) => void;
}) {
  const box = (suffix: string) => boxes[`${component.id}.${suffix}`] ?? '';
  const key = (suffix: string) => `${component.id}.${suffix}`;
  const walkMax =
    event.kind === 'passFail' && age !== null ? walkMaxSeconds(standards, event, age, sex) : null;

  const failed =
    result?.status === 'fail' || (result?.status === 'below-minimum' && result.points === 0);
  const passed = result?.status === 'pass';

  const minimumText = exempt
    ? 'Not scored'
    : walkMax !== null
      ? `${formatTime(walkMax)} max`
      : result?.minimumDisplay
        ? result.minimumDisplay + (event.input === 'count' && event.unit ? ` ${event.unit}` : '')
        : '—';

  return (
    <section className="panel p-5" style={{ opacity: exempt ? 0.72 : 1 }}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionTitle step={step} title={component.label} />
        <span className="util" style={{ letterSpacing: '0.06em' }}>
          ({component.maxPoints} points)
        </span>
        <label className="util ml-auto flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={exempt}
            onChange={(e) => onExempt(e.target.checked)}
            aria-label={`${component.label} exempt`}
          />
          Exempt
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        {component.events.length > 1 && (
          <Field label="Event" htmlFor={`${component.id}-event`}>
            <Select
              id={`${component.id}-event`}
              value={event.id}
              disabled={exempt}
              onChange={onEvent}
              width="14rem"
              options={component.events.map((e) => ({ value: e.id, label: e.label }))}
            />
          </Field>
        )}

        {!exempt && event.input === 'waist' && (
          <>
            <Field label="Height (in)" htmlFor={key('height')}>
              <TextBox
                id={key('height')}
                value={box('height')}
                onChange={(v) => onBox(key('height'), v)}
                width="5.5rem"
              />
            </Field>
            <Field label="Waist (in)">
              <div className="flex gap-2">
                {(['w1', 'w2', 'w3'] as const).map((slot, i) => (
                  <TextBox
                    key={slot}
                    ariaLabel={`Waist measurement ${i + 1}`}
                    value={box(slot)}
                    onChange={(v) => onBox(key(slot), v)}
                    width="4.5rem"
                  />
                ))}
              </div>
            </Field>
            <Field label="Waist used">
              <Readout value={waist === null ? '—' : waist.toFixed(1)} width="5.5rem" />
            </Field>
            <Field label="Waist ÷ height">
              <Readout value={whtr === null ? '—' : whtr.toFixed(2)} width="5.5rem" />
            </Field>
            <Field label="Risk">
              <Readout
                value={riskLabel ?? '—'}
                width="9rem"
                tone={riskTone(riskLabel)}
              />
            </Field>
          </>
        )}

        {!exempt && event.input === 'count' && (
          <Field label={event.unitLabel ?? 'Reps'} htmlFor={key('value')}>
            <TextBox
              id={key('value')}
              value={box('value')}
              onChange={(v) => onBox(key('value'), v)}
              width="6.5rem"
            />
          </Field>
        )}

        {!exempt && event.input === 'time' && (
          <Field label={event.unitLabel ?? 'Min:sec'}>
            <div className="flex items-center gap-2">
              <TextBox
                ariaLabel={`${event.label} minutes`}
                value={box('min')}
                onChange={(v) => onBox(key('min'), v)}
                width="4rem"
              />
              <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
                :
              </span>
              <TextBox
                ariaLabel={`${event.label} seconds`}
                value={box('sec')}
                onChange={(v) => onBox(key('sec'), v)}
                width="4rem"
              />
            </div>
          </Field>
        )}

        <Field label={`Points / ${component.maxPoints}`}>
          <Readout
            value={result?.display || '—'}
            width="6.5rem"
            strong
            tone={failed ? 'bad' : passed ? 'ok' : 'computed'}
          />
        </Field>

        <Field label="Minimum to pass">
          <Readout value={minimumText} width="10rem" tone="plain" />
        </Field>
      </div>

      {!exempt && event.input === 'waist' && (
        <p className="m-0 mt-3 text-[11.5px]" style={{ color: 'var(--accent)' }}>
          Waist is the average of 3 measurements, rounded down to the half inch
          (para 3.15.4.5).
        </p>
      )}

      {/* The points above still stand -- they simply stopped counting, and
          saying which is the difference between a readout and an explanation. */}
      {result?.droppedByBfa && (
        <p className="m-0 mt-2 text-[11.5px]" style={{ color: 'var(--ok)' }}>
          Body fat assessment met — these points are not counted, on either side of the
          composite (para 3.7.2).
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/**
 * The composite gauge.
 *
 * The thresholds are drawn as marks on the bar rather than written into a
 * sentence, because what a user wants to know at a glance is which side of
 * them they are on. Both come from the data, not from constants here.
 */
function Composite({
  result,
  onCopy,
  copyNote,
}: {
  result: PtResult;
  onCopy: () => void;
  copyNote: string | null;
}) {
  const { passMinPercent, excellentMinPercent } = standards.rating;
  const percent = result.percent;
  const color = ratingColor(result.rating);
  const rating = result.rating ? RATING[result.rating] : null;

  return (
    <section className="panel p-4">
      <h2 className="title m-0 mb-3">Composite result</h2>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <ScoreRing percent={percent} color={color} />

        <div className="flex flex-col gap-1">
          <span className="util">Rating</span>
          <output style={{ fontSize: 22, lineHeight: 1.15, fontWeight: 700, color }}>
            {rating ? rating.word : 'INCOMPLETE'}
          </output>
          <span className="util" style={{ letterSpacing: '0.06em' }}>
            {rating ? rating.detail : 'Fill every box'}
          </span>
        </div>

        {/* Only worth showing when the composite is prorated -- at the full
            100 it just repeats the ring. */}
        {result.possible > 0 && result.possible < 100 && (
          <div
            className="flex flex-col gap-1.5 pl-8"
            style={{ borderLeft: '1px solid var(--rule)' }}
          >
            <span className="util">Scored on</span>
            <output className="tabular text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {result.earned.toFixed(1)} / {result.possible} pts
            </output>
          </div>
        )}

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

      <div className="mt-5">
        <div
          className="relative h-2.5 w-full overflow-hidden"
          style={{
            background: 'var(--panel-sunk)',
            border: '1px solid var(--rule)',
            borderRadius: 3,
          }}
          role="img"
          aria-label={
            percent === null
              ? 'No composite score yet'
              : `${percent.toFixed(1)} of 100, pass at ${passMinPercent}, excellent at ${excellentMinPercent}`
          }
        >
          {percent !== null && (
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
            />
          )}
          {[passMinPercent, excellentMinPercent].map((mark) => (
            <div
              key={mark}
              className="absolute inset-y-0"
              style={{ left: `${mark}%`, width: 2, background: 'var(--ground)' }}
            />
          ))}
        </div>

        {/* Scale, with each threshold sitting under its own mark. */}
        <div className="relative mt-1.5 h-4">
          <span className="util absolute left-0" style={{ letterSpacing: '0.06em' }}>
            0
          </span>
          {([[passMinPercent, 'pass'], [excellentMinPercent, 'excellent']] as const).map(
            ([mark, name]) => (
              <span
                key={name}
                className="util absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${mark}%`, letterSpacing: '0.06em' }}
              >
                {mark} {name}
              </span>
            ),
          )}
          <span className="util absolute right-0" style={{ letterSpacing: '0.06em' }}>
            100
          </span>
        </div>
      </div>

      {result.notes.length > 0 && (
        <ul className="m-0 mt-4 flex list-none flex-col gap-1.5 p-0">
          {result.notes.map((note) => (
            <li
              key={note}
              className="flex gap-2 text-[11.5px] leading-relaxed"
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

// ---------------------------------------------------------------------------
// Tier 2 body fat assessment
// ---------------------------------------------------------------------------

/**
 * The tape worksheet.
 *
 * It stays shut until the entries above actually call for one, which is how
 * the source PDF handles it and is worth keeping: a body fat number nobody has
 * to produce is one more thing to worry about, and the tool should not invite
 * somebody to work one out when the answer changes nothing.
 *
 * When it is required, it is not a second calculator -- it feeds straight back
 * into the composite above. A pass takes body composition out of the score
 * entirely; a fail makes the assessment unsatisfactory whatever the points
 * say. Both are stated here in those words rather than left to be inferred
 * from a number moving.
 */
function Tier2Panel({
  bfa,
  rating,
  whtr,
  boxes,
  onBox,
}: {
  bfa: BfaOutcome;
  rating: Rating | null;
  whtr: number | null;
  boxes: Boxes;
  onBox: (key: string, value: string) => void;
}) {
  const rules = standards.bodyFat!;
  const { assessment } = bfa;
  const standard = assessment.standard;
  const passed = assessment.result === 'pass';
  const failed = assessment.result === 'fail';

  return (
    <section className="panel p-5" style={{ opacity: bfa.required ? 1 : 0.72 }}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="title m-0">{rules.label}</h2>
        <span
          className="util border px-2 py-1"
          style={{
            borderColor: bfa.required ? 'var(--warn-dim)' : 'var(--rule)',
            background: bfa.required ? 'var(--warn-dim)' : 'var(--panel-raised)',
            color: bfa.required ? 'var(--warn)' : 'var(--ink-faint)',
            letterSpacing: '0.09em',
          }}
        >
          {bfa.required ? 'Required' : 'Not required'}
        </span>
      </div>

      {/* What the entries above decided, which is the whole reason this panel
          is open or shut. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Field label="Waist ÷ height">
          <Readout value={whtr === null ? '—' : whtr.toFixed(2)} width="5.5rem" />
        </Field>
        <Field label="Assessment result">
          <Readout
            value={rating ? RATING[rating].word : '—'}
            width="12rem"
            tone={rating === null ? 'plain' : ratingTone(rating)}
          />
        </Field>
        <Field label="Tier 2 required?">
          <Readout
            value={bfa.requirement}
            width="24rem"
            tone={bfa.required ? 'warn' : 'plain'}
          />
        </Field>
      </div>

      {bfa.required && standard ? (
        <>
          <div
            className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 pt-5"
            style={{ borderTop: '1px solid var(--rule)' }}
          >
            {standard.sites.map((site) => {
              const measured = assessment.measurements.find((m) => m.site.id === site.id);
              return (
                <Field key={site.id} label={`${site.label} (in)`} htmlFor={`bfa-${site.id}`}>
                  <TextBox
                    id={`bfa-${site.id}`}
                    value={boxes[`bfa.${site.id}`] ?? ''}
                    onChange={(v) => onBox(`bfa.${site.id}`, v)}
                    width="6rem"
                  />
                  {/* The rounded value, because the rounding is what is used
                      and it does not always go the way you would expect. */}
                  <span className="util" style={{ letterSpacing: '0.06em' }}>
                    {measured?.rounded === null || measured === undefined
                      ? '—'
                      : `uses ${formatInches(measured.rounded)}`}
                  </span>
                </Field>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Circumference">
              <Readout
                value={assessment.circumference === null ? '—' : formatInches(assessment.circumference)}
                width="7rem"
              />
            </Field>
            <Field label="Height used">
              <Readout
                value={assessment.heightIn === null ? '—' : formatInches(assessment.heightIn)}
                width="7rem"
              />
            </Field>
            <Field label="Body fat">
              <Readout
                value={assessment.percent === null ? '—' : `${assessment.percent} %`}
                width="6rem"
                strong
                tone={failed ? 'bad' : passed ? 'ok' : 'computed'}
              />
            </Field>
            <Field label="Standard">
              <Readout value={standard.standardLabel} width="9rem" tone="plain" />
            </Field>
            <Field label="Result">
              <Readout
                value={assessment.result === null ? '—' : assessment.result.toUpperCase()}
                width="7rem"
                strong
                tone={failed ? 'bad' : passed ? 'ok' : 'plain'}
              />
            </Field>
          </div>

          <p className="m-0 mt-4 text-[12px] leading-relaxed" style={{ color: 'var(--ink)' }}>
            {bfa.effect}
          </p>

          {assessment.need && (
            <p className="m-0 mt-2 text-[11.5px]" style={{ color: 'var(--accent)' }}>
              {assessment.need}
            </p>
          )}
          {assessment.crossCheck && (
            <p className="m-0 mt-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              {assessment.crossCheck}
            </p>
          )}

          <p
            className="m-0 mt-4 text-[11.5px]"
            style={{ color: 'var(--ink-muted)' }}
          >
            Formula: {standard.formulaLabel}.
          </p>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {rules.siteNotes.map((note) => (
              <li
                key={note}
                className="flex gap-2 text-[11.5px] leading-relaxed"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
                  &middot;
                </span>
                {note}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-3 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
            A Tier 2 assessment is administered by the FAC or MFL, and the official result is the
            one they record.
          </p>
        </>
      ) : (
        <p className="m-0 mt-4 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {bfa.effect}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The scoring chart
// ---------------------------------------------------------------------------

/**
 * The composite as a ring.
 *
 * A number alone does not say how close you are to the next rating; a ring
 * that is two thirds full does, before you have read the number in it. Drawn
 * as an SVG arc so it stays crisp and needs no images -- constraint 1.
 */
function ScoreRing({ percent, color }: { percent: number | null; color: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;

  return (
    <div className="relative flex h-[86px] w-[86px] shrink-0 items-center justify-center">
      <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden className="-rotate-90">
        <circle cx="43" cy="43" r={radius} fill="none" stroke="var(--rule)" strokeWidth="6" />
        {filled > 0 && (
          <circle
            cx="43"
            cy="43"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
          />
        )}
      </svg>
      <span className="absolute flex flex-col items-center leading-none">
        <span className="tabular text-[19px] font-bold" style={{ color }}>
          {percent === null ? '—' : percent.toFixed(1)}
        </span>
        <span className="util mt-0.5" style={{ letterSpacing: '0.06em' }}>
          / 100
        </span>
      </span>
    </div>
  );
}

/**
 * Components sharing a point ladder share a chart, which is how the source
 * lays it out: upper body and core both run 15.0 down to 2.5, so they read as
 * one table with a column per event.
 */
function Charts({
  result,
  selected,
  sex,
}: {
  result: PtResult;
  selected: Record<string, string>;
  sex: Sex;
}) {
  const ladders = new Map<string, { component: ComponentDefinition; event: EventDefinition }[]>();
  for (const component of standards.components) {
    if (component.kind !== 'table' || !component.ladder) continue;
    const list = ladders.get(component.ladder) ?? [];
    for (const event of component.events) {
      if (event.kind === 'table') list.push({ component, event });
    }
    ladders.set(component.ladder, list);
  }

  const body = standards.components.find((c) => c.kind === 'ratio');
  const bodyRow = body
    ? (result.components.find((c) => c.componentId === body.id)?.rowIndex ?? null)
    : null;

  /**
   * Without an age there is no column to draw on the standard track.
   *
   * Drawing one anyway is the one thing this must not do: `standardsColumn`
   * treats a null column as the neutral one, so the tables would quietly fill
   * with AFSPECWAR/EOD numbers under a heading asking for an age.
   */
  const hasColumn = result.neutral || result.column !== null;

  return (
    <section className="panel p-4">
      <h2 className="title m-0 mb-1.5">Your scoring chart</h2>
      <p className="util m-0 mb-4" style={{ letterSpacing: '0.06em' }}>
        {result.neutral
          ? 'AFSPECWAR / EOD — age and sex neutral'
          : result.ageGroup
            ? `${standards.sexes.find((s) => s.id === sex)?.label ?? ''} · age ${result.ageGroup.label}`
            : 'Enter an age to load your scoring chart for your age group.'}
      </p>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-7">
        {hasColumn &&
          [...ladders.entries()].map(([ladderKey, entries]) => (
            <LadderChart
              key={ladderKey}
              ladderKey={ladderKey}
              entries={entries}
              result={result}
              selected={selected}
            />
          ))}

        {body && (
          <ChartTable
            caption="Waist-to-height ratio — all ages"
            headers={['waist ÷ height']}
            ladder={(body.ladderRows ?? []).map((r) => r.points)}
            columns={[{ rows: ratioChart(body), hit: bodyRow }]}
          />
        )}
      </div>

      {hasColumn && (
        <ul className="m-0 mt-5 flex list-none flex-col gap-1 p-0">
          {standards.chartNotes.map((note) => (
            <li
              key={note}
              className="text-[11px] leading-relaxed"
              style={{ color: 'var(--ink-faint)' }}
            >
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LadderChart({
  ladderKey,
  entries,
  result,
  selected,
}: {
  ladderKey: string;
  entries: { component: ComponentDefinition; event: EventDefinition }[];
  result: PtResult;
  selected: Record<string, string>;
}) {
  const ladder = standards.pointLadders[ladderKey] ?? [];
  const caption = entries
    .map((e) => e.component.shortLabel)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' + ');

  const columns = entries.map(({ component, event }) => ({
    // "Push-up (reps)", "Plank (min:sec)" -- the unit belongs in the header so
    // the cells can stay bare numbers.
    header: `${event.shortLabel}${event.unitLabel ? ` (${event.unitLabel.toLowerCase()})` : ''}`,
    rows: chartFor(standards, component, event, result.column),
    // Only mark the column the user is actually being assessed on.
    hit:
      selected[component.id] === event.id
        ? (result.components.find((c) => c.componentId === component.id)?.rowIndex ?? null)
        : null,
  }));

  return (
    <ChartTable
      caption={caption}
      headers={columns.map((c) => c.header)}
      ladder={ladder}
      columns={columns}
    />
  );
}

/**
 * One chart table.
 *
 * The row you scored is marked in gold, as in the source PDF -- per cell, not
 * per row, because two components share a table and you are assessed on only
 * one column of each.
 */
function ChartTable({
  caption,
  headers,
  ladder,
  columns,
}: {
  caption: string;
  headers: string[];
  ladder: number[];
  columns: { rows: { value: string; isMinimum: boolean }[]; hit: number | null }[];
}) {
  // The three charts share one row, split in proportion to how many columns
  // each carries, and each keeps a floor wide enough for its own headers so
  // the row wraps rather than crushing one of them.
  const width = headers.length + 1;
  return (
    <div style={{ flex: `${width} 1 0`, minWidth: `${width * 5.5}rem` }}>
      {/* Reserves two lines so a caption that wraps does not push its table
          out of line with the two beside it. */}
      <div className="mb-2.5 flex" style={{ minHeight: '2.9em' }}>
        <span
          className="util inline-block rounded-full px-3 py-1.5 text-left"
          style={{
            background: 'var(--accent-dim)',
            color: 'var(--accent-strong)',
            letterSpacing: '0.08em',
          }}
        >
          {caption}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="tabular w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {['Pts', ...headers].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="util border-b px-3 pb-2 text-right align-bottom"
                  // A fixed header height, bottom-aligned: some headers wrap to
                  // two lines and some do not, and without this the three
                  // tables beside each other start their rows at three
                  // different heights.
                  style={{ borderColor: 'var(--rule-strong)', height: '3.4em' }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ladder.map((points, i) => {
              const marked = columns.some((c) => c.hit === i);
              return (
                <tr key={points}>
                  <td
                    className="border-b px-3 py-1.5 text-right"
                    style={{
                      borderColor: 'var(--rule)',
                      color: marked ? 'var(--mark)' : 'var(--ink-faint)',
                      fontWeight: marked ? 600 : 400,
                    }}
                  >
                    {points.toFixed(1)}
                  </td>
                  {columns.map((column, c) => {
                    const hit = column.hit === i;
                    const row = column.rows[i];
                    return (
                      <td
                        key={c}
                        className="border-b px-3 py-1.5 text-right"
                        style={{
                          borderColor: 'var(--rule)',
                          background: hit ? 'var(--mark-dim)' : undefined,
                          color: hit ? 'var(--mark)' : 'var(--ink)',
                          fontWeight: hit ? 600 : 400,
                        }}
                      >
                        {row ? `${row.value}${row.isMinimum ? '*' : ''}` : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
