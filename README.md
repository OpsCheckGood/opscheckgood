# Ops Check Good

Free tools for Airmen. Total force, enlisted and officer.
No accounts, no backend, no tracking, no ads.

Everything runs in your browser. Nothing you type is uploaded, logged, or persisted
anywhere but your own device.

**Unofficial personal project.** Not affiliated with, endorsed by, or produced by the
United States Air Force or the Department of Defense. Official guidance governs.

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

It carries two reference pages of its own:

- **Abbreviations** (`/tools/bullet-bench/abbreviations/`) — both lists, searchable, with
  per-entry enable/disable, your own additions, and CSV import/export. Edits are deltas
  against the shipped files, so "reset to defaults" is dropping the delta and a future
  data update still reaches anyone who has not overridden that entry. Switching a single
  entry off matters: the Common list maps platform names to designators, so `Eagle` would
  otherwise be rewritten to `F-15` wherever it appears.
- **Thesaurus** (`/tools/bullet-bench/thesaurus/`) — look a word up without a bullet
  open. Results are grouped by meaning, and every alternative shows its width in
  millimetres at the selected form's type size.

**Built:** width shaping, width and character readouts, actionable failure diagnosis,
abbreviation replacement, duplicate highlighting, acronym classification, click-a-word
synonyms with definitions, draft persistence.

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

The scoring tables and the engine were ported from a fillable PDF calculator the
maintainer wrote. `tests/pt-score.test.ts` runs that PDF's own JavaScript as an oracle
and scores several hundred cases through both engines, comparing composite, rating,
per-component points, and which chart row each one landed on. The data still carries
`status: "stub"` because the PDF is one step removed from the AFMAN itself — see
[Populating the data](#populating-the-data).

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

---

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

Until a form is populated it appears in the picker marked *not yet populated* and cannot
be selected. A synthetic **Sandbox** form ships so the pipeline can be exercised end to
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
    abbreviations/         hq-approved, common
    vocab/                 verbs, stopwords, synonyms
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

1. Open the official PDF and read its XFA stream for the field widths, font family, and
   point size. Do not estimate them.
2. Fill in `src/data/forms/<form>.json`, set `meta.status` to `verified`, and set
   `verifiedDate` to the date you checked.
3. Add the font `.ttf` to `public/fonts` and run `npm run embed:fonts`.
4. `npm run test` — the data-integrity suite will tell you what is still missing.

Adding a new form is a data edit plus one line in `src/lib/data/forms.ts`. If it ever
requires changing a component, the abstraction is wrong.

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

## Attribution

- **[Liberation Fonts](https://github.com/liberationfonts/liberation-fonts)** — SIL Open
  Font License 1.1.
- **[WordNet 3.1](https://wordnet.princeton.edu/)**, Princeton University — source for
  the synonym and definition data (`src/data/vocab/synonyms.json`, generated by
  `scripts/build-synonyms.mjs`) and for the morphology exception files vendored under
  `vendor/wordnet-exc`. WordNet 3.0 License.

- **[pdf-bullets](https://github.com/AF-VCD/pdf-bullets)**, Copyright (c) 2020
  Christopher Kodama — MIT License. Its width-shaping optimizer is vendored verbatim as
  `tests/fixtures/pdf-bullets.js` and used as the oracle for
  `tests/pdf-bullets-differential.test.ts`, which checks our shaping and line breaking
  against it. Test-only: none of it ships in the site bundle. The full licence text sits
  in that file's header, where the code it covers is.

- **Department of the Air Force memorandum template** and the **AFJAGS LOCAR form** —
  US Government works. Source of the memorandum-format sample paragraphs and of the fixed
  LOCAR language and sample libraries in `src/data/mfr`. Both data files record this in
  their `meta` block and remain `stub` until the form editions are cited.

## Licence

**All rights reserved.** This project is not open source, and no permission is granted to
use, copy, modify, or redistribute the source code. The compiled site being free to use
in a browser does not grant any right to the source.

Third-party components keep their own licences, which the terms above do not touch: the
Liberation fonts under the SIL Open Font License 1.1, WordNet under the WordNet 3.0
licence, and pdf-bullets under the MIT License. All three require attribution, all three
are attributed above — and in each derived data file's `meta` block, and in the header of
the vendored file — and all three must stay that way.

Full text in [`LICENSE`](LICENSE).
