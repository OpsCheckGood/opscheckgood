# Ops Check Good

Tools for Airmen.
No accounts, no backend, no tracking, no ads.

Everything runs in your browser. Nothing you type is uploaded, logged, or persisted
anywhere but your own device.

**Unofficial.** Not affiliated with or endorsed by the U.S. Air Force or the Department of
War. Official guidance governs.

**This is not open source.** The site is free to use; the source is not licensed for
reuse, redistribution, or derivative works. See [Licence](#licence). The repository is
private and the project is maintained anonymously — there is no public issue tracker,
and contributions are not being accepted.

---

## Tools

### Bullet Bench

Write, measure, and fit your bullets. On forms like the 1206 and the 910 performance
blocks a bullet must occupy exactly one line, and the binding constraint is rendered
line width in millimetres, not character count. Bullet Bench measures each line against
the real font, adjusts inter-word spacing so it ends flush, and when a line cannot be
made to fit it says what to cut and by how much.

One editor, not five separate tools. Tools that keep these features on separate pages
end up having to warn that their shaping does not agree with their character count. Here
every panel reads from one parsed document, so they cannot disagree.

A bullet longer than one row is handled the way the form handles it. Paste the whole
thing without pressing Enter: it is broken where the form will break it, every full row
is shaped to flush, and the last row is left as typed. The half-spaces stay inside their
rows, so the pasted paragraph wraps at the same places on the form. Pressing Enter still
forces a break where you put it.

The draft is the text as typed. Paste a bullet that has already been shaped, here or in
pdf-bullets, and its half-spaces become ordinary spaces on the way in; only the output
carries them. Otherwise the shaper would be measuring its own last answer.

Under the shaper sit three more boxes that read the same draft rather than asking for
the bullet again, in this order:

- **Definition & Synonyms** — the word under the caret, defined, with replacements in
  three groups: an approved abbreviation, the action-verb list's picks, then the
  dictionary. Each group is listed shortest first with the width it adds or saves, and
  every pick comes back in the tense the word was selected in, irregulars included
  (`lead` is offered as `led`, never `leaded`). The action-verb list is data
  (`src/data/vocab/verbs.json`), about 740 past-tense verbs with three picks each, the
  ones on The Tongue and Quill's action verb table tagged as such; the
  irregular past-tense map beside it (`irregular-past.json`) is checked against WordNet's
  exception list by the tests. The **Verbs** tab lists the whole thing with widths, and
  the handbook's sample adverbs under it (`adverbs.json`).
- **Review** — what a reviewer would say, as a list: words used more than once (grouped
  with their inflections), bullets that open with a weak word instead of an action verb,
  bullets with no number in them, and acronyms on neither approved list that the draft
  does not spell out. Click a finding and the caret goes to it; click again for the next
  occurrence. The weak-opener list is data (`src/data/vocab/weak-openers.json`).
- **Fluff Patrol** — the performance-statement quality checks, each as a question rather
  than a verdict: fluff words and phrases by category and severity (vague intensifiers,
  generic success claims, empty qualifiers, weak contributions, duty language, redundant
  phrasing, overused performance terms, unsupported superlatives, filler transitions);
  number style (a bare number with nothing it counts, a number glued to its unit, a
  dollar figure without separators, doubled symbols, mixed percent or currency styles
  across the draft); and readability (length, semicolons, slashes, parentheticals,
  acronym density, a passive-voice heuristic). Above the findings, each bullet gets four
  heuristic indicators — Action, Result, Impact, Scope — shown as detected or possibly
  missing, never scored and never all required. Dismiss hides a finding for the draft and
  never touches the text; Jump puts the caret on it. Every rule is deterministic pattern
  matching against `src/data/vocab/fluff.json`, which carries the categories, terms,
  severities, questions, signal words and thresholds: no model, no network, nothing
  rewritten. Not built yet from the same specification: the metric calculator, evidence
  notes, templates and a rule-management screen.

**Open Form** reads an AF form PDF -- the 1206 someone sent you, a 910 with comments in
it -- recognises which form it is from its own XFA data, selects it, and puts the
bullets already in it into the draft. The file is read in the browser and never leaves
it. **Import** reads a pdf-bullets save file: its bullets replace the draft and its
abbreviation table joins your additions to the Common list, so nothing is retyped to
switch tools. **Export** writes the same format, so the file goes the other way too.

The 1206, 910 and 911 definitions are verified against the forms themselves: every field
width in `src/data/forms` is re-read from the official PDF by the test suite. See
[To populate a form](#to-populate-a-form).

It carries two reference pages of its own:

- **Abbreviations** (`/tools/bullet-bench/abbreviations/`) — both lists, searchable, with
  per-entry enable/disable, your own additions, and CSV import/export. Edits are deltas
  against the shipped files, so "reset to defaults" is dropping the delta and a future
  data update still reaches anyone who has not overridden that entry. Switching a single
  entry off matters: the Common list abbreviates `Commander` to `CC`, and a unit whose
  leadership wants the word written out can switch that one entry off and keep the rest.
- **Thesaurus** (`/tools/bullet-bench/thesaurus/`) — look a word up without a bullet
  open. Results are grouped by meaning, and every alternative shows its width in
  millimetres at the selected form's type size.

**Built:** width shaping, multi-row bullets, width and character readouts, actionable
failure diagnosis, abbreviation replacement, duplicate highlighting, the Review panel,
acronym classification, click-a-word synonyms with definitions, form PDF reading,
pdf-bullets file import and export, draft persistence.

### PT calculator

Scores an Air Force physical fitness assessment: body composition by waist-to-height
ratio, upper body, core, and cardio, with the composite prorated over the components
actually assessed. Every event the AFMAN allows is a table entry rather than a code
branch — push-up or hand-release push-up, sit-up or cross-leg reverse crunch or forearm
plank, run or HAMR shuttle or the 2 km walk — so adding one is a data edit.

It handles the parts that are easy to get wrong: exemptions leave both sides of the
composite fraction rather than scoring zero, a passed walk scores like an exemption and
caps the rating below Excellent, a single component minimum fails the whole assessment,
and the waist-to-height ratio truncates rather than rounds. Your row is marked on the
scoring chart, so you can see how many more reps buy the next point.

The data is `status: "verified"`. The scoring tables in `src/data/pt/afman36-2905.json`
were compared cell by cell against the USAF PFRA Scoring Charts effective 1 March 2026
(3,096 cells, zero differences, pinned in `tests/fixtures/pfra-scoring-charts.json`), and
the body composition rules against AFMAN 36-2905, 24 March 2026, each paragraph cited by
a test in `tests/pt-score.test.ts`. The body fat percent is read from the manual's
Attachments 9 and 10, which ship as `src/data/pt/body-fat-tables.json`. Reading the manual
found three errors in the fillable PDF the tool was first ported from, all corrected: the
tape rounds to the quarter inch, not the half (Attachment 8); a result equal to the
standard fails, since Table 3.2 reads "< 26%" and "< 36%"; and a met Tier 2 assessment is
scored as an exempt component without being an exemption, so no PFRA hold is warned of
(para 3.9). `tests/pt-score.test.ts` still runs the original PDF's script as the oracle
for the scoring tables, ladders, proration and ratings, which the manual does not
contradict; the downloadable PDF builder carries the same three corrections (see
[Fillable PDF builders](#fillable-pdf-builders)).

### BTZ calculator

Projects when an A1C reaches the Senior Airman phase point, when the below-the-zone
consideration window opens, which board quarter they fall in, and what date they would
pin on if selected. Entered active duty and a date of rank go in; a timeline comes out.

The rules are AFI 36-2502, 2 July 2026, and every one of them is data. Para 2.2.1 gives
two routes to a fully qualified promotion — 36 months' time in service with 20 months'
time in grade, or 28 months' time in grade, whichever comes first — and the promotion
lands on the earlier of them. Para 2.3.1 puts below-the-zone six months ahead of that
point. Table 2.7 is the board calendar. Adding a route or changing the calendar is a
JSON edit; the loader rejects a calendar whose four quarters do not tile the year.

Three things it will not do. It never says anyone is *eligible* — the strongest wording
is "projected BTZ promotion, if selected", because eligibility carries conditions the
page cannot see and selection is a board's decision. It will not project from AB or Amn,
because an A1C date of rank is set by technical training, an advanced enlistment, or an
adjustment for previous service, and a confident wrong date is worse than none. And it
is not a black box: **Why this date?** opens both routes, both bounds on each, which one
binds, and the subtraction.

Advanced mode adds the conditions the instruction attaches, each blocking or advising as
the AFI does and each citing its paragraph — the 3-skill level requirement (Table 2.1),
one-time consideration (para 2.3.1), a date of rank adjusted for previous service
(2.3.4.4.2), ROTC or Academy date-of-rank credit (2.3.4.4.2), the Technical Degree
Scholarship academic phase (4.1.7), and the six-year enlistee date-of-rank adjustment
(2.1.2).

Note that below-the-zone is six months off the *resolved* phase point, not a separate
"30 months TIS / 14 months TIG" pair. Several secondary sources paraphrase it the second
way; the two agree in the ordinary case and diverge at month ends, and
`tests/btz-project.test.ts` pins the divergent case.

**Built:** quick and advanced modes, both routes with the binding bound shown, board
cycle lookup, timeline, copyable summary, local draft persistence. Data `verified`
against the instruction.

### Pay calculator

A pay grade and a length of service go in; monthly basic pay comes out, with the annual
and twice-monthly figures beside it and the next longevity raise under it. **Compare with
another grade** opens a second panel prefilled with the next grade up at the same length
of service, and the difference is shown a month, a year and as a percentage.

The table is DFAS basic pay effective 1 January 2026, every column for every grade to the
cent, in `src/data/pay/basic-pay-2026.json`. The one rule in code is that a column applies
once cumulative service is *over* the years it names, so six years exactly is still the
"over 4" column; `tests/pay-basic.test.ts` pins that boundary and `tests/pay-data.test.ts`
pins a spread of cells against the published table. A new year is a new data file.

Basic pay only: no allowances, special pays or taxes, and the page says so under the
result rather than letting the figure read as take-home pay.

**Built:** lookup, comparison, next longevity step, local draft persistence. Data
`verified` against DFAS.

### MFR generator

Writes an official memorandum for record, or a letter of counseling, admonishment or
reprimand, to AFH 33-337 (*The Tongue and Quill*) format and exports a signable PDF and
an editable Word document — both built in the browser, with no library and no request.

The letterhead is a field, not a configuration. This is a public tool with no unit behind
it, so the three header lines, their colour and the seal are typed by whoever is writing
the memorandum. Nothing ships a seal: constraint 6 rules out DoD imagery, and a
letterhead the user did not choose is not theirs to sign under. An uploaded seal stays in
the browser like everything else.

The formatting rules live in one place and every renderer reads them: quarter-inch
sub-paragraph levels numbered `1. → a. → (1) → (a)`, indorsements numbered `1st / 2d /
3d`, one attachment listed as "Attachment:" and two as "2 Attachments:", the signature
block on the fifth line below the body and never stranded on a page of its own. The live
preview measures and paginates exactly as the PDF writer does, so the page count on
screen is the page count in the download.

A LOCAR is four paragraphs and three indorsements, of which the issuer writes two
paragraphs. The Privacy Act statement, the receipt-and-rights paragraph, the fixed
opening sentence and the acknowledgment / decision / final-acknowledgment cycle come from
`src/data/mfr/locar-language.json`, along with both sample libraries. That file is a
`stub`; the tool shows "Source (stub)" in its provenance stamp rather than the
unverified-data banner, because the banner is worded for a tool that computes numbers and
this one lays out text you wrote — every fixed paragraph it adds is quoted in full in the
live preview, where you can read it before you sign anything.

**Built:** custom MFR and LOCAR, editable letterhead, paragraph tree, attachments /
cc / distribution, indorsements, CUI banner and designation indicator, live preview,
PDF, Word, print view, local draft persistence.

### Decoration Writer

Drafts a decoration citation that fits the certificate. myDecs enforces one number, 1350
characters, and then prints the citation onto a letter page in Courier 11, fully
justified, 70 characters to the line and exactly 20 lines before GIVEN UNDER MY HAND. The
page is what binds: word wrap leaves the end of every line partly empty, so the same 1350
characters take a different number of lines depending on where the words fall, and a
citation the field accepted can come back from the print shop missing its last line.

So the writer does no shaping at all. No half spaces, no substitutions: the citation is
wrapped exactly as typed, at the column count the page allows, and the editor refuses the
keystroke that would start a line the certificate cannot print. A paste that overflows is
trimmed to fit and the cut text is shown, not dropped.

Guided mode covers every decoration the awards manual's Attachment 5 gives a citation for,
from the Achievement Medal to the Distinguished Service Medal, and builds the opening and
closing sentences from the manual's own words: grade spelled out in the opening, short
title thereafter; the retirement, separation, posthumous and heroism closings where the
manual gives them; the Air National Guard closing of A5.1.5; the Bronze Star's engagement
clause; the Distinguished Service Medal's Presidential opening. Only the Meritorious
Service Medal and above say "singularly distinctive" and "great credit", because only they
do in the manual. The assignment is entered the way the certificate prints it: duty title,
squadron, group, wing, base. Free mode is one box for the whole citation under the same
limit. A review panel flags what the manual's rules would bounce and what the wrap has
done: a name or the inclusive period split across two lines, a lone numeral, a run of
capitals that had better be on the approved abbreviation list, a curly quote that will not
survive the trip.

The certificate preview is the whole page as myDecs prints it -- the Department of the Air
Force or Presidential header, the oak leaf cluster line, the member in capitals, the basis
and dates, the justified citation, GIVEN UNDER MY HAND, the signature block -- drawn from
the same wrapped lines the count uses, so it cannot disagree with it. **Print certificate**
prints that page alone, at size. **Word draft** is the same page as an editable document,
the citation one justified Courier paragraph. **PDF builder** is the tool itself as a
fillable PDF, blank or with the page's entries already in it; see
[Fillable PDF builders](#fillable-pdf-builders).

The certificate geometry is `src/data/decorations/mydecs-certificate.json`, `verified`:
every figure in it was read with pdftotext off three certificates myDecs itself printed
(an Achievement Medal, a Commendation Medal and a Meritorious Service Medal), and all three
agreed. Those certificates name real people and are not in the repository. The sentence
wording is `citation-language.json`, transcribed from the 10 June 2019 AFMAN 36-2806,
whose paragraph numbers the current DAFMAN keeps; it stays `stub` until read against the
current edition.

**Built:** every Attachment 5 decoration, guided and free modes, line-and-character limit
enforced at the keystroke, paste trimming, full-page certificate preview and print, rule
review, copy, local draft persistence.

### Promotion Script Builder

Names in, run of show out. The ceremony, the promotee, the key personnel, the family and
the distinguished visitors go into a form; the emcee's script comes out in three
sections: the opening, the charge when the new grade enters a tier that has one, and the
closing. Lines marked » are stage cues and are not read aloud.

It descends from a fillable PDF one squadron built for itself, with the squadron taken
out. The unit and the nickname the emcee uses for everyone from it are fields, and every
role is optional: leave the first sergeant, the chief, a spouse or a stripe tacker blank
and those lines are simply not generated, rather than printed with a hole. The charge
reader defaults to the chief and then to the presiding official. Pronouns drive the verb
agreement. Distinguished visitors are a list, not three slots.

The NCO and SNCO charges live in `src/data/promotion/ceremony.json`, along with which
grade opens each tier, so a Staff Sergeant hears the NCO charge and a Master Sergeant the
SNCO charge while a new Senior Master Sergeant hears neither. The file is a `stub`: the
charges were transcribed from the squadron's PDF and have not been read back against the
published text. The script wording itself is ceremony convention, not regulation, and is
meant to be copied and edited.

**Built:** live script, print view with a section per page (save as PDF from the print
dialog), plain-text copy, optional charge, local draft persistence.

### EPB Worksheet

The Enlisted Performance Brief, box by box, each counted to the limit myEval enforces:
the duty description (450 characters), the four major performance areas (350 each) with
their definitions and the Airman Leadership Qualities under each, and the higher level
reviewer assessment (250). A counter beside every box reads `n remaining` as you type
and `n over` once you pass the limit, so a statement is cut to fit here rather than in
myEval. Every count is a plain character count, spaces included, which is how myEval
counts. A workbench at the end holds drafts that are not ready yet, with a running count
and no limit.

It descends from a unit-built fillable PDF that did the same job, rebuilt from scratch
on the site's own form writer so it matches the other builders: the counters simply
count, with no message when a box comes out exactly full. The areas, qualities and
limits live in `src/data/epb/worksheet.json`, a `stub` until they are read back against
DAFI 36-2406 and a live myEval session.

**Built:** live counters, the qualities beside each statement, per-box and whole-sheet
copy, local draft persistence, and the fillable PDF below, blank or carrying the page.

---

## Fillable PDF builders

Four of the tools can be downloaded as a fillable PDF that does the same job on its own:
the Decoration Writer, the PT calculator, the Promotion Script Builder and the EPB
Worksheet. The file
carries the tool's engine as document-level JavaScript, so it builds the citation,
scores the assessment or writes the run of show inside Acrobat or Reader with no site
and no network. Each is locked as it is downloaded -- an owner password nobody keeps, an
empty user password, permissions that allow filling and printing and nothing else -- so
it can be filled in and printed but not edited.

The four look like one family. Every one opens with the same ink band naming the tool
and saying what it is; every page ends with the same small footer, the site's address
beside a current-as-of stamp (`CAO 15 SEP 2026`) that says when the builders were last
changed, with a link to the site over it. That footer is the only branding. The stamp is
`BUILDERS_UPDATED` in `src/lib/pdfform/version.ts`; bump it when a builder changes. The
files are named the same way too, `OpsCheckGood-<Tool>-Builder.pdf`, with `-filled` when
the download carries the page's entries, and their document titles say the same. On each
tool's page the downloads sit at the top in one bar, each button naming what it hands
over.

The Decoration Writer's and the EPB Worksheet's files are built from scratch by
`src/lib/pdfform` -- an AcroForm writer plus an ES5 port of each tool's engine,
generated from the same data files -- and can be downloaded blank or with the page's
entries already in the fields. The worksheet's counters run from a keystroke action, so
they move with every key in Acrobat, and from a calculate action, so they are right after
a paste or a reopen.
The PT calculator and the Promotion Script Builder are the maintainer's original fillable
PDFs, from which the site's versions were written. They are embedded as prepared by
`scripts/embed-forms.mjs`: document information scrubbed, the unit's name, emblem and
sample entries removed, the site's mark added, and, for the promotion builder, the script
replaced with an ES5 port of the site's so the two cannot disagree. The originals sit in
`forms-src/`, which is not committed; the prepared files under
`src/lib/pdfform/embedded/` are. The PT calculator's scoring script is left as it is: it
is the oracle `tests/pt-score.test.ts` checks the site's scorer against. Its Tier 2 body
fat page is patched at embed time (`patchTier2Script` in `src/lib/pdfform/prepare.ts`) to
the same four corrections the site made against the manual -- quarter-inch tape, the
strict standard, the published tables, no false PFRA hold -- each edit anchored to the
exact text it replaces so a new edition of the file fails loudly rather than silently
keeping the old rules. `tests/pdf-embedded.test.ts` runs the patched script beside the
site's body fat assessment.

`tests/pdfform.test.ts`, `tests/epb.test.ts` and `tests/pdf-embedded.test.ts` run the files' scripts under
Node beside the site's engines and compare every sentence and every line; they also open
the locked downloads with `src/lib/pdf` and check the fields, the script, the permissions
and the link. What no test can do is run Acrobat: the scripts are written to its old
JavaScript engine (`var` and `function`, nothing newer), and that is the one thing left
to a human with Acrobat in front of them.

## Status

Both engines are finished and tested. **Most of the reference data is not populated.**

The PT scoring tables are populated, from the maintainer's own PDF calculator, and still
marked `stub` until someone checks them against AFMAN 36-2905 itself.

The BTZ promotion rules are `verified`, transcribed from AFI 36-2502, 2 July 2026, with
each check and note carrying the paragraph it came from.

Form field widths, fonts, point sizes, and abbreviation lists must be transcribed from
official sources. They are deliberately left empty rather than guessed, because a
plausible wrong millimetre value is worse than an obviously absent one for a tool whose
entire value is precision. See [Populating the data](#populating-the-data).

Until a form is populated it appears in the Thesaurus's picker marked *not yet populated*
and cannot be selected. The Bullet Bench has no picker: it is pinned to the 1206's
Specific Accomplishments block, which every real form's bullet block matches. A synthetic **Sandbox** form ships so the pipeline can be exercised end to
end; its numbers are fabricated round values, it is permanently marked `stub`, and it
corresponds to no real form.

---

## Hard constraints

Non-negotiable. Each one is enforced by a test, not just a convention.

| # | Constraint | Enforced by |
|---|---|---|
| 1 | No runtime network requests | `scripts/check-offline.mjs`, run in CI |
| 2 | No data leaves the browser | localStorage only; no backend exists |
| 3 | Every tool works standalone from disk | `tests/offline.test.ts` boots the built file in jsdom |
| 4 | Standards data never hardcoded in components | everything lives in `/src/data` |
| 5 | No invented reference data | `meta.status` plus `tests/data-integrity.test.ts` |
| 6 | Nothing implying official endorsement | footer disclaimer, no seal or DoD imagery |

The audience is frequently on .mil networks where outbound requests fail or are silently
blocked, which is why constraint 1 is absolute: no CDN links, no web fonts, no analytics,
no API calls.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321
```

```bash
npm run test         # unit tests
npm run build        # static site -> dist/
npm run build:offline# single-file offline copy -> dist/bullet-bench-offline.html
npm run verify:offline # fail if dist/ contains any external reference
npm run ci           # everything CI runs
```

---

## Architecture

```
src/
  data/                    every value that could change, as JSON with meta
    forms/                 form definitions (af1206, af910, af911, sandbox)
    pay/                   DFAS basic pay table, one edition per file
    abbreviations/         hq-approved, common
    vocab/                 action verbs, irregular pasts, stopwords, weak openers, synonyms
  lib/
    data/                  loaders, schemas, validation
    metrics/               font parsing and measurement
      embedded/            GENERATED base64 fonts
    shape/                 space alphabet, optimizer, diagnosis
    text/                  tokenizing
  components/              React islands
  pages/                   Astro routes
```

Astro with React islands, static output, TypeScript, Tailwind v4, opentype.js, Vitest.
No SSR and no adapters: deploy target is static hosting (Cloudflare Pages, or a VPS
behind Caddy).

---

## How the shaping works

### Measurement

Width is measured with opentype.js against the actual bundled font file, never the
browser's canvas `measureText()`. Canvas resolves the family through the user's locally
installed fonts and silently substitutes when the font is missing, so the same bullet
measures differently on two machines. Quietly wrong is the one failure mode this tool
cannot have.

Per-glyph advance widths are summed and kerning applied, then font units are converted
to millimetres via the font's `unitsPerEm` and the point size from the form definition.

> **A trap worth knowing about.** opentype.js 2.x silently drops all kerning for the
> Liberation fonts, through its own public API. `Font.getKerningValue()` resolves the
> default script to `DFLT`, which carries zero `kern` lookups; the Latin kerning lives
> under `latn`. The empty result is truthy, so the lookup returns 0 and never reaches the
> library's own legacy-`kern` fallback. `font.getAdvanceWidth()` inherits the same fault
> and reports "AV" at 12pt as exactly the unkerned sum. `src/lib/metrics/font.ts`
> resolves the kerning source itself, and `tests/font-metrics.test.ts` fails if anyone
> replaces it with the library helper.

### Shaping

Padding uses Unicode space characters, never font-size manipulation, because the output
has to survive a copy-paste into an XFA PDF form field where per-character styling is
stripped but characters are preserved. The result is plain text.

| Char | Name | Width |
|---|---|---|
| U+2006 | SIX-PER-EM SPACE | 1/6 em |
| U+0020 | SPACE | ~1/4 em |
| U+2004 | THREE-PER-EM SPACE | 1/3 em |

Each gap is a three-way choice, so a bullet with N gaps has 3^N renderings. The optimizer
finds the widest that does not exceed the target, promoting gaps a whole level at a time
and choosing evenly spaced positions when only part of a level is affordable.

**The optimizer is deterministic.** Gap selection is a hash of the text, so the same
bullet always shapes the same way. Substituted spaces cluster rather than spreading,
which reads as one deliberately tightened phrase instead of a whole line of subtly
wrong gaps.

**Shaping has bounded range.** In Times-metric fonts the three spaces sit 1/12 em apart,
so each gap moves the line about 0.35mm at 12pt — roughly ±4mm for a twelve-gap bullet.
Shaping is a fine-tuning instrument. Anything further out has to be fixed by editing the
text, which is what the diagnosis is for:

> Can't reach flush. Over by ~6mm. Cut roughly 4 characters, or abbreviate "Squadron" to
> "Sq" (saves 11mm).

Abbreviation savings are measured, not estimated from character counts.

---

## Populating the data

Every file in `/src/data` carries a `meta` block:

```json
{
  "meta": {
    "source": "AF Form 1206, Nomination for Award",
    "version": "20240101",
    "verifiedDate": "2026-08-30",
    "sourceUrl": "https://www.e-publishing.af.mil/...",
    "status": "verified",
    "notes": "Field widths extracted from XFA stream"
  },
  "data": {}
}
```

`status` is the load-bearing field:

- **`stub`** — placeholder values. May hold zeros and `"TBD"`. Any tool consuming one
  shows a persistent unverified-data banner.
- **`verified`** — transcribed from the cited source. Validation tests hard-require a
  real `sourceUrl`, a real `version`, and no placeholders left in the payload.

Flipping a file to `verified` is what turns the banner off. Never flip it without the
official source in hand.

### To promote the PT standards

The tables in `src/data/pt/afman36-2905.json` were extracted by script from the
maintainer's fillable PDF, so they match that PDF exactly — but the PDF is not the
official source. To promote the file:

1. Open AFMAN 36-2905 and check the tables against it.
2. Set `meta.sourceUrl` to the e-publishing URL, set `meta.status` to `verified`, and set
   `verifiedDate` to the date you checked.
3. While you are in there: male 30-34 push-ups list 26 reps on both the 3.0 and the 2.5
   rows, which makes the 2.5 row unreachable. Confirm or correct it against the AFMAN.
   `tests/pt-data.test.ts` pins that plateau, so changing it will fail a test that names
   exactly this.

### To promote the memorandum language

`src/data/mfr/locar-language.json` holds the fixed LOCAR paragraphs, the three
indorsements and both sample libraries; `src/data/mfr/memo-format.json` holds the sample
body of a new memorandum. Both were transcribed by the maintainer rather than generated,
but neither carries a citable published copy of its source form, so both are `stub` and
the MFR generator shows the unverified-data banner.

To promote either one: put the official form in front of you, check the wording word for
word, then replace the `"TBD"` in `meta.version` with its edition, put its URL in
`meta.sourceUrl`, the date you checked in `meta.verifiedDate`, and set `meta.status` to
`verified`. The provenance stamp at the foot of the tool stops reading "(stub)" once you
do.

### To populate a form

The field geometry is read from the form's own PDF, not typed in. `src/lib/pdf` is a
small reader -- cross-reference tables and streams, object streams, Flate, and the
standard security handler with the empty user password every e-Publishing form ships
with -- that pulls the XFA `template` packet out and reads each `<field>` box, `<font>`
and `<margin>`. The blank forms sit in `tests/fixtures/forms`, and the data-integrity
suite re-reads them on every run and fails if a width, height, face or size in
`src/data/forms` drifts from what the form says. That is what `verified` means here.

To add or update a form:

1. Put the official PDF from e-Publishing in `tests/fixtures/forms`, named
   `<form>-<edition>-blank.pdf`.
2. Add or update `src/data/forms/<form>.json` with the widths and heights the reader
   reports (a failing test prints them), set `meta.version` to the edition date,
   `meta.status` to `verified`, and `verifiedDate` to the date you checked.
3. Add the pair to `FORM_FIXTURES` in `tests/data-integrity.test.ts`.
4. If the form uses a face not yet shipped, add the `.ttf` to `public/fonts` and run
   `npm run embed:fonts`.

The same reader is behind the bench's **Open Form** button, which recognises a 1206,
910 or 911 from its own data and lifts the bullets already typed into it.

Adding a new form is a data edit plus one line in `src/lib/data/forms.ts`. If it ever
requires changing a component, the abstraction is wrong.

### To refresh the installation directories

The First Sergeant toolkit's per-installation helping-agency numbers come from two
sources, and both are read by script at build time. Nothing is fetched at runtime.

```
node scripts/import-installations.mjs --air-force     # MilitaryINSTALLATIONS
node scripts/import-base-directories.mjs --discover   # resolve each base's own site
node scripts/import-base-directories.mjs              # read those sites, fill the gaps
```

`import-installations.mjs` reads the official MilitaryINSTALLATIONS programme pages —
medical, family support, legal, housing, family advocacy, EFMP, child care, emergency
relief. Which programme page carries which agency lives in `categories.json` as
`mosPages`. Which installations are Air Force is read off each landing page's own
branch-of-service banner rather than guessed from its name.

Military OneSource publishes no page at all for the command post, mental health, the
chaplain, the SARC, security forces, finance, the MPF or EO. Those come from each
installation's own `*.af.mil` site instead. `import-base-directories.mjs` resolves that
site (a hostname guessed from the slug, then kept only if the page it serves names the
installation back — the title it read is recorded in `base-sites.json` as the evidence),
reads its directory pages, and fills **only** the fields MilitaryINSTALLATIONS left
empty. Where both sources publish a number, the MilitaryINSTALLATIONS value stands and
the base site's is written into that contact's notes, so the disagreement is visible
rather than resolved behind your back.

Which label on a base page means which agency is data, not code: `siteLabels` and
`siteExcludeLabels` in `categories.json`. The matcher is deliberately timid — a label it
does not recognise is dropped, and a label two agencies both claim ("Family
Advocacy/Mental Health") is dropped as ambiguous. An empty field is a correct answer;
a plausible invented one is not.

`*.af.mil` returns 403 to a plain client, so pages are fetched through a text-extraction
proxy (`--proxy`, default `https://r.jina.ai/`) and cached to disk, which is what makes
the run resumable. That proxy is a build-time convenience; the shipped site has no
network dependency of any kind.

### To populate abbreviations

`[{"phrase": "United States Air Force Academy", "abbr": "USAFA"}]`. File order does not
matter: the loader sorts descending by phrase length, because greedy replacement in the
wrong order turns that example into `"USAF Academy"`. A test proves a deliberately
scrambled file still produces correct output.

---

## Fonts

`public/fonts` ships **Liberation Serif** and **Liberation Sans** under the SIL Open Font
License 1.1 (`public/fonts/LICENSE-Liberation.txt`). Liberation is metrically compatible
with Times New Roman and Arial, so measurements match while remaining legally
redistributable.

Times New Roman itself is Monotype's and is not ours to redistribute, so it is
deliberately not bundled.

Fonts are base64-embedded into generated modules under `src/lib/metrics/embedded/` by
`npm run embed:fonts`, rather than fetched at runtime. Under `file://` a browser refuses
`fetch()` for local files, which would break the measurement core in exactly the offline
scenario constraint 3 exists to protect. Each font is its own chunk, so only the one a
selected form needs is downloaded.

*Known optimisation, not yet done:* the fonts ship whole (~500KB base64 each). Subsetting
to the characters that actually appear in bullets would cut that substantially, but must
preserve the `kern` table — a naive opentype.js re-serialise drops it.

---

## The offline copy

`npm run build:offline` produces one self-contained file per tool —
`dist/bullet-bench-offline.html` and `dist/pt-calculator-offline.html` — with no
subresources, each working when double-clicked from a thumb drive. Each carries only its
own bundle, so the calculator does not drag Bullet Bench's embedded font data along.
Adding a tool is one entry in the `TOOLS` list in `scripts/build-offline.mjs` plus its
own offline entry point.

It exists because constraint 3 is stricter than it first looks. The normal build makes no
network requests, but a page opened from disk faces two further problems: Astro emits
absolute `/_astro/` asset URLs which resolve against the filesystem root, and browsers
block ES module loading from a file origin — so Astro's island hydration, which is a
dynamic `import()`, never runs. The offline build bundles to a classic IIFE with every
dynamic import inlined and the stylesheet inlined.

`tests/offline.test.ts` boots each file in jsdom with `fetch` replaced by a recorder that
fails the test if the page reaches for the network. It then asserts the editor mounts and
produces millimetre readouts, and separately types a full assessment into the calculator
and reads the composite back off the page.

---

## Testing

```bash
npm run test
```

- **Font metrics** — known string measures to a known width; kerned pairs measure
  narrower than the sum of their advances; results identical across runs and re-parses;
  embedded bytes match `public/fonts`.
- **Optimizer** — short lines pad to within tolerance; at-target lines are unchanged;
  unshapeable lines are flagged rather than silently emitted; only permitted space
  characters appear; padding distributes rather than concentrating; output is
  deterministic.
- **Abbreviations** — longest match wins; the loader re-sorts a scrambled file;
  replacement is idempotent.
- **Data integrity** — walks `src/data` on disk, so a new file nobody wired up still gets
  validated; no file claims `verified` while holding placeholders; no form references a
  font that is missing or unembedded.
- **PT standards** — age brackets tile the whole range with no gaps or overlaps; every
  table row has one cell per age group and sex; table rows and point ladders are the same
  length; no column ever reverses direction; the one flat spot in the data is pinned by
  name so a new one has to be looked at.
- **PT scoring** — proration, exemptions, the walk cap, component minimums, and the
  Tier 2 trigger, plus a differential test that scores several hundred cases through both
  this engine and the source PDF's own script and compares the answers.
- **Offline** — the built single file has no subresources and works with no network.

---

## Licence

**All rights reserved.** This project is not open source, and no permission is granted to
use, copy, modify, or redistribute the source code. The compiled site being free to use
in a browser does not grant any right to the source.

Third-party components keep their own licences, which the terms above do not touch; their
notices are kept in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and in the headers of
the files they cover, as those licences require.

Full text in [`LICENSE`](LICENSE).
