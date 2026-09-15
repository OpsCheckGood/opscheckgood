import { loadDataset } from './loader';
import { DataFileError, type Dataset } from './types';
import worksheet from '../../data/epb/worksheet.json';

/**
 * The shape of an Enlisted Performance Brief as myEval takes it: the boxes,
 * the limit each one holds, and the qualities each performance statement is
 * meant to speak to.
 */

export interface LeadershipQuality {
  name: string;
  text: string;
}

export interface EpbSection {
  id: string;
  title: string;
  /** Characters myEval accepts in this box, spaces included. */
  limit: number;
  /** The major performance area's own definition; empty for the two boxes that have none. */
  description: string;
  qualities: LeadershipQuality[];
}

export interface EpbData {
  sections: EpbSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(raw: unknown, _meta: unknown, file: string): EpbData {
  if (!isRecord(raw)) throw new DataFileError(file, 'data must be an object');
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new DataFileError(file, 'data.sections must be a non-empty array');
  }
  const ids = new Set<string>();
  const sections: EpbSection[] = raw.sections.map((s, i) => {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string' || typeof s.limit !== 'number' || s.limit <= 0) {
      throw new DataFileError(file, `sections[${i}] needs id, title and a positive limit`);
    }
    if (!/^[a-z]+$/.test(s.id)) throw new DataFileError(file, `sections[${i}].id "${s.id}" must be lower-case letters: it names a PDF field`);
    if (ids.has(s.id)) throw new DataFileError(file, `sections[${i}].id "${s.id}" is repeated`);
    ids.add(s.id);
    const qualities = Array.isArray(s.qualities) ? s.qualities : [];
    return {
      id: s.id,
      title: s.title,
      limit: s.limit,
      description: typeof s.description === 'string' ? s.description : '',
      qualities: qualities.map((q, j) => {
        if (!isRecord(q) || typeof q.name !== 'string' || typeof q.text !== 'string') {
          throw new DataFileError(file, `sections[${i}].qualities[${j}] needs name and text`);
        }
        return { name: q.name, text: q.text };
      }),
    };
  });
  return { sections };
}

export const EPB: Dataset<EpbData> = loadDataset('src/data/epb/worksheet.json', worksheet, normalize);
