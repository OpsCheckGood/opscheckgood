#!/usr/bin/env node
/**
 * Generates src/data/vocab/synonyms.json from the WordNet database.
 *
 * Runs at build time, never at runtime -- the shipped file is plain JSON and
 * the tool never reaches the network (hard constraint 1). WordNet is a dev
 * dependency purely so this script has something to read.
 *
 * ## Grouped by sense
 *
 * Synonyms are kept per meaning rather than flattened into one list per word.
 * A flat list puts "guide" and "conduce" side by side under "lead", which is
 * tolerable when you are scanning the editor for something shorter and useless
 * on a page whose job is answering "is this the right word". Each sense carries
 * its own definition and its own synonyms.
 *
 * Keys are single letters because they repeat tens of thousands of times and
 * the file is downloaded by people on slow connections.
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

/** Verbs first: a bullet is a verb-led sentence, so that sense leads. */
const POS = ['verb', 'adj', 'noun'];
const MIN_LENGTH = 3;
/** Per sense, not per word -- a single meaning rarely has more real synonyms. */
const MAX_SYNONYMS = 12;
const MAX_SENSES = 6;
const MAX_DEFINITION = 110;

/** WordNet files begin with a licence header on lines starting with two spaces. */
const contentLines = (file) =>
  readFileSync(join(wordnet.path, file), 'latin1')
    .split('\n')
    .filter((line) => line && !line.startsWith('  '));

const isPlainWord = (word) => /^[a-z]+$/.test(word) && word.length >= MIN_LENGTH;

/**
 * A WordNet gloss is `definition; "an example of use"; "another"`. The examples
 * are quoted and belong to the sense rather than defining it, so they go.
 */
function cleanGloss(gloss) {
  const definition = gloss
    .split(';')
    .filter((part) => !part.trim().startsWith('"'))
    .join(';')
    .trim();
  return definition.length > MAX_DEFINITION
    ? `${definition.slice(0, MAX_DEFINITION - 1).trimEnd()}…`
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
      words.push(parts[4 + i * 2].toLowerCase().replace(/\(.*\)$/, ''));
    }
    synsets.set(offset, { words, gloss: cleanGloss(gloss) });
  }
  return synsets;
}

/** lemma -> senses, one map per part of speech so meanings never merge. */
const byPos = new Map(POS.map((pos) => [pos, new Map()]));
let considered = 0;

for (const pos of POS) {
  const synsets = readSynsets(pos);
  const map = byPos.get(pos);

  for (const line of contentLines(`index.${pos}`)) {
    const parts = line.split(/\s+/);
    const lemma = parts[0].toLowerCase();
    considered += 1;
    if (!isPlainWord(lemma)) continue;

    const synsetCount = Number(parts[2]);
    const pointerCount = Number(parts[3]);
    // ... p_cnt pointer symbols ... then sense_cnt, tagsense_cnt, offsets.
    const tagSenseIndex = 4 + pointerCount + 1;
    const offsets = parts
      .slice(tagSenseIndex + 1, tagSenseIndex + 1 + synsetCount)
      .slice(0, MAX_SENSES);

    const senses = [];
    for (const offset of offsets) {
      const synset = synsets.get(offset);
      if (!synset) continue;
      const words = synset.words.filter((w) => w !== lemma && isPlainWord(w));
      // A sense with no alternative word offers nothing to swap in.
      if (words.length === 0) continue;
      senses.push({
        p: pos[0],
        g: synset.gloss,
        s: [...new Set(words)].slice(0, MAX_SYNONYMS),
      });
    }
    if (senses.length > 0) map.set(lemma, senses);
  }
}

/**
 * One entry per lemma, senses ordered by part of speech.
 *
 * All parts of speech are kept so the thesaurus page can show a word's noun
 * meaning as well as its verb one. Consumers that want a single flat list take
 * only the senses matching the first entry's part of speech, which is what
 * keeps `physique` out of the suggestions for `build`.
 */
// A Map, not an object literal: WordNet contains the lemmas "constructor",
// "toString" and friends, and on a plain object those resolve to inherited
// Object.prototype members rather than undefined.
const senses = new Map();
for (const pos of POS) {
  for (const [lemma, list] of byPos.get(pos)) {
    senses.set(lemma, [...(senses.get(lemma) ?? []), ...list]);
  }
}

/**
 * WordNet's own exception lists: inflected form -> base form, for irregulars no
 * suffix rule reaches ("led" -> "lead"). Vendored under vendor/wordnet-exc
 * because the npm package ships index/data but not the .exc files. Without
 * these, a lookup of the past tense a bullet is written in finds nothing.
 */
const excDir = join(root, 'vendor', 'wordnet-exc');
const exceptions = {};
for (const pos of POS) {
  const raw = readFileSync(join(excDir, `${pos}.exc`), 'latin1');
  for (const line of raw.split('\n').filter(Boolean)) {
    const [inflected, ...bases] = line.trim().split(/\s+/);
    const base = bases[0];
    if (!isPlainWord(inflected) || !base || !isPlainWord(base)) continue;
    if (!(inflected in exceptions)) exceptions[inflected] = base;
  }
}

// Only worth shipping an exception whose base actually has something to offer.
const usefulExceptions = {};
for (const [inflected, base] of Object.entries(exceptions)) {
  if (senses.has(base) && !senses.has(inflected)) usefulExceptions[inflected] = base;
}

const ordered = Object.create(null);
for (const lemma of [...senses.keys()].sort((a, b) => a.localeCompare(b))) {
  ordered[lemma] = senses.get(lemma);
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
      `Derived from WordNet ${wordnet.version} for ${POS.join(', ')}. ` +
      'Grouped by sense: each entry is a list of meanings, each with its part ' +
      "of speech (p), definition (g) and synonyms (s). Flattening them would " +
      'put unrelated meanings side by side. Senses are ordered verb, adjective, ' +
      `noun; up to ${MAX_SENSES} senses and ${MAX_SYNONYMS} synonyms per sense. ` +
      '`exceptions` maps irregular inflected forms to their base (led -> lead), ' +
      "from WordNet's own *.exc files. Loaded as a lazy chunk so it does not " +
      'affect first paint.',
  },
  data: { senses: ordered, exceptions: usefulExceptions },
};

const file = join(root, 'src', 'data', 'vocab', 'synonyms.json');
writeFileSync(file, JSON.stringify(out) + '\n', 'utf8');

const lemmaCount = Object.keys(ordered).length;
const senseCount = Object.values(ordered).reduce((n, list) => n + list.length, 0);
const pairs = Object.values(ordered).reduce(
  (n, list) => n + list.reduce((m, sense) => m + sense.s.length, 0),
  0,
);
const kb = Buffer.byteLength(JSON.stringify(out)) / 1024;
console.log(
  `synonyms.json: ${lemmaCount} lemmas, ${senseCount} senses, ${pairs} synonyms, ` +
    `${Object.keys(usefulExceptions).length} irregular forms, ${kb.toFixed(0)} KB ` +
    `(from ${considered} index entries)`,
);
