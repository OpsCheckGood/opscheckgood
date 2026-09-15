import { useEffect, useMemo, useRef, useState } from 'react';
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
  certificateText,
  closingSentence,
  findAward,
  guessSurname,
  openingSentence,
  reviewCitation,
  type CertificateText,
  type CitationInput,
} from '@/lib/decoration/citation';
import type { HeaderLine } from '@/lib/decoration/types';
import { buildCitationDocx } from '@/lib/decoration/docx';
import { decorationBuilderPdf, downloadBytes, downloadName } from '@/lib/pdfform/downloads';
import { DownloadBar } from './DownloadBar';
import { SourceStamp } from './SourceStamp';

/**
 * Decoration Writer.
 *
 * A citation has to survive two limits: the 1350 characters myDecs will
 * accept, and the page, which prints exactly 20 lines of 70 characters in
 * Courier 11 and drops whatever wraps past the last one. Both numbers were
 * read off certificates myDecs itself printed. The counter is easy to see and
 * the page is not, which is how a citation that myDecs accepted comes back
 * from the print shop missing its closing sentence.
 *
 * So this tool holds both. It wraps the citation exactly as typed, with no
 * shaping of any kind, at the column count the page allows, and it will not
 * take a character that would push the text onto a line the certificate
 * cannot print. The certificate preview is the whole page as myDecs lays it
 * out -- header, member, dates, citation, signature block -- drawn from the
 * same wrapped lines the limit was computed from, so what it shows is what
 * the limit was computed from. It prints on its own, at size.
 *
 * The opening and closing sentences are fixed by the awards manual, so in
 * guided mode they are built from a few fields and only the narrative is
 * free. Everything the sentences say, every certificate line, and every rule
 * the review panel quotes comes from the data files; nothing in here knows
 * what a citation says.
 */

const DRAFT_KEY = 'ocg.decoration.draft.v1';

const certificate = CERTIFICATE.data;
const language = CITATION_LANGUAGE.data;
const SERIF_FILE = '/fonts/LiberationSerif-Regular.ttf';

type Mode = 'guided' | 'free';

interface Draft extends CitationInput {
  mode: Mode;
  narrative: string;
  freeText: string;
  /** True once the user has typed a surname by hand; stops the guess overwriting it. */
  surnameEdited: boolean;
}

function initialDraft(): Draft {
  const award = language.awards[0]!;
  return {
    mode: 'guided',
    awardId: award.id,
    serviceId: language.services[0]!.id,
    basisId: award.bases[0]!.id,
    circumstanceId: award.circumstances[0]?.id ?? '',
    closingId: award.closings[0]!.id,
    longCareer: false,
    awardNumber: 1,
    gradeId: language.grades.find((g) => g.id === 'ssgt')?.id ?? language.grades[0]!.id,
    name: '',
    surname: '',
    pronounId: language.pronouns[0]!.id,
    assignmentId: language.opening.assignments[0]!.id,
    duty: '',
    squadron: '',
    group: '',
    wing: '',
    base: '',
    periodId: language.opening.periods[0]!.id,
    start: '',
    end: '',
    date: '',
    periodInOpening: false,
    approver: '',
    approverTitle: '',
    signedDate: '',
    narrative: '',
    freeText: '',
    surnameEdited: false,
  };
}

/** A draft saved by an earlier version had one unit box and one location box. */
function migrate(saved: Partial<Draft> & { unit?: string; location?: string }): Partial<Draft> {
  const out: Partial<Draft> = { ...saved };
  if (typeof saved.unit === 'string' && !saved.squadron) out.squadron = saved.unit;
  if (typeof saved.location === 'string' && !saved.base) out.base = saved.location;
  delete (out as { unit?: string }).unit;
  delete (out as { location?: string }).location;
  return out;
}

const PX_PER_PT = 96 / 72;

export default function DecorationWriter() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loaded, setLoaded] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [monoFace, setMonoFace] = useState<string | null>(null);
  const [serifFace, setSerifFace] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; cut: string } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // localStorage only: a citation names a person and their assignment, and
  // constraint 2 is why none of it leaves the device.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) {
        setDraft({ ...initialDraft(), ...migrate(JSON.parse(saved) as Partial<Draft>) });
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
      /* The writer still works; the draft simply is not remembered. */
    }
  }, [draft, loaded]);

  // The measuring copy and the display copy of the font come from the same
  // embedded bytes, so the preview cannot disagree with the count. The serif
  // is display only: it draws the certificate's header the way Times does.
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
        if (!cancelled) setMonoFace(family);
      })
      .catch(() => {});
    ensureFontFace(SERIF_FILE)
      .then((family) => {
        if (!cancelled) setSerifFace(family);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const sizePt = certificate.font.sizePt;
  const columns =
    certificate.box.columns ??
    (font && certificate.box.widthMm ? columnsFor(font, sizePt, certificate.box.widthMm) : 0);
  const limits: CitationLimits = useMemo(
    () => ({ columns, lines: certificate.box.lines ?? 0, maxChars: certificate.maxChars }),
    [columns],
  );
  const ready = limits.columns > 0 && limits.lines > 0 && font !== null;

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
  const page = useMemo(() => certificateText(draft, language, certificate), [draft]);

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
      circumstanceId: next.circumstances.some((c) => c.id === draft.circumstanceId)
        ? draft.circumstanceId
        : (next.circumstances[0]?.id ?? ''),
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

  async function downloadDocx() {
    if (!page) return;
    const blob = buildCitationDocx(page, full);
    downloadBytes(new Uint8Array(await blob.arrayBuffer()), downloadName('Decoration Writer', 'word'), blob.type);
  }

  /** The tool as a locked, fillable PDF: blank, or carrying what is on the page. */
  async function downloadFormPdf(withEntries: boolean) {
    const bytes = await decorationBuilderPdf(withEntries ? draft : null, language, certificate);
    downloadBytes(bytes, downloadName('Decoration Writer', withEntries ? 'filled' : 'blank'));
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
  const clusters = certificate.page?.clusters ?? [''];

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
              detail: `Runs ${fit.overLines} line${fit.overLines === 1 ? '' : 's'} past the page. Cut about ${fit.overLines * limits.columns} characters.`,
              tone: 'bad',
            }
          : {
              word: 'OVER LIMIT',
              detail: `${fit.overChars} character${fit.overChars === 1 ? '' : 's'} past what myDecs accepts`,
              tone: 'bad',
            };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 sm:px-6 py-6">
      <DownloadBar
        items={[
          {
            label: 'Blank PDF builder',
            detail: 'The Decoration Writer as a locked, fillable PDF. Fill it in Acrobat or Reader.',
            run: () => downloadFormPdf(false),
            primary: true,
          },
          {
            label: 'PDF builder with these entries',
            detail: 'The same PDF with everything on this page already entered.',
            run: () => downloadFormPdf(true),
            disabled: !full,
          },
          {
            label: 'Word draft',
            detail: 'The certificate as an editable Word document.',
            run: () => downloadDocx(),
            disabled: !full,
          },
        ]}
      />

      {/* ---- Award -------------------------------------------------------- */}
      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionTitle step={1} title="Decoration" />
          <ModeToggle mode={draft.mode} onChange={(mode) => update({ mode })} />
          <button
            type="button"
            onClick={() => {
              setDraft(initialDraft());
              setNotice(null);
            }}
            className="util ml-auto flex items-center gap-2 border px-3.5 py-2"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink-muted)',
              letterSpacing: '0.09em',
            }}
          >
            <span aria-hidden>&#8635;</span> Clear all
          </button>
        </div>

        {guided ? (
          <div className="grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Decoration" htmlFor="dec-award" span={2}>
              <Select
                id="dec-award"
                value={draft.awardId}
                onChange={chooseAward}
                width="19rem"
                options={language.awards.map((a) => ({ value: a.id, label: a.label }))}
              />
            </Field>
            <Field label="Award" htmlFor="dec-number">
              <Select
                id="dec-number"
                value={String(draft.awardNumber)}
                onChange={(v) => update({ awardNumber: Number(v) })}
                width="14rem"
                options={clusters.map((word, i) => ({
                  value: String(i + 1),
                  label: i === 0 ? 'First award' : `${word[0]}${word.slice(1).toLowerCase()} oak leaf cluster`,
                }))}
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
                width="16rem"
                options={award.bases.map((b) => ({ value: b.id, label: b.label }))}
              />
            </Field>
            {award.circumstances.length > 0 && (
              <Field label="While engaged" htmlFor="dec-circumstance" span={2}>
                <Select
                  id="dec-circumstance"
                  value={draft.circumstanceId}
                  onChange={(circumstanceId) => update({ circumstanceId })}
                  width="22rem"
                  options={award.circumstances.map((c) => ({ value: c.id, label: c.label }))}
                />
              </Field>
            )}
            <Field label="Closing" htmlFor="dec-closing">
              <Select
                id="dec-closing"
                value={draft.closingId}
                onChange={(closingId) => update({ closingId })}
                width="12rem"
                options={award.closings.map((c) => ({ value: c.id, label: c.label }))}
              />
            </Field>
            {showLongCareer && (
              <label className="flex min-h-[38px] items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
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
            page still binds.
          </p>
        )}
        <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Opening and closing sentences follow {award.ref} of the awards manual, word for word.
          Nothing typed here leaves this device.
        </p>
      </section>

      {/* ---- Member and assignment ---------------------------------------- */}
      {guided && (
        <section className="panel p-5">
          <div className="mb-4">
            <SectionTitle step={2} title="Member and assignment" />
          </div>
          <div className="grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
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

          <div className="mt-5 grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
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
                <TextBox id="dec-duty" value={draft.duty} onChange={(duty) => update({ duty })} width="18rem" placeholder="a Flight Chief" />
              </Field>
            )}
            {draft.assignmentId !== 'near' && (
              <>
                <Field label="Squadron" htmlFor="dec-squadron">
                  <TextBox id="dec-squadron" value={draft.squadron} onChange={(squadron) => update({ squadron })} width="15rem" placeholder="1st Maintenance Squadron" />
                </Field>
                <Field label="Group" htmlFor="dec-group">
                  <TextBox id="dec-group" value={draft.group} onChange={(group) => update({ group })} width="14rem" placeholder="1st Maintenance Group" />
                </Field>
                <Field label="Wing" htmlFor="dec-wing">
                  <TextBox id="dec-wing" value={draft.wing} onChange={(wing) => update({ wing })} width="12rem" placeholder="1st Fighter Wing" />
                </Field>
              </>
            )}
            <Field label="Base / location" htmlFor="dec-base" span={2}>
              <TextBox
                id="dec-base"
                value={draft.base}
                onChange={(base) => update({ base })}
                width="18rem"
                placeholder="Joint Base Langley-Eustis, Virginia"
              />
            </Field>
          </div>

          <div className="mt-5 grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Period" htmlFor="dec-period">
              <Select
                id="dec-period"
                value={draft.periodId}
                onChange={(periodId) => update({ periodId })}
                width="10rem"
                options={language.opening.periods
                  .filter((p) => p.id !== 'none')
                  .map((p) => ({ value: p.id, label: p.label }))}
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
            <label className="flex min-h-[38px] items-center gap-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              <input
                type="checkbox"
                checked={draft.periodInOpening}
                onChange={(e) => update({ periodInOpening: e.target.checked })}
              />
              Also write the period into the opening sentence
            </label>
          </div>
          <p className="m-0 mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
            The dates print in the certificate&rsquo;s header. myDecs citations go straight from the
            assignment to &ldquo;During this period&rdquo;; the manual&rsquo;s examples carry the dates in
            the sentence as well, which the box above puts back.
          </p>
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

        {guided && <FixedSentence label="Opening sentence" text={opening} />}

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
            style={{ ...CONTROL, fontFamily: 'inherit' }}
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
            <div role="status" className="text-[12px] leading-relaxed" style={{ color: 'var(--warn)' }}>
              {notice.text}
              {notice.cut && (
                <span className="ml-1 px-1" style={{ background: 'var(--warn-dim)' }}>
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
              color: full ? 'var(--ground)' : 'var(--ink-faint)',
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
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SectionTitle step={guided ? 4 : 3} title="Certificate" />
          <span className="util ml-auto">
            {ready
              ? `${limits.columns} columns × ${limits.lines} lines · Courier ${sizePt}pt, justified`
              : 'Loading font'}
          </span>
        </div>

        <div className="mb-4 grid items-end gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Approving official" htmlFor="dec-approver" span={2}>
            <TextBox
              id="dec-approver"
              value={draft.approver}
              onChange={(approver) => update({ approver })}
              width="20rem"
              placeholder="FIRST M. LAST, Lt Col, USAF"
            />
          </Field>
          <Field label="Official's duty title" htmlFor="dec-approver-title">
            <TextBox
              id="dec-approver-title"
              value={draft.approverTitle}
              onChange={(approverTitle) => update({ approverTitle })}
              width="20rem"
              placeholder="Commander, 1st Maintenance Squadron"
            />
          </Field>
          <Field label="Signature date" htmlFor="dec-signed">
            <DateBox id="dec-signed" value={draft.signedDate} onChange={(signedDate) => update({ signedDate })} />
          </Field>
          <div className="flex flex-wrap gap-2 lg:col-span-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!full}
            className="util border px-3.5 py-2.5"
            style={{
              background: 'var(--panel)',
              borderColor: full ? 'var(--ink)' : 'var(--rule-strong)',
              color: full ? 'var(--ink)' : 'var(--ink-faint)',
              letterSpacing: '0.09em',
            }}
            title="Prints the certificate page alone, at size"
          >
            Print certificate
          </button>
          </div>
        </div>

        {page && (
          <CertificatePage
            page={page}
            lines={fit.lines}
            limits={limits}
            monoFace={monoFace}
            serifFace={serifFace}
            sizePt={sizePt}
            empty={!full}
          />
        )}
        <p className="m-0 mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          The page as myDecs prints it, from the same wrapped lines the count uses. Where a line
          breaks here is where it breaks on the certificate; justification only changes the spacing
          inside a line. The header wording for the {award.certificate.style === 'daf' ? 'Achievement and Commendation Medals' : 'Meritorious Service Medal'} was read off printed certificates; the rest follow the same layout.
        </p>
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
// Certificate preview: the whole page, at size, scaled to fit
// ---------------------------------------------------------------------------

function CertificatePage({
  page,
  lines,
  limits,
  monoFace,
  serifFace,
  sizePt,
  empty,
}: {
  page: CertificateText;
  lines: string[];
  limits: CitationLimits;
  monoFace: string | null;
  serifFace: string | null;
  sizePt: number;
  empty: boolean;
}) {
  const layout = certificate.page!;
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const widthPx = layout.widthPt * PX_PER_PT;
  const heightPx = layout.heightPt * PX_PER_PT;

  // Fit the letter page to the column; it prints unscaled.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const update = () => {
      const available = el.clientWidth;
      if (available > 0) setScale(Math.min(1, available / widthPx));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [widthPx]);

  const mono = monoFace ? `"${monoFace}", "Courier New", Courier, monospace` : '"Courier New", Courier, monospace';
  const serif = serifFace ? `"Times New Roman", "${serifFace}", Times, serif` : '"Times New Roman", Times, serif';
  const faceOf = (face: HeaderLine['face']) => (face === 'mono' ? mono : serif);
  const weightOf = (face: HeaderLine['face']) => (face === 'serif-bold' ? 700 : 400);

  const pitchPx = (certificate.box.linePitchPt ?? sizePt * 1.2) * PX_PER_PT;
  const marginPx = layout.marginPt * PX_PER_PT;
  const citationTop = layout.citationTopPt * PX_PER_PT;
  const rows = Math.max(limits.lines, lines.length);

  return (
    <div ref={host} className="flex w-full justify-center">
      <div style={{ width: widthPx * scale, height: heightPx * scale }}>
      <div
        className="certificate-page"
        style={{
          width: widthPx,
          height: heightPx,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          background: '#ffffff',
          color: '#111111',
          boxShadow: '0 1px 3px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.06)',
          overflow: 'hidden',
        }}
      >
        {page.header.map((line, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: marginPx,
              right: marginPx,
              top: (line.yPt ?? 0) * PX_PER_PT,
              textAlign: 'center',
              fontFamily: faceOf(line.face),
              fontWeight: weightOf(line.face),
              fontSize: line.sizePt * PX_PER_PT,
              lineHeight: 1.15,
              whiteSpace: line.face === 'mono' ? 'pre' : 'normal',
              letterSpacing: line.face === 'mono' ? undefined : '0.01em',
            }}
          >
            {line.text}
          </div>
        ))}

        {/* The citation: the wrapped lines, each justified across the measure
            like the certificate's, the last one ragged. */}
        <div
          style={{
            position: 'absolute',
            left: marginPx,
            width: widthPx - 2 * marginPx,
            top: citationTop,
            fontFamily: mono,
            fontSize: sizePt * PX_PER_PT,
            lineHeight: `${pitchPx}px`,
          }}
        >
          {Array.from({ length: rows }, (_, i) => {
            const text = empty ? '' : (lines[i] ?? '');
            const cut = i >= limits.lines;
            const last = i === lines.length - 1 || cut;
            return (
              <div
                key={i}
                style={{
                  height: pitchPx,
                  overflow: 'hidden',
                  whiteSpace: 'normal',
                  textAlign: certificate.box.justified && !last ? 'justify' : 'left',
                  textAlignLast: certificate.box.justified && !last ? 'justify' : 'left',
                  background: cut ? 'var(--bad-dim)' : undefined,
                  color: cut ? 'var(--bad)' : undefined,
                  borderTop: i === limits.lines ? '1px dashed var(--bad)' : undefined,
                }}
              >
                {text}
              </div>
            );
          })}
        </div>

        {page.closing.map((line, i) => (
          <div
            key={`c${i}`}
            style={{
              position: 'absolute',
              left: marginPx,
              right: marginPx,
              top: (layout.givenUnderMyHandPt + i * 16) * PX_PER_PT,
              textAlign: 'center',
              fontFamily: faceOf(line.face),
              fontWeight: weightOf(line.face),
              fontSize: line.sizePt * PX_PER_PT,
              lineHeight: 1.15,
            }}
          >
            {line.text}
          </div>
        ))}

        {page.signature.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: marginPx,
              top: layout.signatureTopPt * PX_PER_PT,
              fontFamily: serif,
              fontSize: 7 * PX_PER_PT,
              lineHeight: `${13.4 * PX_PER_PT}px`,
              whiteSpace: 'pre',
            }}
          >
            {page.signature.join('\n')}
          </div>
        )}
      </div>
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
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[11px] font-bold"
        style={{ background: 'var(--ink)', color: 'var(--ground)' }}
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
  span = 1,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** Grid columns to occupy on a wide screen. */
  span?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${span === 2 ? 'lg:col-span-2' : ''}`}>
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
  /** Kept for callers; every control now fills its grid cell. */
  width?: string;
  placeholder?: string;
}) {
  void width;
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width: '100%' }}
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
      style={{ ...CONTROL, width: '100%' }}
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
  width?: string;
}) {
  void width;
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border px-3 py-2 text-[13px]"
      style={{ ...CONTROL, width: '100%' }}
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
      style={{ border: '1px solid var(--rule-strong)' }}
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
              color: active ? 'var(--ground)' : 'var(--ink-muted)',
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
