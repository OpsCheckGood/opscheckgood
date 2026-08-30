# Ops Check Good

Free, open-source Air Force administrative tools. Total force, enlisted and officer.
No accounts, no backend, no tracking, no ads.

Everything runs in your browser. Nothing you type is uploaded, logged, or persisted
anywhere but your own device.

**Unofficial personal project.** Not affiliated with, endorsed by, or produced by the
United States Air Force or the Department of Defense. Official guidance governs.

---

## Tools

### Bullet Bench

Write, measure, and fit your bullets. On forms like the 1206 and the 910 performance
blocks a bullet must occupy exactly one line, and the binding constraint is rendered
line width in millimetres, not character count. Bullet Bench measures each line against
the real font, adjusts inter-word spacing so it ends flush, and when a line cannot be
made to fit it says what to cut and by how much.

One editor, not five separate tools. Competing tools carry the disclaimer *"the shaping
tool does not work with character count"* because their features live on separate pages
and cannot see each other's state. Here every panel reads from one parsed document.

**Built:** width shaping, per-line width and character readouts, fill bars, actionable
failure diagnosis, draft persistence.
**Next:** duplicate highlighting, acronym checking, verb bank, click-a-word synonyms.

### PT calculator

Phase 2. Uses the same data-layer pattern.

---

## Status

The engine is finished and tested. **The reference data is not populated.**

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

**The optimizer is deterministic.** The reference implementation selects gap positions at
random, so the same bullet can shape differently on two runs. This one cannot.

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

The reference implementation vendors `TimesNewRomanPSMT.ttf`. That file is Monotype's and
is not ours to redistribute, so it is deliberately not used here.

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

`npm run build:offline` produces `dist/bullet-bench-offline.html`: one self-contained
file, no subresources, that works when double-clicked from a thumb drive.

It exists because constraint 3 is stricter than it first looks. The normal build makes no
network requests, but a page opened from disk faces two further problems: Astro emits
absolute `/_astro/` asset URLs which resolve against the filesystem root, and browsers
block ES module loading from a file origin — so Astro's island hydration, which is a
dynamic `import()`, never runs. The offline build bundles to a classic IIFE with every
dynamic import inlined and the stylesheet inlined.

`tests/offline.test.ts` boots that file in jsdom with `fetch` replaced by a recorder that
fails the test if the page reaches for the network, then asserts the editor mounts and
produces millimetre readouts.

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
- **Offline** — the built single file has no subresources and works with no network.

---

## Attribution

- **[AF-VCD/pdf-bullets](https://github.com/AF-VCD/pdf-bullets)** (MIT) — the reference
  implementation for width measurement and space optimization. Studied, not copied; no
  code or data from it is vendored here. The greedy longest-match-first ordering hazard
  is documented in their README and their example is used as a test fixture.
- **[Liberation Fonts](https://github.com/liberationfonts/liberation-fonts)** — SIL Open
  Font License 1.1.
- **[WordNet](https://wordnet.princeton.edu/)**, Princeton University — source for the
  synonym dataset (feature 5, not yet built). WordNet 3.0 License.

## Licence

MIT. See `LICENSE`.
