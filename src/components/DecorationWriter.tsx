import { useEffect, useMemo, useState } from 'react';
import { CERTIFICATE, CITATION_LANGUAGE } from '@/lib/data/decorations';
import { loadFontMetrics } from '@/lib/metrics/registry';
import { ensureFontFace } from '@/lib/metrics/fontface';
import type { FontMetrics } from '@/lib/metrics/font';
import {
  applyEdit,
  columnsFor,
  fitCitation,
  normalizeCitation,
  type CitationLimits,
  type EditResult,
} from '@/lib/decoration/fit';
import {
  assembleCitation,
  closingSentence,
  findAward,
  guessSurname,
  openingSentence,
  reviewCitation,
  type CitationInput,
} from '@/lib/decoration/citation';
import { SourceStamp, StubBanner } from './SourceStamp';

/**
 * Decoration Writer.
 *
 * A citation has to survive two limits: the 1350 characters myDecs will
 * accept, and the box on the certificate, which holds a fixed number of lines
 * in a monospace face and drops whatever wraps past the last one. The counter
 * is easy to see and the box is not, which is how a citation that myDecs
 * accepted comes back from the print shop missing its closing sentence.
 *
 * So this tool holds both. It wraps the citation exactly as typed, with no
 * shaping of any kind, at the column count the box allows, and it will not
 * take a character that would push the text onto a line the certificate
 * cannot print. The certificate preview is drawn from those same wrapped
 * lines, so what it shows is what the limit was computed from.
 *
 * The opening and closing sentences are fixed by the awards manual, so in
 * guided mode they are built from a few fields and only the narrative is
 * free. Everything the sentences say, and every rule the review panel quotes,
 * comes from the data files; nothing in here knows what a citation says.
 *
 * Deviation from constraint 5, and the same one the other calculators make:
 * the banner is shown, because here the stub is not a formality. The box
 * geometry is measured off a unit template rather than a myDecs certificate,
 * and the calibration panel exists so anyone holding a real one can put the
 * true counts in.
 */

const DRAFT_KEY = 'ocg.decoration.draft.v1';

const certificate = CERTIFICATE.data;
const language = CITATION_LANGUAGE.data;

type Mode = 'guided' | 'free';

interface Draft extends CitationInput {
  mode: Mode;
  narrative: string;
  freeText: string;
  /** True once the user has typed a surname by hand; stops the guess overwriting it. */
  surnameEdited: boolean;
  /** Calibration. Null means "what the data says". */
  columnsOverride: number | null;
  linesOverride: number | null;
}

function initialDraft(): Draft {
  const award = language.awards[0]!;
  return {
    mode: 'guided',
    awardId: award.id,
    serviceId: language.services[0]!.id,
    basisId: award.bases[0]!.id,
    closingId: award.closings[0]!.id,
    longCareer: false,
    gradeId: language.grades.find((g) => g.id === 'ssgt')?.id ?? language.grades[0]!.id,
    name: '',
    surname: '',
    pronounId: language.pronouns[0]!.id,
    assignmentId: language.opening.assignments[0]!.id,
    duty: '',
    unit: '',
    location: '',
    periodId: language.opening.periods[0]!.id,
    start: '',
    end: '',
    date: '',
    narrative: '',
    freeText: '',
    surnameEdited: false,
    columnsOverride: null,
    linesOverride: null,
  };
}

/** Courier New's line pitch: ascender plus descender over the em. */
const LINE_PITCH_EM = 2320 / 2048;
const PX_PER_PT = 96 / 72;

export default function DecorationWriter() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loaded, setLoaded] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; cut: string } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // localStorage only: a citation names a person and their assignment, and
  // constraint 2 is why none of it leaves the device.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setDraft({ ...initialDraft(), ...(JSON.parse(saved) as Partial<Draft>) });
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
      /* The writer still works; the draft simply is not remembered. */
    }
  }, [draft, loaded]);

  // The measuring copy and the display copy of the font come from the same
  // embedded bytes, so the preview cannot disagree with the count.
  useEffect(() => {
    let cancelled = false;
    loadFontMetrics(certificate.font.file, certificate.font.family)
      .then((metrics) => {
        if (!cancelled) setFont(metrics);
      })
      .catch(() => {
        /* Surfaces as the LOADING state below. */
      });
    ensureFontFace(certificate.font.file)
      .then((family) => {
        if (!cancelled) setFace(family);
      })
      .catch(() => {
        /* Generic monospace still wraps at the same columns. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sizePt = certificate.font.sizePt;
  const dataColumns =
    certificate.box.columns ??
    (font && certificate.box.widthMm ? columnsFor(font, sizePt, certificate.box.widthMm) : 0);
  const dataLines = certificate.box.lines ?? 0;

  const limits: CitationLimits = useMemo(
    () => ({
      columns: draft.columnsOverride ?? dataColumns,
      lines: draft.linesOverride ?? dataLines,
      maxChars: certificate.maxChars,
    }),
    [draft.columnsOverride, draft.linesOverride, dataColumns, dataLines],
  );
  const ready = limits.columns > 0 && limits.lines > 0;

  const award = findAward(language, draft.awardId);
  const guided = draft.mode === 'guided';
  const opening = guided ? openingSentence(draft, language) : '';
  const closing = guided ? closingSentence(draft, language) : '';
  const inner = guided ? draft.narrative : draft.freeText;
  const assemble = (text: string) => (guided ? assembleCitation(opening, text, closing) : text.trim());
  const full = assemble(inner);

  const fit = useMemo(() => fitCitation(full, limits), [full, limits]);
  const warnings = useMemo(
    () => (full ? reviewCitation(full, fit.lines, draft, language) : []),
    [full, fit.lines, draft],
  );
  const fixedChars = guided ? assembleCitation(opening, '', closing).length : 0;

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function editInner(raw: string) {
    if (!ready) return;
    const next = normalizeCitation(raw);
    const result: EditResult = applyEdit(inner, next, assemble, limits);
    if (guided) update({ narrative: result.text });
    else update({ freeText: result.text });
    if (result.outcome === 'blocked') {
      setNotice({
        text:
          fit.overChars > 0 || full.length >= limits.maxChars
            ? `Blocked: ${limits.maxChars} characters is the myDecs limit.`
            : `Blocked: that would run onto line ${limits.lines + 1}, and the certificate prints ${limits.lines}.`,
        cut: '',
      });
    } else if (result.outcome === 'trimmed') {
      setNotice({
        text: `Trimmed the paste to what fits on line ${limits.lines}. Cut:`,
        cut: result.cut,
      });
    } else {
      setNotice(null);
    }
  }

  function chooseAward(awardId: string) {
    const next = findAward(language, awardId);
    update({
      awardId,
      basisId: next.bases.some((b) => b.id === draft.basisId) ? draft.basisId : next.bases[0]!.id,
      closingId: next.closings.some((c) => c.id === draft.closingId)
        ? draft.closingId
        : next.closings[0]!.id,
    });
  }

  function chooseService(serviceId: string) {
    const grades = language.grades.filter((g) => g.service === 'both' || g.service === serviceId);
    update({
      serviceId,
      gradeId: grades.some((g) => g.id === draft.gradeId) ? draft.gradeId : grades[0]!.id,
    });
  }

  function editName(name: string) {
    update({ name, surname: draft.surnameEdited ? draft.surname : guessSurname(name) });
  }

  async function copyCitation() {
    try {
      await navigator.clipboard.writeText(full);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy blocked — select and Ctrl+C');
    }
    window.setTimeout(() => setCopyNote(null), 3000);
  }

  const grades = language.grades.filter((g) => g.service === 'both' || g.service === draft.serviceId);
  const closingPhrase = award.closings.find((c) => c.id === draft.closingId) ?? award.closings[0]!;
  const showLongCareer = closingPhrase.text.includes('{longAnd}');
  const periodNeeds = draft.periodId === 'range' ? 'range' : draft.periodId === 'on' ? 'on' : 'none';

  const status: { word: string; detail: string; tone: 'ok' | 'bad' | 'plain' } = !full
    ? { word: 'EMPTY', detail: 'Nothing to fit yet', tone: 'plain' }
    : !ready
      ? { word: 'LOADING', detail: 'Measuring the certificate font', tone: 'plain' }
      : fit.fits
        ? {
            word: 'FITS',
            detail: `${limits.lines - fit.lineCount} line${limits.lines - fit.lineCount === 1 ? '' : 's'} and ${limits.maxChars - fit.chars} characters to spare`,
            tone: 'ok',
          }
        : fit.overLines > 0
          ? {
              word: 'CUT OFF',
              detail: `Runs ${fit.overLines} line${fit.overLines === 1 ? '' : 's'} past the box. Cut about ${fit.overLines * limits.columns} characters.`,
              tone: 'bad',
            }
          : {
              word: 'OVER LIMIT',
              detail: `${fit.overChars} character${fit.overChars === 1 ? '' : 's'} past what myDecs accepts`,
              tone: 'bad',
            };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 sm:px-6 py-6">
      {(CERTIFICATE.isStub || CITATION_LANGUAGE.isStub) && (
        <StubBanner what="The certificate box size was measured off a unit template, not a certificate myDecs printed, and the sentence wording was read from the 2019 manual. If you have a real certificate, calibrate below." />
      )}

      {/* ---- Award -------------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionTitle step={1} title="Award" />
          <ModeToggle mode={draft.mode} onChange={(mode) => update({ mode })} />
          <button
            type="button"
            onClick={() => {
              setDraft({ ...initialDraft(), columnsOverride: draft.columnsOverride, linesOverride: draft.linesOverride });
              setNotice(null);
            }}
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

        {guided ? (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Decoration" htmlFor="dec-award">
              <Select
                id="dec-award"
                value={draft.awardId}
                onChange={chooseAward}
                width="19rem"
                options={language.awards.map((a) => ({ value: a.id, label: a.label }))}
              />
            </Field>
            <Field label="Service" htmlFor="dec-service">
              <Select
                id="dec-service"
                value={draft.serviceId}
                onChange={chooseService}
                width="9rem"
                options={language.services.map((s) => ({ value: s.id, label: s.label }))}
              />
            </Field>
            <Field label="Basis" htmlFor="dec-basis">
              <Select
                id="dec-basis"
                value={draft.basisId}
                onChange={(basisId) => update({ basisId })}
                width="15rem"
                options={award.bases.map((b) => ({ value: b.id, label: b.label }))}
              />
            </Field>
            <Field label="Closing" htmlFor="dec-closing">
              <Select
                id="dec-closing"
                value={draft.closingId}
                onChange={(closingId) => update({ closingId })}
                width="11rem"
                options={award.closings.map((c) => ({ value: c.id, label: c.label }))}
              />
            </Field>
            {showLongCareer && (
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <input
                  type="checkbox"
                  checked={draft.longCareer}
                  onChange={(e) => update({ longCareer: e.target.checked })}
                />
                30 or more years (&ldquo;long and&rdquo;)
              </label>
            )}
          </div>
        ) : (
          <p className="m-0 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Free mode: you write the whole citation, opening and closing sentences included. The
            box still binds.
          </p>
        )}
        <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Opening and closing sentences follow {award.ref} of the awards manual. Nothing typed here
          leaves this device.
        </p>
      </section>

      {/* ---- Member and assignment ---------------------------------------- */}
      {guided && (
        <section className="panel p-5">
          <div className="mb-4">
            <SectionTitle step={2} title="Member and assignment" />
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Grade" htmlFor="dec-grade">
              <Select
                id="dec-grade"
                value={draft.gradeId}
                onChange={(gradeId) => update({ gradeId })}
                width="15rem"
                options={grades.map((g) => ({ value: g.id, label: `${g.abbr} — ${g.full}` }))}
              />
            </Field>
            <Field label="Full name" htmlFor="dec-name">
              <TextBox id="dec-name" value={draft.name} onChange={editName} width="16rem" placeholder="First M. Last" />
            </Field>
            <Field label="Surname (short title)" htmlFor="dec-surname">
              <TextBox
                id="dec-surname"
                value={draft.surname}
                onChange={(surname) => update({ surname, surnameEdited: true })}
                width="10rem"
              />
            </Field>
            <Field label="Pronouns" htmlFor="dec-pronouns">
              <Select
                id="dec-pronouns"
                value={draft.pronounId}
                onChange={(pronounId) => update({ pronounId })}
                width="9rem"
                options={language.pronouns.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Assignment" htmlFor="dec-assignment">
              <Select
                id="dec-assignment"
                value={draft.assignmentId}
                onChange={(assignmentId) => update({ assignmentId })}
                width="11rem"
                options={language.opening.assignments.map((a) => ({ value: a.id, label: a.label }))}
              />
            </Field>
            {draft.assignmentId === 'as' && (
              <Field label="Duty title" htmlFor="dec-duty">
                <TextBox id="dec-duty" value={draft.duty} onChange={(duty) => update({ duty })} width="16rem" placeholder="Flight Chief" />
              </Field>
            )}
            {draft.assignmentId !== 'near' && (
              <Field label="Unit" htmlFor="dec-unit">
                <TextBox id="dec-unit" value={draft.unit} onChange={(unit) => update({ unit })} width="18rem" placeholder="1st Maintenance Squadron" />
              </Field>
            )}
            <Field label="Location" htmlFor="dec-location">
              <TextBox
                id="dec-location"
                value={draft.location}
                onChange={(location) => update({ location })}
                width="18rem"
                placeholder="Joint Base Langley-Eustis, Virginia"
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Period" htmlFor="dec-period">
              <Select
                id="dec-period"
                value={draft.periodId}
                onChange={(periodId) => update({ periodId })}
                width="10rem"
                options={language.opening.periods.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>
            {periodNeeds === 'range' && (
              <>
                <Field label="From" htmlFor="dec-start">
                  <DateBox id="dec-start" value={draft.start} onChange={(start) => update({ start })} />
                </Field>
                <Field label="To" htmlFor="dec-end">
                  <DateBox id="dec-end" value={draft.end} onChange={(end) => update({ end })} />
                </Field>
              </>
            )}
            {periodNeeds === 'on' && (
              <Field label="Date" htmlFor="dec-date">
                <DateBox id="dec-date" value={draft.date} onChange={(date) => update({ date })} />
              </Field>
            )}
          </div>
        </section>
      )}

      {/* ---- Citation ----------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionTitle step={guided ? 3 : 2} title="Citation" />
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
            <Readout value={ready ? `${fit.chars} / ${limits.maxChars} chars` : '—'} width="11rem" tone="plain" />
            <Readout
              value={ready ? `${fit.lineCount} / ${limits.lines} lines` : '—'}
              width="9rem"
              tone={!full ? 'plain' : fit.overLines > 0 ? 'bad' : 'plain'}
            />
            <Readout value={status.word} width="8rem" tone={status.tone} strong />
          </div>
        </div>

        {guided && (
          <FixedSentence label="Opening sentence" text={opening} />
        )}

        <div className="mt-3 flex flex-col gap-1.5">
          <label className="util" htmlFor="dec-narrative">
            {guided ? 'Narrative' : 'Whole citation'}
          </label>
          <textarea
            id="dec-narrative"
            value={inner}
            onChange={(e) => editInner(e.target.value)}
            disabled={!ready}
            rows={guided ? 7 : 12}
            spellCheck
            className="w-full resize-y border px-3 py-2 text-[13.5px] leading-relaxed"
            style={{ ...CONTROL, borderRadius: 6, fontFamily: 'inherit' }}
            placeholder={
              guided
                ? 'During this period, …'
                : 'Staff Sergeant … distinguished herself by …'
            }
          />
          <p className="m-0 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            {status.detail}.
            {guided && fixedChars > 0 && ` The fixed sentences use ${fixedChars} of the ${limits.maxChars}.`}
            {' '}Typing stops at the last line the certificate prints; a paste is trimmed to fit.
          </p>
          {notice && (
            <div
              role="status"
              className="text-[12px] leading-relaxed"
              style={{ color: 'var(--warn)' }}
            >
              {notice.text}
              {notice.cut && (
                <span className="ml-1 rounded px-1" style={{ background: 'var(--warn-dim)' }}>
                  {notice.cut}
                </span>
              )}
            </div>
          )}
        </div>

        {guided && (
          <div className="mt-3">
            <FixedSentence label="Closing sentence" text={closing} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copyCitation}
            disabled={!full}
            className="util border px-3.5 py-2"
            style={{
              background: full ? 'var(--control)' : 'var(--panel)',
              borderColor: full ? 'var(--control)' : 'var(--rule-strong)',
              color: full ? '#ffffff' : 'var(--ink-faint)',
              letterSpacing: '0.09em',
            }}
          >
            Copy citation
          </button>
          {copyNote && (
            <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {copyNote}
            </span>
          )}
        </div>
      </section>

      {/* ---- Certificate -------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SectionTitle step={guided ? 4 : 3} title="Certificate" />
          <span className="util ml-auto">
            {ready ? `${limits.columns} columns × ${limits.lines} lines · ${certificate.font.family} ${sizePt}pt` : 'Loading font'}
          </span>
        </div>
        <CertificateBox
          lines={fit.lines}
          limits={limits}
          face={face}
          sizePt={sizePt}
          empty={!full}
        />
        <p className="m-0 mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          Drawn from the same wrapped lines the count uses, at the box&rsquo;s real width. Where a
          line breaks here is where it breaks on the certificate; justification only changes the
          spacing inside a line.
        </p>

        <details className="mt-3">
          <summary className="util cursor-pointer" style={{ color: 'var(--accent)' }}>
            Calibrate against a real certificate
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
            <Field label="Characters per line" htmlFor="dec-columns">
              <NumberBox
                id="dec-columns"
                value={draft.columnsOverride ?? dataColumns}
                onChange={(v) => update({ columnsOverride: v === dataColumns ? null : v })}
              />
            </Field>
            <Field label="Lines in the box" htmlFor="dec-lines">
              <NumberBox
                id="dec-lines"
                value={draft.linesOverride ?? dataLines}
                onChange={(v) => update({ linesOverride: v === dataLines ? null : v })}
              />
            </Field>
            <button
              type="button"
              onClick={() => update({ columnsOverride: null, linesOverride: null })}
              className="util border px-3.5 py-2"
              style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink-muted)' }}
            >
              Reset to data ({dataColumns} × {dataLines})
            </button>
          </div>
          <p className="m-0 mt-3 max-w-[70ch] text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            Take a certificate myDecs printed. Count the characters on its fullest line, spaces
            included, and count the lines the box holds. Enter both. The numbers stay on this
            device.
          </p>
        </details>
      </section>

      {/* ---- Review ------------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-3">
          <SectionTitle step={guided ? 5 : 4} title="Review" />
        </div>
        {warnings.length === 0 ? (
          <p className="m-0 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {full ? 'Nothing flagged.' : 'Checks run once there is a citation.'}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {warnings.map((w) => (
              <li key={w.text} className="flex gap-3 text-[12.5px] leading-relaxed">
                <span className="util shrink-0 pt-[3px]" style={{ color: 'var(--warn)', minWidth: '4.5rem' }}>
                  {w.ref ?? 'Check'}
                </span>
                <span style={{ color: 'var(--ink)' }}>{w.text}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="m-0 mt-4 flex list-none flex-col gap-1 p-0 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          {language.rules.map((rule) => (
            <li key={rule.ref}>
              <span className="tabular">{rule.ref}</span> &middot; {rule.text}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Provenance --------------------------------------------------- */}
      <section className="panel flex flex-wrap items-start gap-x-8 gap-y-3 p-4">
        <SourceStamp sources={[CERTIFICATE.meta, CITATION_LANGUAGE.meta]} />
        <p className="m-0 ml-auto max-w-[42ch] text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          A drafting aid. myDecs, the awards manual and the approving authority govern what a
          citation may say and how it prints.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Certificate preview
// ---------------------------------------------------------------------------

function CertificateBox({
  lines,
  limits,
  face,
  sizePt,
  empty,
}: {
  lines: string[];
  limits: CitationLimits;
  face: string | null;
  sizePt: number;
  empty: boolean;
}) {
  const fontPx = sizePt * PX_PER_PT;
  const cellPx = fontPx * 0.6;
  const linePx = fontPx * LINE_PITCH_EM;
  const width = limits.columns * cellPx;
  const rows = Math.max(limits.lines, lines.length);
  const family = face ? `"${face}", "Courier New", monospace` : '"Courier New", monospace';

  return (
    <div className="overflow-x-auto">
      <div
        className="relative"
        style={{
          width: width + 2,
          minWidth: width + 2,
          background: '#ffffff',
          color: '#111111',
          border: '1px solid var(--rule-strong)',
          fontFamily: family,
          fontSize: fontPx,
          lineHeight: `${linePx}px`,
        }}
      >
        {Array.from({ length: rows }, (_, i) => {
          const text = empty ? '' : (lines[i] ?? '');
          const cut = i >= limits.lines;
          return (
            <div
              key={i}
              className="relative whitespace-pre"
              style={{
                height: linePx,
                background: cut ? 'var(--bad-dim)' : undefined,
                color: cut ? 'var(--bad)' : undefined,
                borderTop: i === limits.lines ? '1px dashed var(--bad)' : undefined,
              }}
            >
              <span
                aria-hidden
                className="absolute select-none"
                style={{
                  left: -28,
                  width: 24,
                  textAlign: 'right',
                  fontSize: 9,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--ink-faint)',
                  lineHeight: `${linePx}px`,
                }}
              >
                {i + 1}
              </span>
              {text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FixedSentence({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="util">
        {label} <span className="tabular" style={{ textTransform: 'none' }}>· {text.length} chars</span>
      </span>
      <p
        className="m-0 border px-3 py-2 text-[13px] leading-relaxed"
        style={{
          background: 'var(--panel-raised)',
          borderColor: 'var(--rule)',
          color: text ? 'var(--ink)' : 'var(--ink-faint)',
          borderRadius: 6,
        }}
      >
        {text || 'Fill in the member and assignment.'}
      </p>
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

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
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
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  width: string;
  placeholder?: string;
}) {
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

function NumberBox({ id, value, onChange }: { id: string; value: number; onChange: (value: number) => void }) {
  return (
    <input
      id={id}
      type="number"
      min={1}
      value={value || ''}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n > 0) onChange(n);
      }}
      className="tabular border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width: '7rem', borderRadius: 6 }}
    />
  );
}

function DateBox({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width: '11rem', borderRadius: 6 }}
    />
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  width,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  width: string;
}) {
  return (
    <select
      id={id}
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
  tone = 'plain',
  strong,
}: {
  value: string;
  width: string;
  tone?: 'plain' | 'ok' | 'bad';
  strong?: boolean;
}) {
  const tones = {
    plain: { background: 'var(--panel-raised)', color: 'var(--ink-muted)', border: 'var(--rule)' },
    ok: { background: 'var(--ok-dim)', color: 'var(--ok)', border: 'var(--ok-dim)' },
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

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const options: { id: Mode; label: string }[] = [
    { id: 'guided', label: 'Guided' },
    { id: 'free', label: 'Free text' },
  ];
  return (
    <div
      role="group"
      aria-label="Writing mode"
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
              background: active ? 'var(--control)' : 'var(--panel)',
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
