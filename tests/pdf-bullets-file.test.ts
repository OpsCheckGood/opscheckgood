import { describe, it, expect } from 'vitest';
import { parsePdfBulletsFile, serializePdfBulletsFile } from '@/lib/data/pdfBulletsFile';

describe('parsePdfBulletsFile', () => {
  it('reads the current export shape', () => {
    const file = JSON.stringify([
      {
        width: 202.321,
        text: '- one\n- two',
        editorState: {},
        abbrData: [
          { enabled: true, value: 'with', abbr: 'w/' },
          { enabled: false, value: 'table', abbr: 'tbl' },
        ],
        enableOptim: false,
      },
    ]);
    const save = parsePdfBulletsFile(file);
    expect(save.text).toBe('- one\n- two');
    expect(save.widthMm).toBe(202.321);
    expect(save.autoSpace).toBe(false);
    expect(save.abbreviations).toEqual([
      { phrase: 'with', abbr: 'w/', enabled: true },
      { phrase: 'table', abbr: 'tbl', enabled: false },
    ]);
  });

  it('reads the old shape: abbreviations as rows, bullets only in editorState', () => {
    const file = JSON.stringify([
      {
        width: '201.041',
        editorState: {
          currentContent: {
            blockMap: {
              a1: { key: 'a1', text: '- first' },
              b2: { key: 'b2', text: '- second' },
            },
          },
        },
        abbrData: [[true, 'squadron', 'sq'], [false, 'flight', 'flt']],
      },
    ]);
    const save = parsePdfBulletsFile(file);
    expect(save.text).toBe('- first\n- second');
    expect(save.widthMm).toBe(201.041);
    expect(save.autoSpace).toBeNull();
    expect(save.abbreviations.map((a) => a.abbr)).toEqual(['sq', 'flt']);
  });

  it('reads a convertToRaw editor state and a bare settings object', () => {
    const save = parsePdfBulletsFile(
      JSON.stringify({ editorState: { blocks: [{ text: '- x' }, { text: '- y' }] } }),
    );
    expect(save.text).toBe('- x\n- y');
    expect(save.widthMm).toBeNull();
  });

  it('normalises Windows line endings and skips junk abbreviation rows', () => {
    const save = parsePdfBulletsFile(
      JSON.stringify([{ text: '- a\r\n- b', abbrData: [null, ['x'], { value: '', abbr: 'z' }] }]),
    );
    expect(save.text).toBe('- a\n- b');
    expect(save.abbreviations).toEqual([]);
  });

  it('rejects files it cannot read, with a message fit to show', () => {
    expect(() => parsePdfBulletsFile('not json')).toThrow('Not a JSON file.');
    expect(() => parsePdfBulletsFile('[42]')).toThrow(/settings object/);
    expect(() => parsePdfBulletsFile('[{"width": 5}]')).toThrow(/no bullets/);
  });
});

describe('serializePdfBulletsFile', () => {
  it('round-trips through the parser and matches the shape pdf-bullets reads', () => {
    const save = {
      text: '- one\n- two',
      widthMm: 202.321,
      autoSpace: true,
      abbreviations: [{ phrase: 'with', abbr: 'w/', enabled: true }],
    };
    const raw = serializePdfBulletsFile(save);
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({
      width: 202.321,
      text: '- one\n- two',
      abbrData: [{ enabled: true, value: 'with', abbr: 'w/' }],
      enableOptim: true,
    });
    expect(parsePdfBulletsFile(raw)).toEqual(save);
  });
});
