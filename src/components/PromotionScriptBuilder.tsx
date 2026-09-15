import { useEffect, useMemo, useState } from 'react';
import { CEREMONY } from '@/lib/data/ceremony';
import {
  GREETINGS,
  PRONOUNS,
  buildScript,
  chargeFor,
  emptyInput,
  isEmpty,
  scriptToText,
  type Block,
  type CeremonyInput,
} from '@/lib/promotion/ceremony';
import { printScript } from '@/lib/promotion/ceremony-print';
import { downloadBytes, promotionBuilderPdf } from '@/lib/pdfform/downloads';
import { SourceStamp } from './SourceStamp';

/**
 * Promotion Script Builder.
 *
 * The people go in, the run of show comes out: opening, the charge when the
 * new grade enters a tier that has one, and the closing. It descends from a
 * fillable PDF one squadron built for itself, with the squadron taken out:
 * the unit, the nickname the emcee uses for everyone from it, and every role
 * are fields, and any role left blank simply has no lines.
 *
 * The charges are data, marked stub until read back against the published
 * text. The rest of the wording is ceremony convention, so the built script is
 * meant to be copied and edited rather than treated as a form.
 */

const DRAFT_KEY = 'ocg.promotion-script.draft.v1';

const dataset = CEREMONY;
const data = dataset.data;

export default function PromotionScriptBuilder() {
  const [input, setInput] = useState<CeremonyInput>(() => emptyInput(data));
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Names of a member's family are exactly the kind of thing constraint 2 is
  // for: localStorage only, nothing leaves the device.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved) as Partial<CeremonyInput>;
        setInput({ ...emptyInput(data), ...parsed });
      }
    } catch {
      /* Private mode, blocked storage, or a draft from an older shape. */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(input));
    } catch {
      /* The builder still works; the entries simply are not remembered. */
    }
  }, [input, loaded]);

  const update = (patch: Partial<CeremonyInput>) => setInput((i) => ({ ...i, ...patch }));

  const sections = useMemo(() => buildScript(data, input), [input]);
  const charge = chargeFor(data, input);
  const blank = isEmpty(input);
  const newGrade = data.grades.find((g) => g.id === input.newGradeId) ?? data.grades[0]!;

  function flash(text: string) {
    setNote(text);
    window.setTimeout(() => setNote(null), 3000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(scriptToText(sections));
      flash('Copied');
    } catch {
      flash('Copy blocked — select and Ctrl+C');
    }
  }

  /** The builder as a locked, fillable PDF: blank, or carrying what is on the page. */
  async function downloadPdf(withEntries: boolean) {
    const bytes = await promotionBuilderPdf(withEntries ? input : null, data);
    downloadBytes(bytes, withEntries ? 'promotion-script-draft.pdf' : 'promotion-script-builder.pdf');
    flash('PDF builder downloaded. Open it in Acrobat or Reader.');
  }

  function print() {
    const w = window.open('', '_blank');
    if (!w) {
      flash('Your browser blocked the print window. Allow pop-ups for this page, then try again.');
      return;
    }
    w.document.write(printScript(input, sections));
    w.document.close();
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-3 sm:px-6 py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-4 min-w-0">
        {/* ---- Ceremony --------------------------------------------------- */}
        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <SectionTitle step={1} title="Ceremony" />
            <button
              type="button"
              onClick={() => setInput(emptyInput(data))}
              className="util ml-auto flex items-center gap-2 border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: 'var(--accent)', color: 'var(--accent)', letterSpacing: '0.09em' }}
            >
              <span aria-hidden>&#8635;</span> Clear all
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Field label="Unit" htmlFor="ps-unit">
              <TextBox id="ps-unit" value={input.unit} onChange={(unit) => update({ unit })} width="12rem" placeholder="Squadron, group or wing" />
            </Field>
            <Field label="Team / nickname" htmlFor="ps-team">
              <TextBox id="ps-team" value={input.team} onChange={(team) => update({ team })} width="12rem" placeholder="How the emcee refers to the unit" />
            </Field>
            <Field label="Date" htmlFor="ps-date">
              <TextBox id="ps-date" value={input.date} onChange={(date) => update({ date })} width="11rem" placeholder="Day Month Year" />
            </Field>
            <Field label="Time" htmlFor="ps-time">
              <TextBox id="ps-time" value={input.time} onChange={(time) => update({ time })} width="6rem" placeholder="Local time" />
            </Field>
            <Field label="Greeting" htmlFor="ps-greeting">
              <Select id="ps-greeting" value={input.greeting} onChange={(greeting) => update({ greeting })} width="10rem" options={GREETINGS.map((g) => ({ value: g, label: g }))} />
            </Field>
          </div>
          <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            The nickname is how the emcee welcomes everyone from the unit. Leave it blank and the
            unit name is used. Nothing typed here leaves this device.
          </p>
        </section>

        {/* ---- Promotee --------------------------------------------------- */}
        <section className="panel p-5">
          <div className="mb-4">
            <SectionTitle step={2} title="Promotee" />
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Field label="Full name (as announced)" htmlFor="ps-name">
              <TextBox id="ps-name" value={input.promoteeName} onChange={(promoteeName) => update({ promoteeName })} width="16rem" placeholder="First M. Last" />
            </Field>
            <Field label="Pronouns" htmlFor="ps-pronouns">
              <Select id="ps-pronouns" value={input.pronounId} onChange={(pronounId) => update({ pronounId })} width="9rem" options={PRONOUNS.map((p) => ({ value: p.id, label: p.label }))} />
            </Field>
            <Field label="Current grade" htmlFor="ps-cur">
              <Select id="ps-cur" value={input.currentGradeId} onChange={(currentGradeId) => update({ currentGradeId })} width="14rem" options={data.grades.map((g) => ({ value: g.id, label: `${g.abbr} — ${g.full}` }))} />
            </Field>
            <Field label="New grade (sets the charge)" htmlFor="ps-new">
              <Select id="ps-new" value={input.newGradeId} onChange={(newGradeId) => update({ newGradeId })} width="14rem" options={data.grades.map((g) => ({ value: g.id, label: `${g.abbr} — ${g.full}` }))} />
            </Field>
            <Field label="Charge">
              <Readout value={charge ? charge.title : 'None for this grade'} width="16rem" tone={charge ? 'ok' : 'plain'} />
            </Field>
            {charge && (
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <input type="checkbox" checked={input.readCharge} onChange={(e) => update({ readCharge: e.target.checked })} />
                Read the charge at this ceremony
              </label>
            )}
          </div>
        </section>

        {/* ---- Key personnel ---------------------------------------------- */}
        <section className="panel p-5">
          <div className="mb-4">
            <SectionTitle step={3} title="Key personnel" />
          </div>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Emcee (rank + name)" htmlFor="ps-emcee">
              <TextBox id="ps-emcee" value={input.emcee} onChange={(emcee) => update({ emcee })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Presiding official / commander" htmlFor="ps-presiding">
              <TextBox id="ps-presiding" value={input.presiding} onChange={(presiding) => update({ presiding })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Senior enlisted leader / chief" htmlFor="ps-chief">
              <TextBox id="ps-chief" value={input.seniorEnlisted} onChange={(seniorEnlisted) => update({ seniorEnlisted })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="First sergeant" htmlFor="ps-shirt">
              <TextBox id="ps-shirt" value={input.firstSergeant} onChange={(firstSergeant) => update({ firstSergeant })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Remarks about the member (rank + name)" htmlFor="ps-remarks">
              <TextBox id="ps-remarks" value={input.remarksBy} onChange={(remarksBy) => update({ remarksBy })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Charge reader (blank = chief, then presiding official)" htmlFor="ps-reader">
              <TextBox id="ps-reader" value={input.chargeReader} onChange={(chargeReader) => update({ chargeReader })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Stripe tacker 1 (e.g. supervisor)" htmlFor="ps-tack1">
              <TextBox id="ps-tack1" value={input.tackers[0] ?? ''} onChange={(v) => update({ tackers: [v, input.tackers[1] ?? ''] })} width="100%" placeholder="Rank and last name" />
            </Field>
            <Field label="Stripe tacker 2 (e.g. spouse)" htmlFor="ps-tack2">
              <TextBox id="ps-tack2" value={input.tackers[1] ?? ''} onChange={(v) => update({ tackers: [input.tackers[0] ?? '', v] })} width="100%" placeholder="Name as announced" />
            </Field>
            <Field label="Refreshments location" htmlFor="ps-refresh">
              <TextBox id="ps-refresh" value={input.refreshments} onChange={(refreshments) => update({ refreshments })} width="100%" placeholder="Where refreshments are" />
            </Field>
          </div>
        </section>

        {/* ---- Family ----------------------------------------------------- */}
        <section className="panel p-5">
          <div className="mb-4">
            <SectionTitle step={4} title="Family recognized" />
          </div>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Spouse (relationship)" htmlFor="ps-sprel">
              <TextBox id="ps-sprel" value={input.spouseRelation} onChange={(spouseRelation) => update({ spouseRelation })} width="100%" placeholder="Wife, Husband, Spouse, Partner" />
            </Field>
            <Field label="Spouse name" htmlFor="ps-spname">
              <TextBox id="ps-spname" value={input.spouseName} onChange={(spouseName) => update({ spouseName })} width="100%" placeholder="Name" />
            </Field>
            <Field label="Children (names)" htmlFor="ps-kids">
              <TextBox id="ps-kids" value={input.children} onChange={(children) => update({ children })} width="100%" placeholder="Names" />
            </Field>
            <Field label="Mother" htmlFor="ps-mom">
              <TextBox id="ps-mom" value={input.mother} onChange={(mother) => update({ mother })} width="100%" />
            </Field>
            <Field label="Father" htmlFor="ps-dad">
              <TextBox id="ps-dad" value={input.father} onChange={(father) => update({ father })} width="100%" />
            </Field>
          </div>
        </section>

        {/* ---- Distinguished visitors ------------------------------------- */}
        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <SectionTitle step={5} title="Distinguished visitors" />
            <button
              type="button"
              onClick={() => update({ visitors: [...input.visitors, { name: '', role: '' }] })}
              className="util ml-auto border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink-muted)', letterSpacing: '0.09em' }}
            >
              + Add visitor
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {input.visitors.map((v, i) => (
              <div key={i} className="grid gap-x-6 gap-y-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label={`Visitor ${i + 1}`} htmlFor={`ps-dv-${i}`}>
                  <TextBox
                    id={`ps-dv-${i}`}
                    value={v.name}
                    onChange={(name) => update({ visitors: input.visitors.map((x, j) => (j === i ? { ...x, name } : x)) })}
                    width="100%"
                    placeholder="Rank and name"
                  />
                </Field>
                <Field label="Role / note (optional)" htmlFor={`ps-dvr-${i}`}>
                  <TextBox
                    id={`ps-dvr-${i}`}
                    value={v.role}
                    onChange={(role) => update({ visitors: input.visitors.map((x, j) => (j === i ? { ...x, role } : x)) })}
                    width="100%"
                    placeholder="Relationship or title"
                  />
                </Field>
                <button
                  type="button"
                  aria-label={`Remove visitor ${i + 1}`}
                  onClick={() => update({ visitors: input.visitors.length > 1 ? input.visitors.filter((_, j) => j !== i) : [{ name: '', role: '' }] })}
                  className="util border px-3 py-2"
                  style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink-faint)' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Any visitor left blank is omitted.
          </p>
        </section>

        {/* ---- Provenance ------------------------------------------------- */}
        <section className="panel flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
          <SourceStamp sources={[dataset.meta]} />
          <p className="m-0 ml-auto max-w-[42ch] text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            A drafting aid. The wording is ceremony convention, not regulation; edit it to suit
            your unit. Air Force enlisted grades only.
          </p>
        </section>
      </div>

      {/* ---- Script ------------------------------------------------------- */}
      <section className="panel p-5 min-w-0 lg:sticky lg:top-4">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionTitle step={6} title="Run of show" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={blank}
              className="util border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: blank ? 'var(--rule-strong)' : 'var(--accent)', color: blank ? 'var(--ink-faint)' : 'var(--accent)', letterSpacing: '0.09em' }}
            >
              Copy text
            </button>
            <button
              type="button"
              onClick={print}
              disabled={blank}
              className="util border px-3.5 py-2"
              style={{ background: blank ? 'var(--panel)' : 'var(--control)', borderColor: blank ? 'var(--rule-strong)' : 'var(--control)', color: blank ? 'var(--ink-faint)' : '#ffffff', letterSpacing: '0.09em' }}
            >
              Print
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf(true)}
              disabled={blank}
              className="util border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: blank ? 'var(--rule-strong)' : 'var(--ink)', color: blank ? 'var(--ink-faint)' : 'var(--ink)', letterSpacing: '0.09em' }}
              title="This builder as a locked, fillable PDF with these entries already in it, for Acrobat or Reader"
            >
              PDF builder with these entries
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf(false)}
              className="util border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: 'var(--ink)', color: 'var(--ink)', letterSpacing: '0.09em' }}
              title="This builder as a locked, fillable PDF, blank, for Acrobat or Reader"
            >
              Blank PDF builder
            </button>
          </div>
        </div>
        {note && (
          <p role="status" className="m-0 mb-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {note}
          </p>
        )}
        {blank ? (
          <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Fill in the fields and the script builds here as you type. Lines marked » are stage
            cues, not read aloud. The charge is set from the new grade: {newGrade.full}{' '}
            {charge ? `reads the ${charge.title}.` : 'reads no charge.'}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <div key={section.id}>
                <h3 className="title m-0 mb-2">{section.title}</h3>
                <div className="flex flex-col gap-1 border-l-2 pl-4" style={{ borderColor: 'var(--rule-strong)' }}>
                  {section.blocks.map((block, i) => (
                    <BlockLine key={i} block={block} />
                  ))}
                </div>
              </div>
            ))}
            <p className="m-0 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Lines marked » are stage cues, not read aloud. Print puts each section on its own
              page; save as PDF from the print dialog.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function BlockLine({ block }: { block: Block }) {
  if (block.kind === 'say') {
    return (
      <p className="m-0 mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink)' }}>
        <span className="font-semibold">EMCEE:</span> {block.text}
      </p>
    );
  }
  if (block.kind === 'cue') {
    return (
      <p className="m-0 text-[12px] italic leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
        » {block.text}
      </p>
    );
  }
  if (block.kind === 'title') {
    return (
      <p className="m-0 mt-2 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
        {block.text}
      </p>
    );
  }
  return (
    <p className="m-0 mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink)' }}>
      {block.text}
    </p>
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
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

function TextBox({ id, value, onChange, width, placeholder }: { id: string; value: string; onChange: (value: string) => void; width: string; placeholder?: string }) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width, maxWidth: '100%' }}
    />
  );
}

function Select({ id, value, onChange, options, width }: { id: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; width: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="border px-3 py-2 text-[13px]" style={{ ...CONTROL, width, maxWidth: '100%' }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Readout({ value, width, tone = 'plain' }: { value: string; width: string; tone?: 'plain' | 'ok' }) {
  const tones = {
    plain: { background: 'var(--panel-raised)', color: 'var(--ink-muted)', border: 'var(--rule)' },
    ok: { background: 'var(--ok-dim)', color: 'var(--ok)', border: 'var(--ok-dim)' },
  }[tone];
  return (
    <output
      className="tabular block truncate border px-3 py-2 text-[13px]"
      style={{ background: tones.background, borderColor: tones.border, color: tones.color, borderRadius: 6, width, maxWidth: '100%' }}
    >
      {value}
    </output>
  );
}
