import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  INSTALLATIONS,
  NATIONAL,
  REFERENCES,
  SITUATIONS,
  categoriesByUrgency,
  contactFor,
  getCategory,
  getSituation,
  isContactPopulated,
  isReferencePopulated,
  nationalFallbacks,
  realInstallations,
} from '@/lib/data/firstSergeant';
import type { AgencyCategory, Contact, Installation, Situation } from '@/lib/data/types';
import { search, type SearchResult } from '@/lib/firstsergeant/search';
import {
  EMPTY_STATE,
  STORE_KEY,
  SUGGESTED_ROLES,
  emptyContact,
  isUsable,
  parseState,
  serializeState,
  type ToolkitState,
  type UnitContact,
} from '@/lib/firstsergeant/unitContacts';
import { SourceStamp } from './SourceStamp';

/**
 * First Sergeant Toolkit.
 *
 * Answers one question: an Airman came to me with X, where do I send them?
 *
 * It is a routing directory and it says so. It never diagnoses, never decides,
 * and never restates policy in its own words -- it names the agency, gives the
 * number, and cites where the number came from. The official source governs,
 * and every card carries the stamp that says which source that is.
 *
 * Nothing here is invented. Local contact details come from an installation's
 * Military OneSource page and ship empty until a maintainer fills them in;
 * where a base has nothing populated, the toolkit falls back to Military
 * OneSource itself rather than showing a plausible guess.
 */

type Tab = 'help' | 'directory' | 'references';

const TABS: { id: Tab; label: string }[] = [
  { id: 'help', label: 'Find help' },
  { id: 'directory', label: 'Directory' },
  { id: 'references', label: 'References' },
];

export default function FirstSergeantToolkit() {
  const [state, setState] = useState<ToolkitState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('help');
  const [query, setQuery] = useState('');
  const [openSituation, setOpenSituation] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  // localStorage only -- see constraint 2. Read after mount so the static
  // markup and the first client render agree.
  useEffect(() => {
    try {
      setState(parseState(localStorage.getItem(STORE_KEY)));
    } catch {
      /* Blocked storage: the toolkit still works, it just forgets. */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE_KEY, serializeState(state));
    } catch {
      /* Nothing to do; the unit list simply is not remembered. */
    }
  }, [state, loaded]);

  const usable = useMemo(() => realInstallations(), []);
  const selected = INSTALLATIONS.find((i) => i.data.id === state.installationId);
  const installation = selected?.data ?? null;
  const installationMeta = selected?.meta ?? null;

  const categoryLabel = (id: string) => getCategory(id)?.label ?? id;

  const results = useMemo(
    () => search(query, SITUATIONS.data, CATEGORIES.data, categoryLabel),
    [query],
  );

  const situation = openSituation ? (getSituation(openSituation) ?? null) : null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-3 sm:px-6 py-6">
      <IntroPanel installationCount={usable.length} />

      <InstallationBar
        installation={installation}
        onChange={(id) => setState((s) => ({ ...s, installationId: id }))}
        onQuick={() => setQuickOpen((v) => !v)}
        quickOpen={quickOpen}
      />

      {quickOpen && <QuickContacts installation={installation} />}

      <nav className="flex flex-wrap gap-2" aria-label="Toolkit sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className="util rounded-full px-4 py-2"
            style={{
              background: tab === t.id ? 'var(--accent)' : 'var(--panel)',
              color: tab === t.id ? '#ffffff' : 'var(--ink-muted)',
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--rule)'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'help' && (
        <FindHelp
          query={query}
          setQuery={setQuery}
          results={results}
          onOpenSituation={(id) => setOpenSituation(id)}
          onOpenCategory={() => setTab('directory')}
          situation={situation}
          onCloseSituation={() => setOpenSituation(null)}
          installation={installation}
        />
      )}

      {tab === 'directory' && (
        <Directory
          installation={installation}
          unitContacts={state.unitContacts}
          onUnitContacts={(unitContacts) => setState((s) => ({ ...s, unitContacts }))}
        />
      )}

      {tab === 'references' && <ReferenceList />}

      {/*
        Provenance, out of the way.
        
        The stamp is collapsed rather than deleted: what actually matters is
        attached to each number -- every contact card carries an "Official
        source" link straight to the MilitaryINSTALLATIONS page it was read
        from, which is better provenance than a page-level list ever was. This
        is the file-level view for anyone who wants it.
        
        Only the sources behind what is on screen. Listing all seventy-odd
        installation files would bury the four that matter.
      */}
      <details className="panel p-4">
        <summary className="util cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
          Sources
        </summary>
        <div className="mt-3">
          <SourceStamp
            sources={[
              NATIONAL.meta,
              ...(installationMeta ? [installationMeta] : []),
              CATEGORIES.meta,
              SITUATIONS.meta,
              REFERENCES.meta,
            ]}
          />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * States what the toolkit is before anyone uses it.
 *
 * A directory that looks authoritative and is half-populated is worse than one
 * that says plainly what it does and does not know, so this is not dismissible.
 */
function IntroPanel({ installationCount }: { installationCount: number }) {
  return (
    <section className="panel p-4">
      <h2 className="title m-0">Routing, not policy</h2>
      <p className="m-0 mt-2 max-w-[80ch] text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        This points you at the agency that owns a problem and shows where its details came
        from. It does not decide anything, and it is not a substitute for current guidance
        or your chain of command. In an emergency, use your installation's emergency
        number.
      </p>
      {installationCount === 0 && (
        <p className="m-0 mt-2 max-w-[80ch] text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          No installation directories are populated yet, so every card falls back to
          Military OneSource — which is worldwide, answers around the clock, and can route
          to the right local agency itself.
        </p>
      )}
    </section>
  );
}

function InstallationBar({
  installation,
  onChange,
  onQuick,
  quickOpen,
}: {
  installation: Installation | null;
  onChange: (id: string) => void;
  onQuick: () => void;
  quickOpen: boolean;
}) {
  return (
    <section className="panel flex flex-wrap items-end gap-x-8 gap-y-4 p-4">
      <div className="flex flex-col gap-1.5">
        <label className="util" htmlFor="fs-installation">
          Installation
        </label>
        <select
          id="fs-installation"
          value={installation?.id ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="border px-3 py-2 text-[12.5px]"
          style={{
            background: 'var(--panel-sunk)',
            borderColor: 'var(--rule-strong)',
            color: 'var(--ink)',
            width: '20rem',
            maxWidth: '100%',
          }}
        >
          <option value="">No installation — worldwide resources only</option>
          {INSTALLATIONS.map((i) => (
            <option key={i.data.id} value={i.data.id}>
              {i.data.label}
            </option>
          ))}
        </select>
      </div>

      <p className="m-0 max-w-[40ch] text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
        Your choice is remembered in this browser. Nothing is uploaded.
      </p>

      <button
        type="button"
        onClick={onQuick}
        aria-expanded={quickOpen}
        className="util ml-auto rounded-md border px-4 py-2.5"
        style={{
          background: quickOpen ? 'var(--accent)' : 'var(--panel)',
          color: quickOpen ? '#ffffff' : 'var(--accent)',
          borderColor: 'var(--accent)',
        }}
      >
        Quick contacts
      </button>
    </section>
  );
}

/** The agencies a Shirt needs without navigating for them. */
function QuickContacts({ installation }: { installation: Installation | null }) {
  const crisis = categoriesByUrgency().filter((c) => c.urgency === 'crisis');
  return (
    <section className="panel p-4">
      <h2 className="title m-0 mb-3">Quick contacts</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {crisis.map((category) => (
          <ContactCard key={category.id} category={category} installation={installation} compact />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Find help
// ---------------------------------------------------------------------------

function FindHelp({
  query,
  setQuery,
  results,
  onOpenSituation,
  onOpenCategory,
  situation,
  onCloseSituation,
  installation,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: SearchResult[];
  onOpenSituation: (id: string) => void;
  onOpenCategory: () => void;
  situation: Situation | null;
  onCloseSituation: () => void;
  installation: Installation | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <section className="panel p-4">
        <label className="util" htmlFor="fs-search">
          What does your Airman need help with?
        </label>
        <input
          id="fs-search"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="money, housing, childcare, legal, PCS…"
          className="mt-2 w-full border px-3 py-2.5 text-[13.5px]"
          style={{
            background: 'var(--panel-sunk)',
            borderColor: 'var(--rule-strong)',
            color: 'var(--ink)',
          }}
        />

        {query.trim() !== '' && (
          <div className="mt-3">
            {results.length === 0 ? (
              <p className="m-0 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                Nothing matched. Military OneSource takes any question and routes it — see
                Quick contacts.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {results.slice(0, 8).map((result) => (
                  <li key={`${result.kind}-${result.id}`}>
                    <button
                      type="button"
                      onClick={() =>
                        result.kind === 'situation'
                          ? onOpenSituation(result.id)
                          : onOpenCategory()
                      }
                      className="w-full rounded-md border px-3 py-2 text-left"
                      style={{ background: 'var(--panel-raised)', borderColor: 'var(--rule)' }}
                    >
                      <span className="block text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {result.label}
                      </span>
                      <span className="block text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                        {result.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {situation ? (
        <SituationCard
          situation={situation}
          installation={installation}
          onClose={onCloseSituation}
        />
      ) : (
        <section className="panel p-4">
          <h2 className="title m-0 mb-3">I have an Airman who…</h2>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {SITUATIONS.data.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSituation(s.id)}
                  className="h-full w-full rounded-md border px-3 py-2.5 text-left text-[13px]"
                  style={{
                    background: 'var(--panel-raised)',
                    borderColor: 'var(--rule)',
                    color: 'var(--ink)',
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * One routing card.
 *
 * Order matters: where to start, then what else applies, then what to establish
 * first. The questions are questions -- they never resolve to an answer, because
 * the answer is the Shirt's to reach, not this page's.
 */
function SituationCard({
  situation,
  installation,
  onClose,
}: {
  situation: Situation;
  installation: Installation | null;
  onClose: () => void;
}) {
  const start = getCategory(situation.startHere);
  const also = situation.alsoSee
    .map((id) => getCategory(id))
    .filter((c): c is AgencyCategory => c !== undefined);
  const refs = REFERENCES.data.filter((r) => situation.referenceIds.includes(r.id));

  /**
   * A routing card that resolves to nothing is worse than no card at all --
   * it reads as "there is no help for this". So if none of the agencies on
   * this card is populated, the worldwide resources are surfaced instead.
   */
  const reachable = [situation.startHere, ...situation.alsoSee].some(
    (id) => contactFor(installation, id) !== null,
  );

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-2">
        <h2 className="m-0 text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
          {situation.label}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="util ml-auto rounded-md border px-3 py-1.5"
          style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink)' }}
        >
          All situations
        </button>
      </div>

      {start && (
        <>
          <h3 className="util m-0 mb-2">Start here</h3>
          <ContactCard category={start} installation={installation} />
        </>
      )}

      {also.length > 0 && (
        <>
          <h3 className="util m-0 mt-5 mb-2">Also worth trying</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {also.map((category) => (
              <ContactCard key={category.id} category={category} installation={installation} compact />
            ))}
          </div>
        </>
      )}

      {!reachable && (
        <div
          className="mt-4 rounded-md border p-3"
          style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}
        >
          <h3 className="util m-0 mb-2" style={{ color: 'var(--accent-strong)' }}>
            Nothing local is populated — use these
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {nationalFallbacks().map((contact) => {
              const category = getCategory(contact.categoryId);
              return category ? (
                <ContactCard key={contact.categoryId} category={category} installation={null} />
              ) : null;
            })}
          </div>
        </div>
      )}

      {situation.questions.length > 0 && (
        <>
          <h3 className="util m-0 mt-5 mb-2">Questions to establish first</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {situation.questions.map((q) => (
              <li
                key={q}
                className="flex gap-2 text-[12.5px] leading-relaxed"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span aria-hidden style={{ color: 'var(--ink-faint)' }}>
                  ·
                </span>
                {q}
              </li>
            ))}
          </ul>
        </>
      )}

      {refs.length > 0 && (
        <>
          <h3 className="util m-0 mt-5 mb-2">Official references</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {refs.map((r) => (
              <li key={r.id} className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                {r.topic}
                {isReferencePopulated(r) ? ` — ${r.publication}${r.section ? ` ${r.section}` : ''}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * One agency, with its provenance attached.
 *
 * `scope` is the honest bit: a card says whether the number is this
 * installation's or the worldwide fallback, so nobody dials a base number that
 * was never actually a base number.
 */
function ContactCard({
  category,
  installation,
  compact,
}: {
  category: AgencyCategory;
  installation: Installation | null;
  compact?: boolean;
}) {
  const found = contactFor(installation, category.id);

  return (
    <article
      className="rounded-md border p-3"
      style={{
        background: 'var(--panel-raised)',
        borderColor: category.urgency === 'crisis' ? 'var(--rule-strong)' : 'var(--rule)',
      }}
    >
      <h4 className="util m-0" style={{ color: 'var(--accent)' }}>
        {category.label}
      </h4>

      {!found ? (
        <p className="m-0 mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Not populated for this installation. Use Military OneSource, or your installation
          directory.
        </p>
      ) : (
        <>
          {found.contact.name && (
            <p className="m-0 mt-1.5 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              {found.contact.name}
            </p>
          )}
          <dl className="m-0 mt-2 grid gap-x-3 gap-y-1 text-[12px]" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <Row label="Phone" value={found.contact.phone} href={telHref(found.contact.phone)} />
            <Row label="DSN" value={found.contact.dsn} />
            {!compact && <Row label="Where" value={found.contact.location} />}
            {!compact && <Row label="Hours" value={found.contact.hours} />}
          </dl>
          {found.contact.url && (
            <p className="m-0 mt-2 text-[11.5px]">
              <a
                href={found.contact.url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--accent)' }}
              >
                Official source ↗
              </a>
            </p>
          )}
          {!compact && found.contact.notes && (
            <p className="m-0 mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              {found.contact.notes}
            </p>
          )}
          <p className="util m-0 mt-2" style={{ letterSpacing: '0.06em' }}>
            {found.scope === 'local' ? 'Installation directory' : 'Worldwide — not base specific'}
          </p>
        </>
      )}
    </article>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="util m-0">{label}</dt>
      <dd className="tabular m-0" style={{ color: 'var(--ink)' }}>
        {href ? (
          <a href={href} style={{ color: 'var(--accent)' }}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}

/** Only offer to dial something that actually looks dialable. */
function telHref(phone: string): string | undefined {
  const digits = phone.replace(/[^0-9+]/g, '');
  return digits.length >= 7 ? `tel:${digits}` : undefined;
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

function Directory({
  installation,
  unitContacts,
  onUnitContacts,
}: {
  installation: Installation | null;
  unitContacts: UnitContact[];
  onUnitContacts: (contacts: UnitContact[]) => void;
}) {
  const categories = categoriesByUrgency();
  const populated = installation
    ? installation.contacts.filter(isContactPopulated).length
    : 0;

  return (
    <>
      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="title m-0">Helping agencies</h2>
          <span className="util">
            {installation
              ? `${populated} of ${categories.length} populated for ${installation.label}`
              : `${nationalFallbacks().length} worldwide`}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <ContactCard key={category.id} category={category} installation={installation} />
          ))}
        </div>
      </section>

      <UnitContacts contacts={unitContacts} onChange={onUnitContacts} />
    </>
  );
}

/** The unit's own numbers. Local to this browser, never shipped, never uploaded. */
function UnitContacts({
  contacts,
  onChange,
}: {
  contacts: UnitContact[];
  onChange: (contacts: UnitContact[]) => void;
}) {
  const rows = contacts.length > 0 ? contacts : [emptyContact()];

  const update = (index: number, patch: Partial<UnitContact>) => {
    const next = rows.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange(next.filter(isUsable));
  };

  return (
    <section className="panel p-4">
      <h2 className="title m-0">Unit contacts</h2>
      <p className="m-0 mt-1.5 mb-3 max-w-[80ch] text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Your own chain of command. Kept in this browser only — it is never uploaded, and no
        shipped data file could know it.
      </p>

      <div className="flex flex-col gap-2">
        {rows.map((contact, index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <input
              type="text"
              aria-label={`Role ${index + 1}`}
              placeholder="Role"
              list="fs-roles"
              value={contact.role}
              onChange={(e) => update(index, { role: e.target.value })}
              className="border px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--panel-sunk)', borderColor: 'var(--rule-strong)', color: 'var(--ink)', width: '13rem' }}
            />
            <input
              type="text"
              aria-label={`Name ${index + 1}`}
              placeholder="Name"
              value={contact.name}
              onChange={(e) => update(index, { name: e.target.value })}
              className="border px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--panel-sunk)', borderColor: 'var(--rule-strong)', color: 'var(--ink)', width: '15rem' }}
            />
            <input
              type="text"
              aria-label={`Phone ${index + 1}`}
              placeholder="Phone"
              value={contact.phone}
              onChange={(e) => update(index, { phone: e.target.value })}
              className="tabular border px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--panel-sunk)', borderColor: 'var(--rule-strong)', color: 'var(--ink)', width: '12rem' }}
            />
          </div>
        ))}
      </div>

      <datalist id="fs-roles">
        {SUGGESTED_ROLES.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...rows.filter(isUsable), emptyContact()])}
          className="util rounded-md border px-3 py-2"
          style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink)' }}
        >
          Add a row
        </button>
        {contacts.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="util rounded-md border px-3 py-2"
            style={{ background: 'var(--panel)', borderColor: 'var(--rule-strong)', color: 'var(--ink-muted)' }}
          >
            Clear unit contacts
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Points at publications; never paraphrases them. */
function ReferenceList() {
  const populated = REFERENCES.data.filter(isReferencePopulated).length;
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="title m-0">Reference index</h2>
        <span className="util">
          {populated} of {REFERENCES.data.length} pointing at a publication
        </span>
      </div>
      <p className="m-0 mb-3 max-w-[80ch] text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Topics a First Sergeant looks up, each pointing at the publication that owns it. The
        toolkit deliberately does not summarise them — read the current publication.
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {REFERENCES.data.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline gap-x-3 rounded-md border px-3 py-2"
            style={{ background: 'var(--panel-raised)', borderColor: 'var(--rule)' }}
          >
            <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
              {entry.topic}
            </span>
            {isReferencePopulated(entry) ? (
              <span className="tabular text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {entry.publication}
                {entry.section ? ` ${entry.section}` : ''}
              </span>
            ) : (
              <span className="util" style={{ letterSpacing: '0.06em' }}>
                Publication not recorded yet
              </span>
            )}
            {entry.url && (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[11.5px]"
                style={{ color: 'var(--accent)' }}
              >
                Open ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { Contact };
