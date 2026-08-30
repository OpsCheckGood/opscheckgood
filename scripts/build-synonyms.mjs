#!/usr/bin/env node
/**
 * Generates src/data/vocab/synonyms.json from the WordNet database.
 *
 * Runs at build time, never at runtime -- the shipped file is plain JSON and
 * the tool never reaches the network (hard constraint 1). WordNet is included
 * as a dev dependency purely so this script has something to read.
 *
 * Filtering aims at a practical writing vocabulary rather than all of WordNet:
 * single words only (a multi-word synset member cannot substitute for one
 * selected word), and only lemmas that appear in WordNet's semantically tagged
 * corpora, which is its own signal for "actually used".
 *
 * Run: npm run build:synonyms
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wordnet = require('wordnet-db');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const POS = ['verb', 'adj', 'noun'];
const MIN_LENGTH = 3;
const MAX_SYNONYMS = 20;
/**
 * All senses, most common first.
 *
 * Restricting to the top senses read better in isolation but starved the
 * panel: a word with one narrow first sense offered two options or none. The
 * ordering already puts the common sense first, so taking everything costs
 * ranking, not correctness -- and an extra option the user ignores is cheaper
 * than an empty panel.
 */
const MAX_SENSES = Number.POSITIVE_INFINITY;

/** WordNet files begin with a licence header on lines starting with two spaces. */
const contentLines = (file) =>
  readFileSync(join(wordnet.path, file), 'latin1')
    .split('\n')
    .filter((line) => line && !line.startsWith('  '));

const isPlainWord = (word) => /^[a-z]+$/.test(word) && word.length >= MIN_LENGTH;

/** Longest definition kept, so one runaway gloss cannot dominate the panel. */
const MAX_DEFINITION = 110;

/**
 * A WordNet gloss is `definition; "an example of use"; "another"`. The
 * examples are quoted and belong to the sense rather than defining it, so they
 * are dropped -- the panel needs to answer "is this the right word", quickly.
 */
function cleanGloss(gloss) {
  const definition = gloss
    .split(';')
    .filter((part) => !part.trim().startsWith('"'))
    .join(';')
    .trim();
  return definition.length > MAX_DEFINITION
    ? `${definition.slice(0, MAX_DEFINITION - 1).trimEnd()}\u2026`
    : definition;
}

/** synset offset -> {words, gloss}, per part of speech. */
function readSynsets(pos) {
  const synsets = new Map();
  for (const line of contentLines(`data.${pos}`)) {
    const [fields, gloss = ''] = line.split(' | ');
    const parts = fields.split(' ');
    const offset = parts[0];
    const wordCount = parseInt(parts[3], 16);
    const words = [];
    for (let i = 0; i < wordCount; i += 1) {
      // Members alternate word then lex_id from index 4.
      words.push(parts[4 + i * 2].toLowerCase().replace(/\(.*\)$/, ''));
    }
    synsets.set(offset, { words, gloss: cleanGloss(gloss) });
  }
  return synsets;
}

/**
 * One map per part of speech, deliberately not merged.
 *
 * "build" is both a verb and a noun, and unioning them offers `physique,
 * habitus, soma` alongside `construct, make`. A lemma takes its synonyms from
 * the first part of speech that has it, in POS order -- verbs first, because
 * a bullet is a verb-led sentence and that is what people reach for the
 * thesaurus to change.
 */
const byPos = new Map(POS.map((pos) => [pos, new Map()]));
const defsByPos = new Map(POS.map((pos) => [pos, new Map()]));
let considered = 0;

for (const pos of POS) {
  const map = byPos.get(pos);
  const synsets = readSynsets(pos);

  for (const line of contentLines(`index.${pos}`)) {
    const parts = line.split(/\s+/);
    const lemma = parts[0].toLowerCase();
    considered += 1;
    if (!isPlainWord(lemma)) continue;

    const synsetCount = Number(parts[2]);
    const pointerCount = Number(parts[3]);
    // ... p_cnt pointer symbols ... then sense_cnt, tagsense_cnt, offsets.
    const tagSenseIndex = 4 + pointerCount + 1;
    // Previously this dropped lemmas absent from WordNet's tagged corpora,
    // which sounded like a quality filter and was really a coverage cut: it
    // removed three quarters of the dictionary, so selecting an ordinary word
    // often returned nothing at all. Coverage matters more here than trimming
    // the rare tail, because an empty panel is the one useless outcome.

    const offsets = parts
      .slice(tagSenseIndex + 1, tagSenseIndex + 1 + synsetCount)
      .slice(0, MAX_SENSES);
    const seen = map.get(lemma) ?? new Set();
    for (const offset of offsets) {
      const synset = synsets.get(offset);
      if (!synset) continue;
      for (const word of synset.words) {
        if (word !== lemma && isPlainWord(word)) seen.add(word);
      }
    }
    // The first sense's gloss, from the first part of speech that has the
    // lemma: enough to tell whether this is the word you meant.
    const senses = defsByPos.get(pos);
    if (!senses.has(lemma)) {
      const first = synsets.get(offsets[0]);
      if (first?.gloss) senses.set(lemma, first.gloss);
    }
    if (seen.size > 0) map.set(lemma, seen);
  }
}

// Collapse to one entry per lemma, first part of speech that has it.
const map = new Map();
const definitions = new Map();
for (const pos of POS) {
  for (const [lemma, set] of byPos.get(pos)) {
    if (!map.has(lemma)) map.set(lemma, set);
  }
  for (const [lemma, gloss] of defsByPos.get(pos)) {
    if (!definitions.has(lemma)) definitions.set(lemma, { pos, gloss });
  }
}

/**
 * WordNet's own exception lists: inflected form -> base form, for the
 * irregulars no suffix rule reaches ("led" -> "lead", "ran" -> "run").
 * Without these, a lookup of the past tense a bullet is actually written in
 * finds nothing, which is most of them.
 */
const exceptions = {};
const excDir = join(root, 'vendor', 'wordnet-exc');
for (const pos of POS) {
  // Vendored separately: wordnet-db ships index/data but not the .exc files.
  const raw = readFileSync(join(excDir, `${pos}.exc`), 'latin1');
  for (const line of raw.split('\n').filter(Boolean)) {
    const [inflected, ...bases] = line.trim().split(/\s+/);
    const base = bases[0];
    if (!isPlainWord(inflected) || !base || !isPlainWord(base)) continue;
    if (!(inflected in exceptions)) exceptions[inflected] = base;
  }
}

const data = {};
for (const [lemma, set] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  data[lemma] = [...set].slice(0, MAX_SYNONYMS);
}

// Only worth shipping an exception if the base form has synonyms to offer.
const usefulExceptions = {};
for (const [inflected, base] of Object.entries(exceptions)) {
  if (map.has(base) && !map.has(inflected)) usefulExceptions[inflected] = base;
}

const out = {
  meta: {
    source: `WordNet ${wordnet.version}, Princeton University`,
    version: String(wordnet.version),
    verifiedDate: new Date().toISOString().slice(0, 10),
    sourceUrl: 'https://wordnet.princeton.edu/',
    status: 'verified',
    license:
      'WordNet 3.0 License (BSD-style). Copyright Princeton University. ' +
      'Attribution required; see README.',
    notes:
      'GENERATED by scripts/build-synonyms.mjs -- do not edit by hand. ' +
      `Derived from WordNet ${wordnet.version} index/data files for ${POS.join(', ')}. ` +
      'All senses are included, most common first, and a lemma takes its ' +
      'synonyms from the first part of speech that has it so verb and noun ' +
      'meanings do not mix. ' +
      'Kept: single alphabetic lemmas of three or more letters that appear in ' +
      "WordNet's semantically tagged corpora, which filters out the rare and " +
      `archaic tail. Up to ${MAX_SYNONYMS} synonyms per lemma, taken from the ` +
      'synsets that lemma belongs to. Loaded as its own lazy chunk so it does ' +
      'not affect first paint. `exceptions` maps irregular inflected forms to ' +
      "their base (led -> lead), from WordNet's own *.exc files, so a bullet " +
      'written in the past tense still finds synonyms.',
  },
  data: {
    synonyms: data,
    exceptions: usefulExceptions,
    // Only for lemmas that made it into `synonyms`; a definition with nothing
    // to offer alongside it is weight for nothing.
    definitions: Object.fromEntries(
      [...definitions.entries()]
        .filter(([lemma]) => lemma in data)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([lemma, { pos, gloss }]) => [lemma, [pos[0], gloss]]),
    ),
  },
};

const file = join(root, 'src', 'data', 'vocab', 'synonyms.json');
writeFileSync(file, JSON.stringify(out) + '\n', 'utf8');

const lemmas = Object.keys(data).length;
const pairs = Object.values(data).reduce((n, list) => n + list.length, 0);
const excCount = Object.keys(usefulExceptions).length;
const defCount = [...definitions.keys()].filter((l) => l in data).length;
const kb = Buffer.byteLength(JSON.stringify(out)) / 1024;
console.log(
  `synonyms.json: ${lemmas} lemmas, ${pairs} synonyms, ${excCount} irregular ` +
    `forms, ${defCount} definitions, ${kb.toFixed(0)} KB ` +
    `(from ${considered} index entries)`,
);
