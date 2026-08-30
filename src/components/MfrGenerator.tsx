import { useCallback, useEffect, useMemo, useState } from 'react';
import { LOCAR_LANGUAGE, MEMO_FORMAT } from '@/lib/data/memoLanguage';
import { collectSources } from '@/lib/data/loader';
import { SourceStamp } from './SourceStamp';
import { MemoPreview } from './MemoPreview';
import { FONTS, FONT_SIZES } from '@/lib/mfr/fonts';
import {
  MAX_LEVEL,
  bodyOf,
  paraLabel,
  subOf,
  textOf,
} from '@/lib/mfr/format';
import {
  addPara,
  addSubPara,
  addTail,
  clearSubParas,
  clearDoc,
  deletePara,
  deleteTail,
  emptyDoc,
  loadDoc,
  newIndorsement,
  saveDoc,
  setParaText,
  setTailItem,
  tailList,
  type ParaRoot,
} from '@/lib/mfr/doc';
import {
  CUI_CATEGORIES,
  CUI_CONTROLS,
  buildSpec,
  cuiDesOn,
  cuiOn,
  indHead,
  locarAbbr,
  locarSkeleton,
  locarVerb,
} from '@/lib/mfr/spec';
import { buildPdf } from '@/lib/mfr/pdf';
import { DEFAULT_SEAL } from '@/lib/mfr/assets/seal';
import { buildDocx } from '@/lib/mfr/docx';
import { printDocument } from '@/lib/mfr/html';
import type {
  FontKey,
  LocarCategory,
  LocarType,
  MemoDoc,
  Para,
  TailField,
  TemplateId,
} from '@/lib/mfr/types';

/**
 * Memorandum generator: an official memorandum for record, and a letter of
 * counseling, admonishment or reprimand.
 *
 * Three things shape this component.
 *
 * The letterhead is a field, not a setting. This is a public tool with no unit
 * behind it, so the three header lines, their colour and the seal are typed by
 * whoever is writing the memorandum -- and an empty unit line is left empty
 * rather than guessed, because a wrong squadron printed on a signed letter is
 * worse than a blank one.
 *
 * Nothing it is given leaves the browser. People paste real names and real
 * misconduct in here. The draft lives in `localStorage` and the exports are
 * built in the page; there is no request to make and nowhere to send it.
 *
 * It renders, it does not advise. It will not tell you whether a letter is
 * warranted, whether the facts support it, or whether the policy it cites is
 * current. It formats what you wrote to AFH 33-337 and stamps the fixed
 * paragraphs the source form requires.
 *
 * ONE DELIBERATE DEVIATION from the project's constraints, the maintainer's explicit call after
 * the constraint was raised, and the same one the PT and BTZ calculators make.
 * Do not "fix" it by putting the banner back.
 *
 * Constraint 5 asks for a persistent unverified-data banner while any source is
 * a stub. Both language files are still `status: "stub"` and this tool does not
 * render one. Its standard wording is worded for a tool that computes: "these
 * numbers have not been transcribed from an official source, do not rely on
 * them". This tool computes nothing and has no numbers. It lays out text the
 * user wrote, and the fixed paragraphs it adds are quoted in full in the live
 * preview, where they can be read, edited and checked before anything is
 * signed. Provenance is still on the page and still honest: the source stamp at
 * the foot reads "Source (stub)" and names both forms, and the panel beside it
 * says what the tool will not do. Checking the wording against the official
 * forms and marking the files `verified` makes the two agree again.
 */

const LOCAR = LOCAR_LANGUAGE.data;
const { sources } = collectSources([LOCAR_LANGUAGE, MEMO_FORMAT]);

const TEMPLATES: ReadonlyArray<{ id: TemplateId; name: string; blurb: string }> = [
  {
    id: 'custom',
    name: 'Custom MFR',
    blurb:
      'Any memorandum for record. Set MEMORANDUM FOR and SUBJECT, then write numbered ' +
      'Tongue-and-Quill paragraphs, attachments and indorsements.',
  },
  {
    id: 'locar',
    name: 'LOCAR',
    blurb:
      'Letter of counseling, admonishment or reprimand. You write the facts and the action; ' +
      'the fixed Privacy Act and rights paragraphs and the three indorsements are added for you.',
  },
];

const CONTROL = {
  background: 'var(--panel-sunk)',
  borderColor: 'var(--rule-strong)',
  color: 'var(--ink)',
} as const;

// ---------------------------------------------------------------------------
// Small shared controls

function Panel({
  title,
  sub,
  children,
  right,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="title m-0">{title}</h2>
        {sub ? (
          <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            {sub}
          </span>
        ) : null}
        {right ? <div className="ml-auto">{right}</div> : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  grow,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[9rem] flex-col gap-1.5" style={grow ? { flex: 1 } : undefined}>
      <label className="util" htmlFor={htmlFor}>
        {label}
        {hint ? (
          <span className="ml-1.5 normal-case" style={{ letterSpacing: 0, fontWeight: 400 }}>
            {hint}
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLASS = 'w-full border px-2.5 py-2 text-[12.5px]';

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  upper,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upper?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT_CLASS}
      style={{ ...CONTROL, textTransform: upper ? 'uppercase' : 'none' }}
    />
  );
}

function TextArea({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT_CLASS} resize-y leading-relaxed`}
      style={{ ...CONTROL, fontFamily: 'inherit' }}
    />
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={INPUT_CLASS}
      style={CONTROL}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Button({
  children,
  onClick,
  primary,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  type?: 'button';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="cursor-pointer border px-3 py-2 text-[12px] font-semibold"
      style={
        primary
          ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
          : { background: 'var(--panel-raised)', borderColor: 'var(--rule-strong)', color: 'var(--ink)' }
      }
    >
      {children}
    </button>
  );
}

/** A quiet inline action: remove, add, clear. Never a primary button. */
function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] font-semibold underline"
      style={{ color: 'var(--accent)' }}
    >
      {children}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px]"
      />
      <span>
        {label}
        {hint ? (
          <span className="block text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </p>
  );
}

const options = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));

// ---------------------------------------------------------------------------
// Paragraph tree editor

function ParaEditor({
  doc,
  setDoc,
  root,
  path,
  level,
  label,
}: {
  doc: MemoDoc;
  setDoc: (next: MemoDoc) => void;
  root: ParaRoot;
  path: number[];
  level: number;
  label: string;
}) {
  const list = (root.kind === 'ind' ? doc.inds[root.index]?.paras : doc.paras) || [];
  let target: Para | undefined = list[path[0]!];
  for (let d = 1; d < path.length && target !== undefined; d++) {
    const kids = subOf(target);
    target = kids ? kids[path[d]!] : undefined;
  }
  if (target === undefined) return null;
  const node: Para = target;

  const sub = subOf(node);
  const body = bodyOf(node);
  const canNest = level + 1 < MAX_LEVEL;
  const id = `mfr-para-${root.kind}-${root.kind === 'ind' ? root.index : 0}-${path.join('-')}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <label className="util" htmlFor={id}>
          {label}
        </label>
        <span className="ml-auto flex gap-3">
          {sub ? <LinkButton onClick={() => setDoc(clearSubParas(doc, root, path))}>clear sub-paragraphs</LinkButton> : null}
          {canNest ? (
            <LinkButton onClick={() => setDoc(addSubPara(doc, root, path))}>+ sub-paragraph</LinkButton>
          ) : null}
          <LinkButton onClick={() => setDoc(deletePara(doc, root, path))}>remove</LinkButton>
        </span>
      </div>
      <TextArea
        id={id}
        rows={level ? 2 : 3}
        value={typeof body === 'string' ? body : textOf(node)}
        onChange={(v) => setDoc(setParaText(doc, root, path, v))}
        placeholder={level ? 'Sub-paragraph text…' : 'Paragraph text…'}
      />
      {sub ? (
        <div
          className="ml-4 flex flex-col gap-3 border-l-2 pl-3"
          style={{ borderColor: 'var(--rule)' }}
        >
          {sub.map((_, j) => (
            <ParaEditor
              key={j}
              doc={doc}
              setDoc={setDoc}
              root={root}
              path={path.concat(j)}
              level={level + 1}
              label={paraLabel(level + 1, j)}
            />
          ))}
          {sub.length === 1 ? (
            <p
              className="m-0 px-2.5 py-2 text-[11.5px]"
              style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}
            >
              A paragraph cannot be divided into one part. Add a{' '}
              <strong>{paraLabel(level + 1, 1)}</strong>, or clear the sub-paragraphs (AFH 33-337).
            </p>
          ) : null}
          <div>
            <LinkButton onClick={() => setDoc(addSubPara(doc, root, path))}>
              + add {paraLabel(level + 1, sub.length)}
            </LinkButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments / cc / distribution

const TAIL_META: Record<TailField, { add: string; placeholder: string; note: (n: number) => string }> = {
  atch: {
    add: '+ add attachment',
    placeholder: 'e.g. Memo, 82 RS/CC, 1 Jul 26',
    note: (n) => (n === 0 ? 'none' : n === 1 ? 'prints as “Attachment:”' : `prints as “${n} Attachments:”`),
  },
  cc: {
    add: '+ add courtesy copy',
    placeholder: 'e.g. Lt Col Casey, 82 RS/CC',
    note: (n) => (n === 0 ? 'none' : 'prints under “cc:”'),
  },
  distro: {
    add: '+ add addressee',
    placeholder: 'e.g. 82 RS/MXAA',
    note: (n) => (n === 0 ? 'none' : 'prints under “DISTRIBUTION:”'),
  },
};

function TailEditor({
  doc,
  setDoc,
  owner,
  field,
  label,
}: {
  doc: MemoDoc;
  setDoc: (next: MemoDoc) => void;
  owner: number | null;
  field: TailField;
  label: string;
}) {
  const meta = TAIL_META[field];
  const items = tailList(doc, owner, field);
  return (
    <div className="flex flex-col gap-2">
      <span className="util">
        {label}
        <span className="ml-1.5 normal-case" style={{ letterSpacing: 0, fontWeight: 400 }}>
          ({meta.note(items.filter((t) => t.trim()).length)})
        </span>
      </span>
      {items.map((item, j) => (
        <div key={j} className="flex items-center gap-2">
          <TextInput
            value={item}
            placeholder={meta.placeholder}
            onChange={(v) => setDoc(setTailItem(doc, owner, field, j, v))}
          />
          <LinkButton onClick={() => setDoc(deleteTail(doc, owner, field, j))}>remove</LinkButton>
        </div>
      ))}
      <div>
        <LinkButton onClick={() => setDoc(addTail(doc, owner, field))}>{meta.add}</LinkButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Letterhead -- the part this tool exists to make editable

function LetterheadEditor({
  doc,
  set,
  onSeal,
  onError,
}: {
  doc: MemoDoc;
  set: <K extends keyof MemoDoc>(key: K, value: MemoDoc[K]) => void;
  onSeal: (dataUrl: string) => void;
  onError: (message: string) => void;
}) {
  const readSeal = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      onError('That image is over 2 MB. Use a smaller one — the seal prints one inch square.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => onSeal(String(e.target?.result || ''));
    reader.onerror = () => onError('That file could not be read. Try a PNG or JPEG.');
    reader.readAsDataURL(file);
  };

  return (
    <Panel title="Letterhead" sub="Every line is yours to set">
      <Field label="Line 1" htmlFor="mfr-lh1" hint="the department line">
        <TextInput id="mfr-lh1" value={doc.lh1} onChange={(v) => set('lh1', v)} upper />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="Line 2" htmlFor="mfr-lh2" hint="your unit" grow>
          <TextInput
            id="mfr-lh2"
            value={doc.lh2}
            onChange={(v) => set('lh2', v)}
            placeholder="e.g. 82D RECONNAISSANCE SQUADRON (ACC)"
            upper
          />
        </Field>
        <Field label="Line 3" htmlFor="mfr-lh3" hint="installation, optional" grow>
          <TextInput
            id="mfr-lh3"
            value={doc.lh3}
            onChange={(v) => set('lh3', v)}
            placeholder="e.g. KADENA AIR BASE JAPAN"
            upper
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Colour" htmlFor="mfr-lhcolor">
          <input
            id="mfr-lhcolor"
            type="color"
            value={doc.lhColor}
            onChange={(e) => set('lhColor', e.target.value)}
            className="h-[38px] w-[4.5rem] cursor-pointer border p-1"
            style={CONTROL}
          />
        </Field>
        <Field label="Seal" htmlFor="mfr-seal" hint="replace the default">
          <input
            id="mfr-seal"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              readSeal(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="text-[11.5px]"
          />
        </Field>
        <div className="flex items-center gap-3 pb-1">
          {doc.seal ? (
            <img
              src={doc.seal}
              alt="Letterhead seal"
              className="h-10 w-10 border object-contain"
              style={{ borderColor: 'var(--rule)', background: '#fff' }}
            />
          ) : null}
          {doc.seal ? <LinkButton onClick={() => set('seal', '')}>remove seal</LinkButton> : null}
          {doc.seal !== DEFAULT_SEAL ? (
            <LinkButton onClick={() => set('seal', DEFAULT_SEAL)}>use the default seal</LinkButton>
          ) : null}
        </div>
      </div>
      <Note>
        A seal you upload replaces the default one and stays in this browser, the same as everything
        else you type here.
      </Note>
    </Panel>
  );
}

function FormatPanel({
  doc,
  set,
}: {
  doc: MemoDoc;
  set: <K extends keyof MemoDoc>(key: K, value: MemoDoc[K]) => void;
}) {
  return (
    <Panel title="Format" sub="AFH 33-337 — Times New Roman, 12 pt">
      <div className="flex flex-wrap gap-3">
        <Field label="Body font" htmlFor="mfr-font" grow>
          <Select
            id="mfr-font"
            value={doc.font}
            onChange={(v) => set('font', v as FontKey)}
            options={FONTS.map((f) => ({
              value: f.key,
              label: f.key === 'times' ? `${f.label} — standard` : f.label,
            }))}
          />
        </Field>
        <Field label="Size" htmlFor="mfr-size" hint="10–12 pt" grow>
          <Select
            id="mfr-size"
            value={String(doc.fontSize)}
            onChange={(v) => set('fontSize', Number(v))}
            options={FONT_SIZES.map((s) => ({
              value: String(s),
              label: s === 12 ? `${s} pt — standard` : `${s} pt`,
            }))}
          />
        </Field>
      </div>
      <Note>
        The letterhead is set in Copperplate Gothic Bold and the face travels inside the page, so the
        preview, the PDF and the print view all render it the same on any machine. The Word export
        names the font instead of carrying it, so Word uses your installed copy.
      </Note>
    </Panel>
  );
}

function SignaturePanel({
  doc,
  set,
}: {
  doc: MemoDoc;
  set: <K extends keyof MemoDoc>(key: K, value: MemoDoc[K]) => void;
}) {
  return (
    <Panel title="Signature block">
      <div className="flex flex-wrap gap-3">
        <Field label="Rank" htmlFor="mfr-sig-rank">
          <TextInput id="mfr-sig-rank" value={doc.prepRank} onChange={(v) => set('prepRank', v)} placeholder="e.g. TSgt" />
        </Field>
        <Field label="Name" htmlFor="mfr-sig-name" hint="first middle last" grow>
          <TextInput
            id="mfr-sig-name"
            value={doc.prepName}
            onChange={(v) => set('prepName', v)}
            placeholder="e.g. John D. Smith"
          />
        </Field>
      </div>
      <Field label="Duty title" htmlFor="mfr-sig-title">
        <TextInput
          id="mfr-sig-title"
          value={doc.prepTitle}
          onChange={(v) => set('prepTitle', v)}
          placeholder="e.g. NCOIC, Production"
        />
      </Field>
      <Note>
        The name prints shouted with a middle initial, whichever way you type it — “Smith, John
        Daniel” and “John Daniel Smith” both come out JOHN D. SMITH.
      </Note>
    </Panel>
  );
}

function CuiPanel({
  doc,
  set,
  setDoc,
}: {
  doc: MemoDoc;
  set: <K extends keyof MemoDoc>(key: K, value: MemoDoc[K]) => void;
  setDoc: (next: MemoDoc) => void;
}) {
  const on = cuiOn(doc);
  const desOn = cuiDesOn(doc);
  const setMap = (key: 'cuiMap' | 'cuiDesMap', value: boolean) =>
    setDoc({ ...doc, [key]: { ...doc[key], [doc.template]: value } });

  const addCategory = (v: string) => {
    if (!v) return;
    const current = String(doc.cuiDesCat || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!current.includes(v)) current.push(v);
    set('cuiDesCat', current.join(', '));
  };

  return (
    <Panel title="CUI marking">
      <Checkbox
        checked={on}
        onChange={(v) => setMap('cuiMap', v)}
        label={
          <>
            Mark <strong>CUI</strong>
          </>
        }
        hint="Controlled Unclassified Information — top and bottom of every page."
      />
      <Checkbox
        checked={desOn}
        onChange={(v) => setMap('cuiDesMap', v)}
        label="Add the CUI designation indicator"
        hint="The block at the bottom right of the first page — DoDI 5200.48, para 3.4(f)."
      />
      {desOn ? (
        <div className="flex flex-col gap-3 rounded border p-3" style={{ borderColor: 'var(--rule)' }}>
          <Note>
            Leave a line blank and it is not printed. The DoD Component line is not required when the
            letterhead already identifies it.
          </Note>
          <Field label="Controlled by — DoD Component" htmlFor="mfr-cui-comp" hint="optional">
            <TextInput id="mfr-cui-comp" value={doc.cuiDesComp} onChange={(v) => set('cuiDesComp', v)} />
          </Field>
          <Field label="Controlled by — office" htmlFor="mfr-cui-office" hint="the office creating the document">
            <TextInput
              id="mfr-cui-office"
              value={doc.cuiDesOffice}
              onChange={(v) => set('cuiDesOffice', v)}
              placeholder={doc.template === 'locar' ? doc.locarFrom : doc.from}
            />
          </Field>
          <Field label="Add a category" htmlFor="mfr-cui-pick" hint="adds to the line below — pick more than one">
            <Select
              id="mfr-cui-pick"
              value=""
              onChange={addCategory}
              options={[{ value: '', label: 'Choose…' }].concat(
                CUI_CATEGORIES.map(([code, desc]) => ({ value: code, label: `${code} — ${desc}` })),
              )}
            />
          </Field>
          <Field label="CUI category(ies)" htmlFor="mfr-cui-cat">
            <TextInput
              id="mfr-cui-cat"
              value={doc.cuiDesCat}
              onChange={(v) => set('cuiDesCat', v)}
              placeholder="PRVCY"
            />
          </Field>
          <Field label="Set the control" htmlFor="mfr-cui-ctrl" hint="replaces the line below">
            <Select
              id="mfr-cui-ctrl"
              value={doc.cuiDesDist}
              onChange={(v) => set('cuiDesDist', v)}
              options={[{ value: '', label: 'None — omit the line' }].concat(
                CUI_CONTROLS.map(([code, desc]) => ({ value: code, label: `${code} — ${desc}` })),
              )}
            />
          </Field>
          <Field label="Distribution / limited dissemination control" htmlFor="mfr-cui-dist" hint="optional">
            <TextInput id="mfr-cui-dist" value={doc.cuiDesDist} onChange={(v) => set('cuiDesDist', v)} />
          </Field>
          <Field label="POC" htmlFor="mfr-cui-poc" hint="name, DSN or office mailbox">
            <TextInput id="mfr-cui-poc" value={doc.cuiDesPoc} onChange={(v) => set('cuiDesPoc', v)} />
          </Field>
        </div>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Indorsements

function IndorsementEditor({
  doc,
  setDoc,
}: {
  doc: MemoDoc;
  setDoc: (next: MemoDoc) => void;
}) {
  const spec = buildSpec(doc);
  const base = { from: spec.from, date: spec.date, subject: spec.subject };

  const setInd = (i: number, patch: Partial<MemoDoc['inds'][number]>) => {
    const inds = doc.inds.slice();
    const current = inds[i];
    if (!current) return;
    inds[i] = { ...current, ...patch };
    setDoc({ ...doc, inds });
  };

  return (
    <Panel title="Indorsements" sub="1st Ind · 2d Ind · 3d Ind (AFH 33-337)">
      <Note>
        An indorsement forwards this memorandum up or back down the chain. Each is numbered
        independently and carries its own signature block and attachments.
      </Note>
      {doc.inds.map((ind, i) => {
        const head = indHead(ind, i, base);
        const separate = (ind.form || 'ref') === 'ref';
        const ord = head.head.split(' ')[0]!;
        return (
          <div key={i} className="flex flex-col gap-3 rounded border p-3" style={{ borderColor: 'var(--rule)' }}>
            <div className="flex items-baseline gap-3">
              <h3 className="title m-0">{ord} Ind</h3>
              <span className="ml-auto">
                <LinkButton onClick={() => setDoc({ ...doc, inds: doc.inds.filter((_, j) => j !== i) })}>
                  remove
                </LinkButton>
              </span>
            </div>

            <Field label="Header form" htmlFor={`mfr-ind-form-${i}`}>
              <Select
                id={`mfr-ind-form-${i}`}
                value={ind.form || 'ref'}
                onChange={(v) => setInd(i, { form: v as 'ref' | 'own' })}
                options={[
                  { value: 'ref', label: 'Separate page — cites this memo, then the indorsing office' },
                  { value: 'own', label: 'Same page — “n Ind, <office>” with the date on the right' },
                ]}
              />
            </Field>

            {separate ? (
              <>
                <div className="flex flex-wrap gap-3">
                  <Field label="Office of origin" htmlFor={`mfr-ind-office-${i}`} hint="auto" grow>
                    <TextInput
                      id={`mfr-ind-office-${i}`}
                      value={ind.refOffice || ''}
                      placeholder={base.from}
                      onChange={(v) => setInd(i, { refOffice: v })}
                    />
                  </Field>
                  <Field label="Date of this memo" htmlFor={`mfr-ind-refdate-${i}`} hint="auto" grow>
                    <TextInput
                      id={`mfr-ind-refdate-${i}`}
                      value={ind.refDate || ''}
                      placeholder={base.date}
                      onChange={(v) => setInd(i, { refDate: v })}
                    />
                  </Field>
                </div>
                <Field label="Subject of this memo" htmlFor={`mfr-ind-refsubj-${i}`} hint="auto">
                  <TextInput
                    id={`mfr-ind-refsubj-${i}`}
                    value={ind.refSubject || ''}
                    placeholder={base.subject}
                    onChange={(v) => setInd(i, { refSubject: v })}
                  />
                </Field>
              </>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Field label="Indorsing office" htmlFor={`mfr-ind-ioffice-${i}`} grow>
                <TextInput
                  id={`mfr-ind-ioffice-${i}`}
                  value={ind.office || ''}
                  placeholder={base.from}
                  onChange={(v) => setInd(i, { office: v })}
                />
              </Field>
              <Field label="Date" htmlFor={`mfr-ind-date-${i}`} grow>
                <TextInput
                  id={`mfr-ind-date-${i}`}
                  value={ind.date || ''}
                  placeholder={separate ? base.date : '________________ (date)'}
                  onChange={(v) => setInd(i, { date: v })}
                />
              </Field>
            </div>

            <Field label="Second line" htmlFor={`mfr-ind-line2-${i}`} hint="optional — who indorses">
              <TextInput
                id={`mfr-ind-line2-${i}`}
                value={ind.line2 || ''}
                onChange={(v) => setInd(i, { line2: v })}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="MEMORANDUM FOR" htmlFor={`mfr-ind-for-${i}`} hint="optional" grow>
                <TextInput
                  id={`mfr-ind-for-${i}`}
                  value={ind.memoFor || ''}
                  placeholder="e.g. 82 RS/CC"
                  onChange={(v) => setInd(i, { memoFor: v })}
                />
              </Field>
              <Field label="Indorsement subject" htmlFor={`mfr-ind-subj-${i}`} hint="optional" grow>
                <TextInput
                  id={`mfr-ind-subj-${i}`}
                  value={ind.subj || ''}
                  placeholder="e.g. ACKNOWLEDGEMENT"
                  onChange={(v) => setInd(i, { subj: v })}
                />
              </Field>
            </div>

            <p className="m-0 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              Prints as <strong>{head.head}</strong>
              {head.headRight ? <> … <strong>{head.headRight}</strong></> : null}
              {head.line2 ? (
                <>
                  <br />
                  <strong>{head.line2}</strong>
                  {head.line2Right ? <> … <strong>{head.line2Right}</strong></> : null}
                </>
              ) : null}
            </p>

            {(ind.paras.length ? ind.paras : ['']).map((_, j) => (
              <ParaEditor
                key={j}
                doc={doc}
                setDoc={setDoc}
                root={{ kind: 'ind', index: i }}
                path={[j]}
                level={0}
                label={`Paragraph ${j + 1}`}
              />
            ))}
            <div>
              <LinkButton onClick={() => setDoc(addPara(doc, { kind: 'ind', index: i }))}>
                + add paragraph
              </LinkButton>
            </div>

            <div className="flex flex-wrap gap-3">
              <Field label="Signed — rank" htmlFor={`mfr-ind-rank-${i}`}>
                <TextInput
                  id={`mfr-ind-rank-${i}`}
                  value={ind.sigRank || ''}
                  placeholder="e.g. Lt Col"
                  onChange={(v) => setInd(i, { sigRank: v })}
                />
              </Field>
              <Field label="Signed — name" htmlFor={`mfr-ind-name-${i}`} grow>
                <TextInput
                  id={`mfr-ind-name-${i}`}
                  value={ind.sigName || ''}
                  onChange={(v) => setInd(i, { sigName: v })}
                />
              </Field>
              <Field label="Duty title" htmlFor={`mfr-ind-title-${i}`} grow>
                <TextInput
                  id={`mfr-ind-title-${i}`}
                  value={ind.sigTitle || ''}
                  placeholder="e.g. Commander"
                  onChange={(v) => setInd(i, { sigTitle: v })}
                />
              </Field>
            </div>

            <TailEditor doc={doc} setDoc={setDoc} owner={i} field="atch" label="Attachments to this indorsement" />
            <TailEditor doc={doc} setDoc={setDoc} owner={i} field="cc" label="cc:" />
          </div>
        );
      })}
      <div>
        <LinkButton onClick={() => setDoc({ ...doc, inds: doc.inds.concat(newIndorsement(doc.inds.length)) })}>
          + add indorsement
        </LinkButton>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Sample library picker (LOCAR)

function SamplePicker({
  id,
  label,
  samples,
  onApply,
}: {
  id: string;
  label: string;
  samples: ReadonlyArray<{ label: string; text: string }>;
  onApply: (text: string, mode: 'replace' | 'append') => void;
}) {
  const [choice, setChoice] = useState('');
  const text = samples.find((s) => s.label === choice)?.text;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={label} htmlFor={id} grow>
        <Select
          id={id}
          value={choice}
          onChange={setChoice}
          options={[{ value: '', label: '— choose a category —' }].concat(
            samples.map((s) => ({ value: s.label, label: s.label })),
          )}
        />
      </Field>
      <Button onClick={() => text && onApply(text, 'replace')}>Replace</Button>
      <Button onClick={() => text && onApply(text, 'append')}>Append</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function MfrGenerator() {
  const [doc, setDocState] = useState<MemoDoc>(emptyDoc);
  const [status, setStatus] = useState('');
  const [pageCount, setPageCount] = useState(1);

  // Hydrated in an effect rather than in the initial state: the page is
  // pre-rendered, and reading localStorage during render would make the server
  // and client markup disagree.
  useEffect(() => {
    setDocState(loadDoc());
  }, []);

  const setDoc = useCallback((next: MemoDoc) => {
    setDocState(next);
    saveDoc(next);
  }, []);

  const set = useCallback(
    <K extends keyof MemoDoc>(key: K, value: MemoDoc[K]) => {
      setDocState((prev) => {
        const next = { ...prev, [key]: value };
        saveDoc(next);
        return next;
      });
    },
    [],
  );

  const spec = useMemo(() => buildSpec(doc), [doc]);
  const isLocar = doc.template === 'locar';
  const verb = locarVerb(doc.locarType);

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  /**
   * Everything the memorandum is still missing, or '' when it can be exported.
   *
   * Named rather than greyed out, and shown beside the buttons before anything
   * is clicked rather than only after: a control that refuses silently is
   * indistinguishable from one that is broken.
   *
   * All of them at once, not the first: fixing one field and being told about
   * the next is three rounds of the same conversation.
   */
  const missing = (): string => {
    const wanted: string[] = [];
    if (!String(spec.from).trim()) wanted.push('the FROM office symbol');
    if (!String(spec.subject).trim()) wanted.push('a subject');
    if (!spec.paras.some((p) => textOf(p).trim())) wanted.push('at least one paragraph');
    if (!wanted.length) return '';
    const list =
      wanted.length === 1
        ? wanted[0]!
        : `${wanted.slice(0, -1).join(', ')} and ${wanted[wanted.length - 1]!}`;
    return `Add ${list} before downloading.`;
  };
  const blocked = missing();

  const onPdf = async () => {
    if (blocked) {
      setStatus(blocked);
      return;
    }
    try {
      download(await buildPdf(doc, spec), `${spec.filename}.pdf`);
      setStatus('PDF downloaded. Apply your CAC signature before you distribute it.');
    } catch (e) {
      setStatus(
        `The PDF could not be built: ${
          e instanceof Error ? e.message : String(e)
        }. Use Print view and save as PDF instead.`,
      );
    }
  };

  const onWord = () => {
    if (blocked) {
      setStatus(blocked);
      return;
    }
    try {
      download(buildDocx(doc, spec), `${spec.filename}.docx`);
      setStatus('Word document downloaded. It opens editable, with the same layout as the PDF.');
    } catch (e) {
      setStatus(`The Word export failed: ${e instanceof Error ? e.message : String(e)}.`);
    }
  };

  const onPrint = () => {
    const w = window.open('', '_blank');
    if (!w) {
      setStatus('Your browser blocked the print window. Allow pop-ups for this page, then try again.');
      return;
    }
    w.document.write(printDocument(doc, spec));
    w.document.close();
  };

  const onReset = () => {
    clearDoc();
    setDocState(emptyDoc());
    setStatus('Draft cleared. Nothing was kept.');
  };

  const setTemplate = (id: TemplateId) => {
    set('template', id);
    setStatus('');
  };

  const applySample = (field: 'locarOffense' | 'locarCorrective', text: string, mode: 'replace' | 'append') => {
    const current = String(doc[field] || '').trim();
    set(field, mode === 'append' && current ? `${current}  ${text}` : text);
  };

  const loadSkeleton = () => {
    const skeleton = locarSkeleton();
    setDoc({ ...doc, locarOffense: skeleton.offense, locarCorrective: skeleton.corrective });
    setStatus('Standard wording loaded into paragraphs 1 and 2. Replace every (placeholder).');
  };

  return (
    <div className="mx-auto max-w-[1560px] px-3 sm:px-6 py-8">
      <div className="flex flex-col gap-4">
        <section className="panel p-4">
          <div className="flex flex-wrap gap-3">
            {TEMPLATES.map((t) => {
              const active = doc.template === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  aria-pressed={active}
                  className="flex-1 cursor-pointer border p-3 text-left"
                  style={{
                    minWidth: '16rem',
                    borderColor: active ? 'var(--accent)' : 'var(--rule)',
                    borderWidth: active ? 2 : 1,
                    background: active ? 'var(--accent-dim)' : 'var(--panel-raised)',
                  }}
                >
                  <span
                    className="block text-[13px] font-bold"
                    style={{ color: active ? 'var(--accent-strong)' : 'var(--ink)', letterSpacing: '0.06em' }}
                  >
                    {t.name.toUpperCase()}
                  </span>
                  <span
                    className="mt-1.5 block text-[11.5px] leading-relaxed"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {t.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <p
          className="m-0 px-1 text-[11.5px] leading-relaxed"
          style={{ color: 'var(--ink-muted)' }}
        >
          Everything you type stays on this device. The draft is saved in this browser only, the PDF and
          Word files are built here, and nothing is uploaded, logged or sent anywhere.
        </p>
      </div>

      {/* The preview column is the wider of the two: a sheet is scaled to fit it,
          so every pixel it gets back is legibility the reader keeps. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ---------------- Editor ---------------- */}
        <div className="flex flex-col gap-4">
          <LetterheadEditor doc={doc} set={set} onSeal={(v) => set('seal', v)} onError={setStatus} />
          <FormatPanel doc={doc} set={set} />

          {isLocar ? (
            <>
              <Panel title="Issuer" sub="who signs the letter">
                <Field label="Duty title" htmlFor="mfr-locar-title" hint="e.g. Commander">
                  <TextInput
                    id="mfr-locar-title"
                    value={doc.prepTitle}
                    onChange={(v) => set('prepTitle', v)}
                    placeholder="e.g. Section Chief"
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Field label="Rank" htmlFor="mfr-locar-rank">
                    <Select
                      id="mfr-locar-rank"
                      value={doc.prepRank}
                      onChange={(v) => set('prepRank', v)}
                      options={[{ value: '', label: '—' }].concat(options(LOCAR.issuerRanks))}
                    />
                  </Field>
                  <Field label="Name" htmlFor="mfr-locar-name" hint="first middle last" grow>
                    <TextInput
                      id="mfr-locar-name"
                      value={doc.prepName}
                      onChange={(v) => set('prepName', v)}
                      placeholder="e.g. John D. Smith"
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Field label="FROM: office symbol" htmlFor="mfr-locar-from" grow>
                    <TextInput
                      id="mfr-locar-from"
                      value={doc.locarFrom}
                      onChange={(v) => set('locarFrom', v)}
                      placeholder="e.g. 82 RS/MXAA"
                    />
                  </Field>
                  <Field label="Post-nominal" htmlFor="mfr-locar-post" hint="optional" grow>
                    <TextInput
                      id="mfr-locar-post"
                      value={doc.prepPost}
                      onChange={(v) => set('prepPost', v)}
                      placeholder="e.g. BSC"
                    />
                  </Field>
                </div>
              </Panel>

              <Panel title="Recipient and action">
                <div className="flex flex-wrap gap-3">
                  <Field label="Category" htmlFor="mfr-locar-cat" grow>
                    <Select
                      id="mfr-locar-cat"
                      value={doc.locarCat}
                      onChange={(v) => {
                        const cat = v as LocarCategory;
                        const ranks = LOCAR.recipientRanks[cat] || [];
                        setDoc({
                          ...doc,
                          locarCat: cat,
                          locarRecipRank: ranks[0] || '',
                          locarUif: cat === 'Enlisted' ? 'none' : doc.locarUif,
                        });
                      }}
                      options={options(Object.keys(LOCAR.recipientRanks))}
                    />
                  </Field>
                  <Field label="Rank" htmlFor="mfr-locar-reciprank" grow>
                    <Select
                      id="mfr-locar-reciprank"
                      value={doc.locarRecipRank}
                      onChange={(v) => set('locarRecipRank', v)}
                      options={options(LOCAR.recipientRanks[doc.locarCat] || [])}
                    />
                  </Field>
                  <Field label="Type" htmlFor="mfr-locar-type" grow>
                    <Select
                      id="mfr-locar-type"
                      value={doc.locarType}
                      onChange={(v) => set('locarType', v as LocarType)}
                      options={LOCAR.types.map((t) => ({ value: t, label: `${t} (${locarAbbr(t)})` }))}
                    />
                  </Field>
                </div>
                <Field label="Recipient's name" htmlFor="mfr-locar-recip" hint="first middle last">
                  <TextInput
                    id="mfr-locar-recip"
                    value={doc.locarRecipName}
                    onChange={(v) => set('locarRecipName', v)}
                    placeholder="e.g. John A. Snuffy"
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Field label="Day to be served" htmlFor="mfr-locar-day" grow>
                    <input
                      id="mfr-locar-day"
                      type="date"
                      value={doc.locarDayServed}
                      onChange={(e) => set('locarDayServed', e.target.value)}
                      className={`${INPUT_CLASS} tabular`}
                      style={CONTROL}
                    />
                  </Field>
                  <Field label="Other info" htmlFor="mfr-locar-other" hint="appended to MEMORANDUM FOR" grow>
                    <TextInput
                      id="mfr-locar-other"
                      value={doc.locarOtherInfo}
                      onChange={(v) => set('locarOtherInfo', v)}
                      placeholder="e.g. office symbol"
                    />
                  </Field>
                </div>
                <Field label="UIF referral" htmlFor="mfr-locar-uif">
                  <Select
                    id="mfr-locar-uif"
                    value={doc.locarUif}
                    onChange={(v) => set('locarUif', v as 'none' | 'recommend')}
                    options={[
                      { value: 'none', label: 'Do not intend to refer to a UIF' },
                      { value: 'recommend', label: 'Recommend the commander file it in a UIF' },
                    ]}
                  />
                </Field>
              </Panel>

              <Panel title="Paragraph 1 — the offence" right={<LinkButton onClick={loadSkeleton}>load standard wording</LinkButton>}>
                <Note>
                  This becomes paragraph 1. It usually begins “Investigation has disclosed that on or
                  about (date)…”. Resolve every (placeholder) before the letter is served.
                </Note>
                <TextArea
                  id="mfr-locar-offense"
                  rows={5}
                  value={doc.locarOffense}
                  onChange={(v) => set('locarOffense', v)}
                  placeholder="Investigation has disclosed that on or about (date)…"
                />
                <SamplePicker
                  id="mfr-locar-offsample"
                  label="Sample offence"
                  samples={LOCAR.offenseSamples}
                  onApply={(t, mode) => applySample('locarOffense', t, mode)}
                />
              </Panel>

              <Panel title={`Paragraph 2 — the ${doc.locarType.toLowerCase()}`}>
                <Note>
                  Paragraph 2 opens with the fixed sentence <strong>“You are hereby {verb}.”</strong>{' '}
                  Add the rest: the impact of what the member did or failed to do, and what improvement
                  is expected.
                </Note>
                <TextArea
                  id="mfr-locar-corrective"
                  rows={5}
                  value={doc.locarCorrective}
                  onChange={(v) => set('locarCorrective', v)}
                  placeholder={`Remainder of the ${doc.locarType.toLowerCase()}…`}
                />
                <SamplePicker
                  id="mfr-locar-corsample"
                  label="Sample language"
                  samples={LOCAR.correctiveSamples}
                  onApply={(t, mode) => applySample('locarCorrective', t, mode)}
                />
                <p
                  className="m-0 rounded px-3 py-2.5 text-[11.5px] leading-relaxed"
                  style={{ background: 'var(--panel-raised)', color: 'var(--ink-muted)' }}
                >
                  <strong>Added for you:</strong> paragraph 3 (Privacy Act statement) and paragraph 4
                  (receipt and rights), both fixed, then the 1st, 2d and 3d indorsements —
                  acknowledgment, decision, final acknowledgment.
                </p>
              </Panel>
            </>
          ) : (
            <>
              <Panel title="Memorandum">
                <Field label="MEMORANDUM FOR" htmlFor="mfr-for">
                  <TextInput
                    id="mfr-for"
                    value={doc.memoFor}
                    onChange={(v) => set('memoFor', v)}
                    placeholder="RECORD"
                  />
                </Field>
                <Field label="FROM:" htmlFor="mfr-from" hint="your office symbol">
                  <TextInput
                    id="mfr-from"
                    value={doc.from}
                    onChange={(v) => set('from', v)}
                    placeholder="e.g. 82 RS/MXAA"
                  />
                </Field>
                <Field label="SUBJECT:" htmlFor="mfr-subject">
                  <TextInput
                    id="mfr-subject"
                    value={doc.subject}
                    onChange={(v) => set('subject', v)}
                    placeholder="e.g. Request for Additional Manning"
                  />
                </Field>
              </Panel>

              <Panel title="Body" sub="numbered paragraphs, auto-numbered in the output">
                <Note>
                  One idea per paragraph. Use <strong>+ sub-paragraph</strong> to subdivide: 1. → a. →
                  (1) → (a), each a quarter inch further in.
                </Note>
                {doc.paras.map((_, i) => (
                  <ParaEditor
                    key={i}
                    doc={doc}
                    setDoc={setDoc}
                    root={{ kind: 'body' }}
                    path={[i]}
                    level={0}
                    label={`Paragraph ${i + 1}`}
                  />
                ))}
                <div>
                  <LinkButton onClick={() => setDoc(addPara(doc, { kind: 'body' }))}>+ add paragraph</LinkButton>
                </div>
              </Panel>

              <Panel title="Below the signature" sub="attachments · courtesy copies · distribution">
                <Note>
                  Whichever you use first begins on the third line below the duty title; each one after
                  it on the second line below the one before. Leave a list empty and it is not printed.
                </Note>
                <TailEditor doc={doc} setDoc={setDoc} owner={null} field="atch" label="Attachments" />
                <TailEditor doc={doc} setDoc={setDoc} owner={null} field="cc" label="cc:" />
                <TailEditor doc={doc} setDoc={setDoc} owner={null} field="distro" label="DISTRIBUTION:" />
              </Panel>

              <SignaturePanel doc={doc} set={set} />
              <IndorsementEditor doc={doc} setDoc={setDoc} />
            </>
          )}

          <CuiPanel doc={doc} set={set} setDoc={setDoc} />

          <section className="panel flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button primary onClick={onPdf}>
                Download PDF
              </Button>
              <Button onClick={onWord}>Download Word</Button>
              <Button onClick={onPrint}>Print view</Button>
              <span className="ml-auto">
                <LinkButton onClick={onReset}>clear draft</LinkButton>
              </span>
            </div>
            {/* Whatever the buttons will not do yet, said where the buttons
                are. The transient result of a click lands in the same place. */}
            {blocked || status ? (
              <p
                role="status"
                className="m-0 rounded px-3 py-2.5 text-[11.5px] leading-relaxed"
                style={
                  blocked
                    ? { background: 'var(--warn-dim)', color: 'var(--warn)' }
                    : { background: 'var(--accent-dim)', color: 'var(--ink)' }
                }
              >
                {blocked || status}
              </p>
            ) : null}
          </section>

          <section className="panel p-4">
            <SourceStamp sources={sources} />
            <p className="m-0 mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              This tool formats what you write. It does not decide whether a letter is warranted,
              whether the facts support it, or whether the policy it cites is current — official
              guidance governs.
            </p>
          </section>
        </div>

        {/* ---------------- Preview ---------------- */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="title m-0">Live preview</h2>
              <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                updates as you type
              </span>
              <span className="util-value ml-auto tabular">
                {pageCount} page{pageCount === 1 ? '' : 's'}
              </span>
            </div>
            <MemoPreview doc={doc} spec={spec} onPageCount={setPageCount} />
          </section>
        </div>
      </div>
    </div>
  );
}
