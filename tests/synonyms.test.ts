import { describe, it, expect, beforeAll } from 'vitest';
import {
  findSynonyms,
  findDefinition,
  findSenses,
  inflect,
  matchCase,
  wordAt,
} from '@/lib/text/synonyms';
import { loadSynonyms } from '@/lib/data/vocab';
import type { SynonymData } from '@/lib/data/types';

let data: SynonymData;
beforeAll(async () => {
  data = (await loadSynonyms()).data;
});

describe('inflect', () => {
  it('handles regular endings', () => {
    expect(inflect('direct', 'ed')).toBe('directed');
    expect(inflect('direct', 'ing')).toBe('directing');
    expect(inflect('direct', 's')).toBe('directs');
  });

  it('drops a silent e before -ing and adds only d before -ed', () => {
    expect(inflect('guide', 'ed')).toBe('guided');
    expect(inflect('guide', 'ing')).toBe('guiding');
  });

  it('turns consonant + y into -ies / -ied', () => {
    expect(inflect('carry', 's')).toBe('carries');
    expect(inflect('carry', 'ed')).toBe('carried');
    // Vowel + y does not.
    expect(inflect('play', 'ed')).toBe('played');
  });

  it('doubles a final consonant after a short vowel', () => {
    expect(inflect('plan', 'ed')).toBe('planned');
    expect(inflect('plan', 'ing')).toBe('planning');
    // ...but not after w, x or y.
    expect(inflect('allow', 'ed')).toBe('allowed');
  });

  it('adds -es after a sibilant', () => {
    expect(inflect('fix', 's')).toBe('fixes');
    expect(inflect('teach', 's')).toBe('teaches');
  });
});

describe('matchCase', () => {
  it('copies the original capitalisation', () => {
    expect(matchCase('guided', 'Led')).toBe('Guided');
    expect(matchCase('guided', 'LED')).toBe('GUIDED');
    expect(matchCase('guided', 'led')).toBe('guided');
  });
});

describe('wordAt', () => {
  const line = 'Led a 12-person team';
  it('finds the word under an index', () => {
    expect(wordAt(line, 1)).toMatchObject({ word: 'Led', start: 0, end: 3 });
    expect(wordAt(line, 16)).toMatchObject({ word: 'team' });
  });
  it('takes the preceding word when the caret sits just past one', () => {
    expect(wordAt(line, 3)).toMatchObject({ word: 'Led' });
  });
  it('returns null when neither side of the caret is a word', () => {
    // Index 6 is the '1' of "12-person"; digits are not part of a word for
    // synonym purposes, and the character before it is a space.
    expect(wordAt(line, 6)).toBeNull();
    expect(wordAt('', 0)).toBeNull();
  });
  it('trims trailing punctuation from the match', () => {
    // Caret on the semicolon, directly after "sorties".
    expect(wordAt('drove 340 sorties; zero', 17)).toMatchObject({ word: 'sorties' });
  });
});

describe('findSynonyms', () => {
  it('looks up a dictionary form directly', () => {
    const found = findSynonyms('lead', data);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((o) => o.text)).toContain('guide');
    expect(found.every((o) => !o.reconstructed)).toBe(true);
  });

  // The case that matters: bullets are written in the past tense.
  it('resolves an irregular past tense and returns matching forms', () => {
    const found = findSynonyms('Led', data);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.lemma).toBe('lead');
    expect(found.every((o) => o.reconstructed)).toBe(true);
    // Offered in the tense that was selected, and capitalised to match.
    expect(found.map((o) => o.text)).toContain('Guided');
  });

  it('resolves a regular past tense', () => {
    const found = findSynonyms('directed', data);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.lemma).toBe('direct');
    expect(found.every((o) => o.text.endsWith('ed'))).toBe(true);
  });

  it('resolves a gerund', () => {
    const found = findSynonyms('training', data);
    expect(found.length).toBeGreaterThan(0);
  });

  it('resolves a plural', () => {
    const found = findSynonyms('reports', data);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((o) => o.text.endsWith('s'))).toBe(true);
  });

  it('returns nothing for a word it does not know, rather than guessing', () => {
    expect(findSynonyms('zzqxwv', data)).toEqual([]);
    expect(findSynonyms('a', data)).toEqual([]);
  });

  it('never offers the selected word back as its own synonym', () => {
    for (const word of ['lead', 'direct', 'train', 'improve']) {
      expect(findSynonyms(word, data).map((o) => o.text.toLowerCase())).not.toContain(word);
    }
  });
});

describe('shipped synonym data', () => {
  it('covers a practical vocabulary', () => {
    expect(Object.keys(data.senses).length).toBeGreaterThan(8000);
    expect(Object.keys(data.exceptions).length).toBeGreaterThan(1000);
  });

  it('maps irregulars to forms that actually carry synonyms', () => {
    for (const [inflected, base] of Object.entries(data.exceptions).slice(0, 200)) {
      expect(data.senses[base], `${inflected} -> ${base}`).toBeDefined();
    }
  });

  it('holds no multi-word entries, which cannot replace one selected word', () => {
    const bad = Object.entries(data.senses)
      .flatMap(([lemma, senses]) => [lemma, ...senses.flatMap((sense) => sense.s)])
      .filter((w) => /[^a-z]/.test(w));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

/**
 * The reconstruction rules will always be approximate; these pin the failures
 * that were actually showing up in the panel, where the top suggestion for
 * "directed" was "taked".
 */
describe('reconstruction quality', () => {
  it('never offers a regular -ed form of an irregular verb', () => {
    const bad = ['taked', 'leaded', 'sended', 'maked', 'gived', 'holded', 'runned'];
    for (const word of ['directed', 'led', 'managed', 'headed', 'built']) {
      const texts = findSynonyms(word, data).map((o) => o.text.toLowerCase());
      expect(texts.filter((t) => bad.includes(t)), `from "${word}"`).toEqual([]);
    }
  });

  it('does not double a consonant on an unstressed final syllable', () => {
    expect(inflect('target', 'ed')).toBe('targeted');
    expect(inflect('offer', 'ed')).toBe('offered');
    expect(inflect('visit', 'ed')).toBe('visited');
    // Single syllable still doubles.
    expect(inflect('plan', 'ed')).toBe('planned');
    expect(inflect('stop', 'ing')).toBe('stopping');
  });

  it('still offers usable options for the verbs bullets are built from', () => {
    for (const word of ['directed', 'managed', 'improved', 'trained']) {
      const found = findSynonyms(word, data);
      expect(found.length, `"${word}" produced nothing`).toBeGreaterThan(0);
      expect(found.every((o) => o.text.endsWith('ed'))).toBe(true);
    }
  });
});

describe('findDefinition', () => {
  it('defines a dictionary form directly', () => {
    const def = findDefinition('lead', data)!;
    expect(def.lemma).toBe('lead');
    expect(def.partOfSpeech).toBe('verb');
    expect(def.text.length).toBeGreaterThan(3);
    expect(def.reduced).toBe(false);
  });

  // The word on screen is inflected; the definition lives under its base.
  it('reduces an inflected word and says so', () => {
    const def = findDefinition('Led', data)!;
    expect(def.lemma).toBe('lead');
    expect(def.reduced).toBe(true);
  });

  it('agrees with the synonym lookup about which word is being described', () => {
    for (const word of ['directed', 'training', 'improved', 'reports']) {
      const def = findDefinition(word, data);
      const syn = findSynonyms(word, data);
      if (def && syn.length > 0) expect(def.lemma).toBe(syn[0]!.lemma);
    }
  });

  it('returns null rather than a wrong definition for an unknown word', () => {
    expect(findDefinition('zzqxwv', data)).toBeNull();
  });

  it('carries a definition on every sense', () => {
    const senses = Object.values(data.senses).flat();
    expect(senses.length).toBeGreaterThan(10000);
    expect(senses.filter((sense) => !sense.g || sense.g.length < 2)).toEqual([]);
  });

  it('never ships a sense with no replacements to offer', () => {
    const empty = Object.entries(data.senses).filter(([, senses]) =>
      senses.some((sense) => sense.s.length === 0),
    );
    expect(empty.slice(0, 3)).toEqual([]);
  });

  it('strips the quoted usage examples from the gloss', () => {
    for (const sense of Object.values(data.senses).flat().slice(0, 800)) {
      expect(sense.g.startsWith('"')).toBe(false);
    }
  });

  /**
   * WordNet contains the lemmas "constructor", "toString" and "valueOf". On a
   * plain object those resolve to inherited Object.prototype members, so a bare
   * property lookup returns a function instead of undefined.
   */
  it('does not mistake an inherited property for a word', () => {
    for (const trap of ['toString', 'valueOf', 'hasOwnProperty']) {
      const found = findSenses(trap, data);
      expect(Array.isArray(found)).toBe(true);
      for (const sense of found) expect(Array.isArray(sense.options)).toBe(true);
    }
  });
});
