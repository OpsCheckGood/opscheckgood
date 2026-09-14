/**
 * pdf-bullets' save file, read and written.
 *
 * pdf-bullets (github.com/AF-VCD/pdf-bullets) saves and exports one JSON
 * shape: an array holding a single settings object, "for future growth". A
 * lot of people have bullets and abbreviation tables in that format, and
 * nobody should retype them to switch tools, so this reads it -- every
 * version of it -- and writes the same shape back so the file goes the other
 * way too.
 *
 *   [{
 *     width: 202.321,            // millimetres
 *     text: "- bullet\n- bullet", // newer files
 *     editorState: {...},        // Draft.js state; older files carry only this
 *     abbrData: [{enabled, value, abbr}] | [[enabled, value, abbr]],
 *     enableOptim: true
 *   }]
 *
 * Nothing here touches the network or the DOM; it is a pure translation.
 */

export interface PdfBulletsAbbreviation {
  phrase: string;
  abbr: string;
  enabled: boolean;
}

export interface PdfBulletsSave {
  /** Bullets, one per line. */
  text: string;
  /** Field width in millimetres, or null when the file carries none. */
  widthMm: number | null;
  /** The optimizer toggle, or null when the file carries none. */
  autoSpace: boolean | null;
  abbreviations: PdfBulletsAbbreviation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Text out of a serialised Draft.js editor state.
 *
 * Two shapes exist: `convertToRaw` gives `{blocks: [{text}]}`, and pdf-bullets
 * actually stores `EditorState.toJS()`, which nests the blocks in
 * `currentContent.blockMap` keyed by block id. Both are read.
 */
function textFromEditorState(state: unknown): string | null {
  if (!isRecord(state)) return null;
  const blocks = state.blocks;
  if (Array.isArray(blocks)) {
    return blocks
      .map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  const content = state.currentContent;
  if (isRecord(content) && isRecord(content.blockMap)) {
    return Object.values(content.blockMap)
      .map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }
  return null;
}

function readAbbreviation(row: unknown): PdfBulletsAbbreviation | null {
  let enabled: unknown;
  let phrase: unknown;
  let abbr: unknown;
  if (Array.isArray(row)) {
    [enabled, phrase, abbr] = row;
  } else if (isRecord(row)) {
    enabled = row.enabled;
    phrase = row.value;
    abbr = row.abbr;
  } else {
    return null;
  }
  if (typeof phrase !== 'string' || typeof abbr !== 'string') return null;
  const cleanPhrase = phrase.replace(/\s+/g, ' ').trim();
  const cleanAbbr = abbr.trim();
  if (cleanPhrase === '' || cleanAbbr === '') return null;
  return { phrase: cleanPhrase, abbr: cleanAbbr, enabled: enabled !== false };
}

/** Throws an Error with a message fit to show the user. */
export function parsePdfBulletsFile(raw: string): PdfBulletsSave {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Not a JSON file.');
  }
  const settings = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(settings)) {
    throw new Error('Not a pdf-bullets save file: expected a settings object.');
  }

  const text =
    typeof settings.text === 'string'
      ? settings.text
      : textFromEditorState(settings.editorState);
  if (text === null) {
    throw new Error('Not a pdf-bullets save file: no bullets in it.');
  }

  const width = Number(settings.width);
  const widthMm = Number.isFinite(width) && width > 0 ? width : null;

  const abbreviations = Array.isArray(settings.abbrData)
    ? settings.abbrData
        .map(readAbbreviation)
        .filter((a): a is PdfBulletsAbbreviation => a !== null)
    : [];

  return {
    text: text.replace(/\r\n?/g, '\n'),
    widthMm,
    autoSpace: typeof settings.enableOptim === 'boolean' ? settings.enableOptim : null,
    abbreviations,
  };
}

/** The same shape pdf-bullets writes, so its Import reads ours. */
export function serializePdfBulletsFile(save: PdfBulletsSave): string {
  return JSON.stringify([
    {
      width: save.widthMm ?? 202.321,
      text: save.text,
      abbrData: save.abbreviations.map((a) => ({
        enabled: a.enabled,
        value: a.phrase,
        abbr: a.abbr,
      })),
      enableOptim: save.autoSpace ?? true,
    },
  ]);
}
