import { describe, it, expect, beforeAll } from 'vitest';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { shapeLine, effectiveTargetMm } from '@/lib/shape/optimizer';
import { wrapToWidth } from '@/lib/text/wrap';
import { runReference, STATUS } from './fixtures/pdf-bullets.js';

/**
 * Differential test against pdf-bullets.
 *
 * pdf-bullets is the tool this one is trying to replace, and the one people
 * already trust. Where the two disagree about how a bullet should be spaced,
 * upstream is right by definition -- so its optimizer is run verbatim beside
 * ours on the same input and the answers are compared, rather than correctness
 * being argued from reading the code.
 *
 * Both engines are fed the SAME width function: our own font metrics, off the
 * bundled Liberation Serif. Upstream measures through canvas `measureText` with
 * Times New Roman, which constraint 1 forbids and which silently substitutes a
 * different face on a machine without Times. Feeding both the same numbers is
 * what isolates the algorithm, which is the part that has to match. (Liberation
 * is metrically compatible with Times, so the two measurements agree anyway on
 * a machine where upstream is measuring what it thinks it is.)
 */

const SIZE_PT = 12;
/** The AF Form 1206/910/911 field width, and upstream's default. */
const TARGET_MM = 202.321;
/** Upstream's -4px underflow bound, in our units. */
const MAX_UNDERFLOW_MM = -4 / (96 / 25.4);

let font: FontMetrics;
beforeAll(async () => {
  font = await loadFontMetrics('/fonts/LiberationSerif-Regular.ttf');
});

const WORDS = `led managed drove spearheaded rewrote coordinated authored executed synchronized
delivered team flight squadron wing group section unit crew shop office program project effort
initiative plan review inspection readiness budget funds hours sorties missions personnel troops
airmen NCOs officers members 12-person 340 hrs 90 days 22 CAS msns 4 HVT captures JTF MAJCOM/A4
AF/A1 82 RS/MXAA USAFE-AFAFRICA $1.4M 42% 18 min 210 mx yr best practice zero discrepancies
annual cycle checklists preflight time recovered secured enabled slashed outage rate hailed
lauded cut saved earned won built forged trained mentored supervised directed`
  .split(/\s+/)
  .filter(Boolean);

/** Deterministic pseudo-random source, so a failure is always reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/**
 * Lines whose natural width lands near the field width.
 *
 * Sampling uniformly would spend the whole corpus on bullets far too short to
 * shape, where both engines trivially agree. The optimizer only does work
 * within a few millimetres of the target, so that is where the cases go.
 */
function buildCorpus(width: (t: string) => number, spread: number): string[] {
  const rand = lcg(20260903);
  const corpus: string[] = [];
  let guard = 0;
  while (corpus.length < 500 && guard < 100000) {
    guard += 1;
    const words = ['-'];
    while (width(words.join(' ')) < TARGET_MM - spread) {
      words.push(WORDS[Math.floor(rand() * WORDS.length)]!);
    }
    const line = words.join(' ');
    const w = width(line);
    if (w > TARGET_MM - spread && w < TARGET_MM + spread) corpus.push(line);
  }
  return corpus;
}

describe('differential against pdf-bullets', () => {
  it('shapes every bullet exactly as upstream does', () => {
    const width = (t: string) => font.widthMm(t, SIZE_PT, false);
    const corpus = buildCorpus(width, 14);
    expect(corpus.length).toBe(500);

    const mismatches: string[] = [];
    let shaped = 0;
    let failed = 0;

    for (const line of corpus) {
      const mine = shapeLine(line, font, { targetMm: TARGET_MM, sizePt: SIZE_PT });
      const theirs = runReference(
        line,
        width,
        effectiveTargetMm(TARGET_MM),
        MAX_UNDERFLOW_MM,
      );

      const myOk = mine.status === 'at-target' || mine.status === 'shaped';
      const theirOk = theirs.status === STATUS.OPTIMIZED;
      if (theirOk) shaped += 1;
      else failed += 1;

      if (myOk !== theirOk) {
        mismatches.push(
          `verdict: upstream=${theirOk ? 'ok' : 'failed'} ours=${mine.status}\n  ${line}`,
        );
      } else if (mine.text !== theirs.text) {
        mismatches.push(
          `text differs (${mine.status}):\n  ours=${JSON.stringify(mine.text)}\n  them=${JSON.stringify(theirs.text)}`,
        );
      }
    }

    // A guard on the guard: if the corpus stopped landing near the target, the
    // comparison above would pass without ever exercising the optimizer.
    expect(shaped).toBeGreaterThan(50);
    expect(failed).toBeGreaterThan(50);
    expect(mismatches.slice(0, 5).join('\n\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });

  it('breaks lines where upstream breaks them', () => {
    const width = (t: string) => font.widthMm(t, SIZE_PT, false);
    // Deliberately overlong: wrapping only does anything once a line overruns,
    // so these run to several times the field width.
    const rand = lcg(11);
    const corpus: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const words = ['-'];
      const goal = TARGET_MM * (1.1 + rand() * 2.4);
      while (width(words.join(' ')) < goal) {
        words.push(WORDS[Math.floor(rand() * WORDS.length)]!);
      }
      corpus.push(words.join(' '));
    }

    const mismatches: string[] = [];
    let multiline = 0;

    for (const line of corpus) {
      const theirs = runReference(line, width, effectiveTargetMm(TARGET_MM), MAX_UNDERFLOW_MM);
      // Wrap the same text upstream ended up with, so this compares the line
      // breaking alone and not the shaping that produced it.
      const rows = wrapToWidth(theirs.text, font, SIZE_PT, TARGET_MM);
      if (theirs.textLines.length > 1) multiline += 1;
      if (rows.length !== theirs.textLines.length) {
        mismatches.push(
          `row count: upstream=${theirs.textLines.length} ours=${rows.length}\n  ${JSON.stringify(theirs.text)}`,
        );
        continue;
      }
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i]!.trimEnd() !== theirs.textLines[i]!.trimEnd()) {
          mismatches.push(
            `row ${i}:\n  ours=${JSON.stringify(rows[i])}\n  them=${JSON.stringify(theirs.textLines[i])}`,
          );
          break;
        }
      }
    }

    expect(multiline).toBeGreaterThan(20);
    expect(mismatches.slice(0, 5).join('\n\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });

  it('agrees on the specific tokens Acrobat may break inside', () => {
    // These are the reason the break rule is not simply "split on spaces".
    const width = (t: string) => font.widthMm(t, SIZE_PT, false);
    for (const token of ['USAFE-AFAFRICA', 'AF/A1', 'MAJCOM/A4', '42%', 'why?not', 'a|b']) {
      const line = `- ${'padding '.repeat(24)}${token} tail`;
      const theirs = runReference(line, width, effectiveTargetMm(TARGET_MM), MAX_UNDERFLOW_MM);
      const rows = wrapToWidth(theirs.text, font, SIZE_PT, TARGET_MM);
      expect(rows.map((r) => r.trimEnd())).toEqual(
        theirs.textLines.map((r) => r.trimEnd()),
      );
    }
  });
});
